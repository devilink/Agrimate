/** Ops console backend, health/metrics, and the mock bank used in development. Every admin mutation is audited. */
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { MockPaymentGateway, PAYMENT_GATEWAY, PaymentGateway } from '../adapters/payments';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth';
import { AuditService, Clock, CryptoService, env, PrismaService } from '../core/core';
import { Accounts, LedgerService, NotificationsService, OrderEngine, TimerService } from '../engine/engine';
import { InspectionService } from '../inspection/inspection.service';
import { DisputesService } from '../logistics/logistics.service';
import { ReviewDto } from '../onboarding/onboarding.dto';
import { ManualAssignDto, MockCreditDto, ReasonDto, RefundExcessDto, ResolveDisputeDto } from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementService } from '../payments/settlement.service';

type QueueKind = 'kyb' | 'kyc' | 'inspector' | 'logistics' | 'organic';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settlement: SettlementService, private readonly notifications: NotificationsService, private readonly crypto: CryptoService) {}

  /** Review queues. PAN and bank numbers show as last-4 only; raw provider responses are there for the decision. */
  async queues() {
    const [kyb, kyc, inspector, logistics, organic] = await Promise.all([
      this.prisma.buyerProfile.findMany({ where: { kybStatus: { in: ['PENDING', 'MANUAL_REVIEW'] } }, include: { user: { select: { name: true, phoneLast4: true } } } }),
      this.prisma.farmerProfile.findMany({ where: { kycStatus: { in: ['PENDING', 'MANUAL_REVIEW'] } }, include: { user: { select: { name: true, phoneLast4: true } } } }),
      this.prisma.inspectorProfile.findMany({ where: { status: { in: ['PENDING', 'MANUAL_REVIEW'] } }, include: { user: { select: { name: true, phoneLast4: true } } } }),
      this.prisma.logisticsProfile.findMany({ where: { status: { in: ['PENDING', 'MANUAL_REVIEW'] } }, include: { user: { select: { name: true, phoneLast4: true } }, vehicles: { include: { tier: true } } } }),
      this.prisma.organicCertificate.findMany({ where: { status: 'PENDING' }, include: { farmer: { include: { user: { select: { name: true } } } } } }),
    ]);
    return {
      kyb: kyb.map((b) => ({ id: b.userId, name: b.user.name, companyName: b.companyName, gstin: b.gstin, panLast4: b.panLast4, status: b.kybStatus, note: b.kybNote, response: b.kybResponse })),
      kyc: kyc.map((f) => ({ id: f.userId, name: f.user.name, panName: f.panName, bankHolderName: f.bankHolderName, panLast4: f.panLast4, bankLast4: f.bankLast4, bankIfsc: f.bankIfsc, status: f.kycStatus, note: f.kycNote, response: f.kycResponse })),
      inspector: inspector.map((i) => ({ id: i.userId, name: i.user.name, degreeType: i.degreeType, degreeFileId: i.degreeFileId, status: i.status, pin: i.pin })),
      logistics: logistics.map((l) => ({ id: l.userId, name: l.user.name, partnerType: l.partnerType, companyName: l.companyName, gstin: l.gstin, rcFileId: l.rcFileId, dlFileId: l.dlFileId, fitnessFileId: l.fitnessFileId, status: l.status, noCoLoadingAcceptedAt: l.noCoLoadingAcceptedAt, vehicles: l.vehicles })),
      organic: organic.map((c) => ({ id: c.id, farmer: c.farmer.user.name, certifier: c.certifier, certNumber: c.certNumber, expiresAt: c.expiresAt, fileId: c.fileId, status: c.status })),
    };
  }

  async review(admin: AuthUser, kind: QueueKind, id: string, d: ReviewDto) {
    const ok = d.decision === 'APPROVE';
    const status = ok ? ('VERIFIED' as const) : ('REJECTED' as const);
    let notifyUserId = id;
    if (kind === 'kyb') await this.prisma.buyerProfile.update({ where: { userId: id }, data: { kybStatus: status, kybNote: d.note } });
    else if (kind === 'kyc') {
      const f = await this.prisma.farmerProfile.findUniqueOrThrow({ where: { userId: id } });
      if (ok && !f.fundAccountId) throw new ConflictException({ code: 'BANK_NOT_VALIDATED', message: 'The bank account failed validation, so it cannot be approved for payouts' });
      // An admin approving a name mismatch is the documented manual override; it enables payouts and clears what was held.
      await this.prisma.farmerProfile.update({ where: { userId: id }, data: { kycStatus: status, kycNote: d.note, payoutsEnabled: ok } });
      if (ok) await this.settlement.releaseBlockedFor(id);
    } else if (kind === 'inspector') await this.prisma.inspectorProfile.update({ where: { userId: id }, data: { status, statusNote: d.note, ...(ok ? {} : { available: false }) } });
    else if (kind === 'logistics') {
      await this.prisma.logisticsProfile.update({ where: { userId: id }, data: { status, statusNote: d.note } });
      if (ok) await this.settlement.releaseBlockedFor(id);
    } else if (kind === 'organic') {
      const c = await this.prisma.organicCertificate.update({ where: { id }, data: { status, note: d.note } });
      notifyUserId = c.farmerId;
    } else throw new BadRequestException('Unknown queue');
    await this.audit.log({ actorId: admin.id, actorRole: admin.role, action: `REVIEW_${kind.toUpperCase()}_${d.decision}`, entity: kind, entityId: id, data: { note: d.note } });
    await this.notifications.enqueue(this.prisma, notifyUserId, 'kyc_result', { status, note: d.note ?? '' });
    return { id, status };
  }
}

@ApiTags('admin') @ApiBearerAuth() @Roles('ADMIN') @Controller('admin')
export class AdminController {
  constructor(
    private readonly s: AdminService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly orders: OrdersService, private readonly settlement: SettlementService, private readonly engine: OrderEngine,
    private readonly ledger: LedgerService, private readonly inspection: InspectionService, private readonly disputes: DisputesService,
  ) {}

  @Get('queues') queues() { return this.s.queues(); }
  @HttpCode(200) @Post('queues/:kind/:id/review') review(@CurrentUser() u: AuthUser, @Param('kind') k: QueueKind, @Param('id') id: string, @Body() d: ReviewDto) { return this.s.review(u, k, id, d); }

  @Get('orders')
  async orderList(@Query('state') state?: string, @Query('q') q?: string) {
    const where: Prisma.OrderWhereInput = { ...(state ? { state: state as Prisma.EnumOrderStateFilter['equals'] } : {}), ...(q ? { code: { contains: q, mode: 'insensitive' } } : {}) };
    const rows = await this.prisma.order.findMany({ where, include: { commodity: true, grade: true, buyer: { select: { companyName: true } }, farmer: { include: { user: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((o) => ({ id: o.id, code: o.code, state: o.state, flow: o.flow, commodity: o.commodity.name, grade: o.grade.name, quantityKg: o.quantityKg, gmvPaise: o.gmvPaise, buyer: o.buyer.companyName, farmer: o.farmer.user.name, slaDeadlineAt: o.slaDeadlineAt, createdAt: o.createdAt }));
  }
  @Get('orders/:id') order(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.view(u, id); }

  /** Declares a farmer default. Refund and negative-balance posting follow automatically through the state table. */
  @HttpCode(200) @Post('orders/:id/farmer-default')
  async farmerDefault(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ReasonDto) {
    await this.prisma.tx(async (tx) => {
      await this.engine.transition(tx, id, 'FARMER_DEFAULTED', { id: u.id, role: 'ADMIN' }, { reason: d.reason });
      await this.audit.log({ actorId: u.id, actorRole: u.role, action: 'FARMER_DEFAULT_DECLARED', entity: 'Order', entityId: id, data: { reason: d.reason } }, tx);
    });
    return this.orders.view(u, id);
  }
  @HttpCode(200) @Post('orders/:id/buyer-default/refund')
  async buyerRefund(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ReasonDto) {
    await this.prisma.tx(async (tx) => {
      await this.engine.transition(tx, id, 'REFUNDED', { id: u.id, role: 'ADMIN' }, { reason: d.reason });
      await this.audit.log({ actorId: u.id, actorRole: u.role, action: 'BUYER_DEFAULT_REFUNDED', entity: 'Order', entityId: id, data: { reason: d.reason } }, tx);
    });
    return this.orders.view(u, id);
  }
  @HttpCode(200) @Post('orders/:id/refund-excess')
  async refundExcess(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: RefundExcessDto) {
    const r = await this.settlement.refundExcess(id, d.amountPaise ? BigInt(d.amountPaise) : null);
    await this.audit.log({ actorId: u.id, actorRole: u.role, action: 'EXCESS_REFUNDED', entity: 'Order', entityId: id, data: { refundedPaise: r.refundedPaise.toString() } });
    return r;
  }
  @HttpCode(200) @Post('orders/:id/assign-inspector') assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ManualAssignDto) { return this.inspection.manualAssign(u, id, d.inspectorId); }

  @Get('inspectors')
  async inspectors() {
    const rows = await this.prisma.inspectorProfile.findMany({ where: { status: 'VERIFIED' }, include: { user: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.userId, name: r.user.name, available: r.available, pin: r.pin, serviceRadiusKm: r.serviceRadiusKm }));
  }

  /** Quality-check board: every inspection with its order, so ops can see what is unassigned, in the field or failed. Names only, no phones. */
  @Get('inspections')
  async inspectionList(@Query('status') status?: string) {
    const rows = await this.prisma.inspection.findMany({
      where: status ? { status: status as Prisma.EnumInspectionStatusFilter['equals'] } : {},
      include: { order: { include: { commodity: true, grade: true, farmer: { include: { user: { select: { name: true } } } } } }, inspector: { include: { user: { select: { name: true } } } } },
      orderBy: { scheduledFor: 'asc' }, take: 200,
    });
    return rows.map((i) => ({
      id: i.id, orderId: i.orderId, orderCode: i.order.code, orderState: i.order.state, status: i.status, scheduledFor: i.scheduledFor,
      commodity: i.order.commodity.name, grade: i.order.grade.name, quantityKg: i.order.quantityKg, pickupPin: i.order.pickupPin, farmer: i.order.farmer.user.name,
      inspectorId: i.inspectorId, inspector: i.inspector?.user.name ?? null, assignAttempts: i.assignAttempts, selfCertRequired: i.order.selfCertRequired,
      checkInAt: i.checkInAt, checkInMetres: i.checkInMetres, scaleWeightKg: i.scaleWeightKg, gradeCheck: i.gradeCheck, inspectedAt: i.inspectedAt,
    }));
  }

  /** Transport board: every trip request, funded or not, with who has taken it. */
  @Get('trips')
  async tripList(@Query('status') status?: string) {
    const rows = await this.prisma.trip.findMany({
      where: status ? { status: status as Prisma.EnumTripStatusFilter['equals'] } : {},
      include: { order: { include: { commodity: true } }, vehicle: { select: { regNo: true } }, partner: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return rows.map((t) => ({
      id: t.id, orderId: t.orderId, orderCode: t.order.code, orderState: t.order.state, status: t.status, commodity: t.order.commodity.name, quantityKg: t.order.quantityKg,
      pickupPin: t.order.pickupPin, dropPin: t.order.deliveryPin, distanceKm: t.distanceMetres / 1000, tierCode: t.tierCode, finalFreightPaise: t.finalFreightPaise, payoutPaise: t.baseCostPaise,
      fundedAt: t.fundedAt, partner: t.partner ? (t.partner.companyName ?? t.partner.user.name) : null, vehicleRegNo: t.vehicle?.regNo ?? null, ewayBillNumber: t.ewayBillNumber,
      acceptedAt: t.acceptedAt, pickedUpAt: t.pickedUpAt, deliveredAt: t.deliveredAt, podOtpVerified: t.podOtpVerified, slaDeadlineAt: t.order.slaDeadlineAt, createdAt: t.createdAt,
    }));
  }

  @Get('disputes') disputeList(@Query('status') s?: string) { return this.disputes.list(s); }
  @HttpCode(200) @Post('disputes/:id/resolve') resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ResolveDisputeDto) { return this.disputes.resolve(u, id, d); }

  @Get('payouts') payouts(@Query('status') s?: string) { return this.prisma.payout.findMany({ where: s ? { status: s as 'BLOCKED' } : {}, include: { order: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }
  @HttpCode(200) @Post('payouts/:id/retry')
  async retry(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.settlement.retryPayout(id);
    await this.audit.log({ actorId: u.id, actorRole: u.role, action: 'PAYOUT_RETRIED', entity: 'Payout', entityId: id, data: { status: p.status } });
    return p;
  }

  @Get('ledger/accounts')
  async accounts() {
    const accounts = await this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' }, take: 500 });
    const sums = await this.prisma.ledgerPosting.groupBy({ by: ['accountId'], _sum: { amountPaise: true } });
    const m = new Map(sums.map((s) => [s.accountId, s._sum.amountPaise ?? 0n]));
    return { trialBalancePaise: await this.ledger.trialBalance(), accounts: accounts.map((a) => ({ code: a.code, type: a.type, balancePaise: m.get(a.id) ?? 0n })) };
  }
  @Get('ledger/journals')
  journals(@Query('orderId') orderId?: string) { return this.prisma.journalEntry.findMany({ where: { orderId }, include: { postings: { include: { account: { select: { code: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }

  @Get('escrow')
  async escrow() {
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { code: { startsWith: 'buyer_escrow:' } } });
    const out = [];
    for (const a of accounts) {
      const orderId = a.code.split(':')[1]!;
      const bal = await this.ledger.escrowBalance(orderId);
      if (bal !== 0n) out.push({ orderId, escrowPaise: bal, order: await this.prisma.order.findUnique({ where: { id: orderId }, select: { code: true, state: true } }) });
    }
    return { totalPaise: out.reduce((s, x) => s + x.escrowPaise, 0n), nodalPaise: await this.ledger.balance(Accounts.nodal), orders: out };
  }

  @Get('audit') auditLog(@Query('entity') entity?: string, @Query('entityId') entityId?: string) { return this.prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { createdAt: 'desc' }, take: 200 }); }

  /** SLA breach board: open alerts, plus orders that are past their deadline but not yet out of the gate. */
  @Get('sla-board')
  async board() {
    const now = new Date();
    const [alerts, overdue] = await Promise.all([
      this.prisma.adminAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.order.findMany({ where: { slaDeadlineAt: { lt: now }, state: { in: ['ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE', 'FULLY_FUNDED', 'INSPECTION_SCHEDULED', 'INSPECTED', 'SELF_CERTIFIED'] } }, select: { id: true, code: true, state: true, slaDeadlineAt: true }, take: 200 }),
    ]);
    return { alerts, overdue };
  }
  @HttpCode(200) @Post('alerts/:id/resolve')
  async resolveAlert(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.audit.log({ actorId: u.id, actorRole: u.role, action: 'ALERT_RESOLVED', entity: 'AdminAlert', entityId: id });
    return this.prisma.adminAlert.update({ where: { id }, data: { resolvedAt: new Date(), resolvedBy: u.id } });
  }

  @Get('reconciliation') recon() { return this.prisma.reconciliationReport.findMany({ orderBy: { forDate: 'desc' }, take: 60 }); }
  @HttpCode(200) @Post('reconciliation/run') runRecon(@Query('date') date?: string) { return this.settlement.reconcile(date); }
}

// ---- Health & metrics --------------------------------------------------------------------------------------------
@ApiTags('ops') @SkipThrottle() @Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}
  @Public() @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString(), providers: { payment: env.paymentProvider, maps: env.mapsProvider, sms: env.smsProvider, kyc: env.kycProvider, market: env.marketProvider, storage: env.storageProvider } };
  }
  /** Prometheus text format. Protect at the network edge in production. */
  @Public() @Get('metrics')
  async metrics() {
    const [byState, pendingOutbox, openAlerts, trial] = await Promise.all([
      this.prisma.order.groupBy({ by: ['state'], _count: true }),
      this.prisma.notificationOutbox.count({ where: { status: 'PENDING' } }),
      this.prisma.adminAlert.count({ where: { resolvedAt: null } }),
      this.ledger.trialBalance(),
    ]);
    return [
      ...byState.map((s) => `agrimate_orders{state="${s.state}"} ${s._count}`),
      `agrimate_outbox_pending ${pendingOutbox}`, `agrimate_alerts_open ${openAlerts}`, `agrimate_ledger_trial_balance_paise ${trial}`,
    ].join('\n') + '\n';
  }
}

// ---- Dev: mock bank ------------------------------------------------------------------------------------------------
/** Simulates a NEFT/RTGS credit by sending a signed webhook through the real handler. Refuses to run outside mock mode. */
@ApiTags('dev') @ApiBearerAuth() @Controller('dev')
export class DevController {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway, private readonly timers: TimerService, private readonly clock: Clock, private readonly notifications: NotificationsService) {}

  private guard() { if (!env.devToolsEnabled) throw new ForbiddenException('Dev tools are disabled'); }

  @Roles('BUYER', 'ADMIN') @HttpCode(200) @Post('mock-bank/orders/:orderId/credit')
  async credit(@CurrentUser() u: AuthUser, @Param('orderId') orderId: string, @Body() d: MockCreditDto) {
    this.guard();
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { virtualAccount: true, tranches: true } });
    if (!order || (u.role !== 'ADMIN' && order.buyerId !== u.id)) throw new NotFoundException('Order not found');
    if (!order.virtualAccount) throw new ConflictException('No virtual account yet');
    const rank: Record<string, number> = { ADVANCE: 0, FREIGHT: 1, BALANCE: 2 };
    const next = order.tranches.filter((t) => t.status !== 'PAID').sort((a, b) => rank[a.kind]! - rank[b.kind]!)[0];
    const amount = d.amountPaise ? BigInt(d.amountPaise) : next ? next.expectedPaise - next.receivedPaise : 0n;
    if (amount <= 0n) throw new ConflictException('Nothing is due; pass amountPaise to force a credit');
    const gw = this.gateway as MockPaymentGateway;
    const hook = await gw.buildCreditWebhook({ gatewayVaId: order.virtualAccount.gatewayId, amountPaise: amount, paymentId: d.paymentId });
    await gw.recordCredit(hook.paymentId, amount, hook.feePaise);
    return { paymentId: hook.paymentId, ...(await this.payments.handleWebhook(hook.raw, hook.signature, undefined)) };
  }

  @Roles('ADMIN') @HttpCode(200) @Post('time/advance')
  async advance(@Query('hours') hours: string) {
    this.guard();
    this.clock.advance(Number(hours) * 3_600_000);
    return { now: this.clock.now(), firedTimers: await this.timers.fireDue(), sent: await this.notifications.flush() };
  }
}
