/**
 * Disbursement side of escrow: freight release on PoD, final settlement, refunds, negative balances, payouts, invoices,
 * reconciliation. Every movement is a journal; every external call carries an idempotency key.
 */
import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, ConflictException } from '@nestjs/common';
import { Order, PayeeType, Prisma } from '@prisma/client';
import { applyBps, computeSettlement, formatINR, istDateString } from '@agrimate/shared';
import { Clock, ConfigService, PrismaService, Tx } from '../core/core';
import { Accounts, AlertsService, JobsService, LedgerService, NotificationsService, OrderEngine } from '../engine/engine';
import { MockPaymentGateway, PAYMENT_GATEWAY, PaymentGateway } from '../adapters/payments';

@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger('Settlement');
  constructor(
    private readonly prisma: PrismaService, private readonly clock: Clock, private readonly engine: OrderEngine, private readonly ledger: LedgerService,
    private readonly alerts: AlertsService, private readonly notifications: NotificationsService, private readonly config: ConfigService, private readonly jobs: JobsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    this.engine.register('RELEASE_FREIGHT', ({ tx, order }) => this.releaseFreight(tx, order));
    this.engine.register('SETTLE', ({ tx, order }) => this.settle(tx, order));
    this.engine.register('REFUND_ALL', ({ tx, order, transition }) => this.refundAll(tx, order, transition.from));
    this.engine.register('POST_DEFAULT_FEE', ({ tx, order, transition, payload }) => this.postDefaultFee(tx, order, transition.from, payload));
    this.jobs.repeat('reconcile-daily', () => this.reconcile(), { pattern: '30 2 * * *' });
  }

  // ---- Payouts -----------------------------------------------------------------------------------------------------
  private async payeeAccount(tx: Tx, type: PayeeType, id: string): Promise<{ fundAccountId: string | null; blockedReason?: string }> {
    if (type === 'FARMER') {
      const f = await tx.farmerProfile.findUniqueOrThrow({ where: { userId: id } });
      // Hard rule from the PRD: bank-holder name must match PAN name before any payout.
      if (!f.payoutsEnabled) return { fundAccountId: null, blockedReason: 'Bank-holder name is not verified against PAN' };
      return { fundAccountId: f.fundAccountId, blockedReason: f.fundAccountId ? undefined : 'No verified bank account' };
    }
    const p = type === 'LOGISTICS' ? await tx.logisticsProfile.findUniqueOrThrow({ where: { userId: id } }) : await tx.inspectorProfile.findUniqueOrThrow({ where: { userId: id } });
    return { fundAccountId: p.fundAccountId, blockedReason: p.fundAccountId ? undefined : 'No payout account on file' };
  }

  private payableAccount(type: PayeeType, id: string) {
    return type === 'FARMER' ? Accounts.farmerPayable(id) : type === 'LOGISTICS' ? Accounts.logisticsPayable(id) : Accounts.inspectorPayable(id);
  }

  private async pay(tx: Tx, order: Pick<Order, 'id' | 'code'>, type: PayeeType, payeeId: string, amount: bigint, key: string) {
    if (amount <= 0n) return null;
    const existing = await tx.payout.findUnique({ where: { idempotencyKey: key } });
    if (existing) return existing;
    const { fundAccountId, blockedReason } = await this.payeeAccount(tx, type, payeeId);
    if (blockedReason || !fundAccountId) {
      return tx.payout.create({ data: { orderId: order.id, payeeType: type, payeeId, amountPaise: amount, idempotencyKey: key, status: 'BLOCKED', statusNote: blockedReason } });
    }
    const payout = await tx.payout.create({ data: { orderId: order.id, payeeType: type, payeeId, amountPaise: amount, idempotencyKey: key, status: 'PENDING' } });
    return this.executePayout(tx, payout.id, order, fundAccountId);
  }

  private async executePayout(tx: Tx, payoutId: string, order: Pick<Order, 'id' | 'code'>, fundAccountId: string) {
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    try {
      const { transferId } = await this.gateway.transfer({ idempotencyKey: payout.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_'), fundAccountId, amountPaise: payout.amountPaise, notes: { orderCode: order.code, payeeType: payout.payeeType } });
      await this.ledger.post(tx, {
        key: `payout:${payout.id}`, type: 'PAYOUT', orderId: order.id,
        lines: [{ account: this.payableAccount(payout.payeeType, payout.payeeId), debit: payout.amountPaise }, { account: Accounts.nodal, credit: payout.amountPaise }],
      });
      await this.notifications.enqueue(tx, payout.payeeId, 'payout_sent', { amount: formatINR(payout.amountPaise), code: order.code }, `payout-sms:${payout.id}`);
      return tx.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSED', statusNote: null, gatewayTransferId: transferId } });
    } catch (e) {
      // A failed transfer leaves the payable standing; nothing is lost, and an admin retries from the console.
      await this.alerts.raise(tx, 'PAYOUT_FAILED', `Payout to ${payout.payeeType} on ${order.code} failed: ${(e as Error).message}`, order.id, { payoutId: payout.id });
      return tx.payout.update({ where: { id: payout.id }, data: { status: 'FAILED', statusNote: (e as Error).message } });
    }
  }

  /** Admin retry for BLOCKED/FAILED payouts, and what runs when a farmer's bank name gets approved. */
  async retryPayout(payoutId: string) {
    return this.prisma.tx(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id: payoutId }, include: { order: true } });
      if (!p) throw new NotFoundException('Payout not found');
      if (p.status === 'PROCESSED' || p.status === 'PENDING') throw new ConflictException('Payout is not retryable');
      const { fundAccountId, blockedReason } = await this.payeeAccount(tx, p.payeeType, p.payeeId);
      if (blockedReason || !fundAccountId) return tx.payout.update({ where: { id: p.id }, data: { status: 'BLOCKED', statusNote: blockedReason } });
      await tx.payout.update({ where: { id: p.id }, data: { status: 'PENDING', statusNote: null } });
      return this.executePayout(tx, p.id, p.order, fundAccountId);
    });
  }
  async releaseBlockedFor(payeeId: string) {
    const blocked = await this.prisma.payout.findMany({ where: { payeeId, status: 'BLOCKED' } });
    for (const p of blocked) await this.retryPayout(p.id);
    return blocked.length;
  }

  // ---- Freight -----------------------------------------------------------------------------------------------------
  /** Runs only on digital PoD (the transition into DELIVERED). The partner gets freight net of platform markup. */
  private async releaseFreight(tx: Tx, order: Order) {
    if (order.logisticsMode !== 'PLATFORM') return;
    const trip = await tx.trip.findUniqueOrThrow({ where: { orderId: order.id } });
    if (!trip.partnerId) throw new ConflictException('Trip has no logistics partner');
    await this.ledger.post(tx, {
      key: `freight-release:${order.id}`, type: 'FREIGHT_RELEASE', orderId: order.id,
      lines: [
        { account: Accounts.escrow(order.id), debit: trip.finalFreightPaise },
        { account: Accounts.logisticsPayable(trip.partnerId), credit: trip.baseCostPaise },
        { account: Accounts.freightMarkup, credit: trip.markupPaise },
      ],
    });
    await this.pay(tx, order, 'LOGISTICS', trip.partnerId, trip.baseCostPaise, `freight:${order.id}`);
    await this.upsertInvoice(tx, order, 'LOGISTICS_PAYOUT', {
      distanceKm: trip.distanceMetres / 1000, ratePaisePerKm: trip.ratePaisePerKm, loadingFeePaise: trip.loadingFeePaise, baseCostPaise: trip.baseCostPaise, markupPaise: trip.markupPaise, finalFreightPaise: trip.finalFreightPaise, partnerId: trip.partnerId,
    });
  }

  /** Called when the inspector marks the job inspected: the fee share is owed from that moment. */
  async accrueInspectorFee(tx: Tx, order: Order, inspectorId: string) {
    const share = applyBps(order.inspectionFeePaise, await this.config.get('inspectorShareBps', tx));
    await this.ledger.post(tx, {
      key: `inspector-accrual:${order.id}`, type: 'INSPECTOR_ACCRUAL', orderId: order.id,
      lines: [{ account: Accounts.inspectorCost, debit: share }, { account: Accounts.inspectorPayable(inspectorId), credit: share }],
    });
    return share;
  }

  private async payInspector(tx: Tx, order: Order) {
    const insp = await tx.inspection.findUnique({ where: { orderId: order.id } });
    if (!insp?.inspectorId || insp.status !== 'INSPECTED') return;
    const owed = -(await this.ledger.balance(Accounts.inspectorPayable(insp.inspectorId), tx));
    const share = applyBps(order.inspectionFeePaise, await this.config.get('inspectorShareBps', tx));
    await this.pay(tx, order, 'INSPECTOR', insp.inspectorId, owed < share ? owed : share, `inspector:${order.id}`);
  }

  // ---- Settlement --------------------------------------------------------------------------------------------------
  private async settle(tx: Tx, order: Order) {
    if (order.buyerRefundPaise > 0n) await this.refundEscrow(tx, order, order.buyerRefundPaise, 'dispute');
    const insp = await tx.inspection.findUnique({ where: { orderId: order.id } });
    const waived = insp?.status === 'WAIVED_SELF_CERT' && (await this.config.get('waiveInspectionFeeOnSelfCert', tx));
    const fromFarmer = order.inspectionFeePayer === 'FARMER';
    const fee = waived ? 0n : order.inspectionFeePaise;
    const outstanding = await this.ledger.farmerOwes(order.farmerId, tx);
    const s = computeSettlement({ gmv: order.gmvPaise, commissionBps: order.commissionBps, inspectionFee: fee, inspectionFeeFromFarmer: fromFarmer, outstandingNegative: outstanding, buyerRefund: order.buyerRefundPaise });
    // A buyer-paid fee was collected on top of GMV (added to the balance tranche), so it leaves escrow in addition to net GMV.
    const buyerPaidFee = fromFarmer ? 0n : fee;
    const feeFromFarmer = s.netGmv - s.commission - s.farmerGross; // equals the fee unless a huge refund clamped the payout at zero
    await this.ledger.post(tx, {
      key: `settlement:${order.id}`, type: 'SETTLEMENT', orderId: order.id,
      lines: [
        { account: Accounts.escrow(order.id), debit: s.netGmv + buyerPaidFee },
        { account: Accounts.farmerPayable(order.farmerId), credit: s.farmerGross },
        { account: Accounts.commission, credit: s.commission },
        { account: Accounts.inspectionFee, credit: feeFromFarmer + buyerPaidFee },
      ],
    });
    if (s.negativeOffset > 0n) {
      await this.ledger.post(tx, {
        key: `negative-offset:${order.id}`, type: 'NEGATIVE_OFFSET', orderId: order.id, memo: 'Recovered from payout',
        lines: [{ account: Accounts.farmerPayable(order.farmerId), debit: s.negativeOffset }, { account: Accounts.farmerReceivable(order.farmerId), credit: s.negativeOffset }],
      });
    }
    await this.pay(tx, order, 'FARMER', order.farmerId, s.farmerPayout, `farmer:${order.id}`);
    await this.payInspector(tx, order);
    await tx.order.update({ where: { id: order.id }, data: { settledAt: this.clock.now() } });
    const breakdown = { gmvPaise: order.gmvPaise, buyerRefundPaise: order.buyerRefundPaise, netGmvPaise: s.netGmv, commissionPaise: s.commission, commissionBps: order.commissionBps, inspectionFeePaise: feeFromFarmer, negativeOffsetPaise: s.negativeOffset, farmerPayoutPaise: s.farmerPayout, quantityKg: order.quantityKg, pricePaisePerKg: order.pricePaisePerKg };
    await this.upsertInvoice(tx, order, 'BUYER_INVOICE', breakdown);
    await this.upsertInvoice(tx, order, 'FARMER_STATEMENT', breakdown);
    await this.sweep(tx, order.id, 'settlement');
    await this.closeVan(tx, order.id);
    const left = await this.ledger.escrowBalance(order.id, tx);
    if (left !== 0n) await this.alerts.raise(tx, 'OVERPAYMENT', `Order ${order.code} settled with ${left} paise still in escrow; refund it from the console`, order.id, { escrowPaise: left });
  }

  /**
   * Moves this order's share of the nodal balance to the platform: commission, fees and markup, less gateway fees and
   * inspector cost. Money still owed to someone (remaining escrow, blocked or failed payouts) stays in nodal.
   * A negative amount is the platform topping up, e.g. to cover the fee gap on a 100% refund.
   */
  private async sweep(tx: Tx, orderId: string, label: string) {
    const nodal = await this.ledger.nodalForOrder(orderId, tx);
    const escrow = await this.ledger.escrowBalance(orderId, tx);
    const held = await tx.payout.aggregate({ where: { orderId, status: { in: ['BLOCKED', 'FAILED', 'PENDING'] } }, _sum: { amountPaise: true } });
    const amount = nodal - escrow - (held._sum.amountPaise ?? 0n);
    if (amount === 0n) return;
    await this.ledger.post(tx, {
      key: `sweep:${orderId}:${label}`, type: 'PLATFORM_SWEEP', orderId,
      lines: amount > 0n ? [{ account: Accounts.platformCash, debit: amount }, { account: Accounts.nodal, credit: amount }] : [{ account: Accounts.nodal, debit: -amount }, { account: Accounts.platformCash, credit: -amount }],
    });
  }

  private async closeVan(tx: Tx, orderId: string) {
    const va = await tx.virtualAccount.findUnique({ where: { orderId } });
    if (!va || va.closedAt) return;
    try {
      await this.gateway.closeVirtualAccount(va.gatewayId);
      await tx.virtualAccount.update({ where: { id: va.id }, data: { closedAt: this.clock.now() } });
    } catch (e) { this.logger.warn(`Could not close VAN ${va.gatewayId}: ${(e as Error).message}`); }
  }

  // ---- Refunds -----------------------------------------------------------------------------------------------------
  /** Refunds against the original payments, oldest first. Keys include the reason, so a retry cannot refund twice. */
  async refundEscrow(tx: Tx, order: Pick<Order, 'id' | 'code'>, amount: bigint, reason: string) {
    let left = amount;
    const payments = await tx.gatewayPayment.findMany({ where: { virtualAccount: { orderId: order.id } }, orderBy: { createdAt: 'asc' } });
    for (const p of payments) {
      if (left <= 0n) break;
      const refundable = p.amountPaise - p.refundedPaise;
      if (refundable <= 0n) continue;
      const take = left < refundable ? left : refundable;
      const { refundId } = await this.gateway.refund({ idempotencyKey: `${order.id}_${p.id}_${reason}`, gatewayPaymentId: p.gatewayPaymentId, amountPaise: take });
      await tx.refund.create({ data: { orderId: order.id, gatewayPaymentId: p.gatewayPaymentId, gatewayRefundId: refundId, amountPaise: take, reason } });
      await tx.gatewayPayment.update({ where: { id: p.id }, data: { refundedPaise: p.refundedPaise + take } });
      await this.ledger.post(tx, {
        key: `refund:${refundId}`, type: 'REFUND', orderId: order.id, memo: reason,
        lines: [{ account: Accounts.escrow(order.id), debit: take }, { account: Accounts.nodal, credit: take }],
      });
      left -= take;
    }
    if (left > 0n) throw new ConflictException(`Could not refund ${left} paise: exceeds what was collected`);
  }

  private async refundAll(tx: Tx, order: Order, from: string) {
    let refund = await this.ledger.escrowBalance(order.id, tx);
    if (from === 'BUYER_DEFAULTED' && (await this.config.get('advanceForfeitureOnBuyerDefault', tx))) {
      // Off by default; legal review pending. When on, the received advance compensates the farmer instead of returning.
      const adv = await tx.tranche.findUnique({ where: { orderId_kind: { orderId: order.id, kind: 'ADVANCE' } } });
      const forfeited = adv && adv.receivedPaise < refund ? adv.receivedPaise : refund;
      await this.ledger.post(tx, {
        key: `forfeit:${order.id}`, type: 'ADVANCE_FORFEITURE', orderId: order.id,
        lines: [{ account: Accounts.escrow(order.id), debit: forfeited }, { account: Accounts.farmerPayable(order.farmerId), credit: forfeited }],
      });
      await this.pay(tx, order, 'FARMER', order.farmerId, forfeited, `forfeit:${order.id}`);
      refund -= forfeited;
    }
    if (refund > 0n) await this.refundEscrow(tx, order, refund, 'default');
    await tx.trip.updateMany({ where: { orderId: order.id, status: { in: ['OPEN', 'ACCEPTED'] } }, data: { status: 'CANCELLED' } });
    await this.payInspector(tx, order); // The inspector did the work regardless of what the farmer did next.
    await this.sweep(tx, order.id, 'refund');
    await this.closeVan(tx, order.id);
  }

  /**
   * Refund-bleed guardrail: the buyer got 100% back, but the gateway keeps its processing fee. That actual fee becomes a
   * negative balance on the defaulting farmer, recovered automatically from their next payouts.
   */
  private async postDefaultFee(tx: Tx, order: Order, from: string, payload: Record<string, unknown>) {
    if (from === 'RESOLVED' && payload.farmerFault === false) return;
    const fees = await tx.gatewayPayment.aggregate({ where: { virtualAccount: { orderId: order.id } }, _sum: { feePaise: true } });
    const fee = fees._sum.feePaise ?? 0n;
    await this.ledger.post(tx, {
      key: `default-fee:${order.id}`, type: 'DEFAULT_FEE_RECOVERY', orderId: order.id, memo: 'Gateway fee charged to defaulting farmer',
      lines: [{ account: Accounts.farmerReceivable(order.farmerId), debit: fee }, { account: Accounts.gatewayFee, credit: fee }],
    });
  }

  /** Admin: return excess or stranded escrow to the buyer. */
  async refundExcess(orderId: string, amount: bigint | null) {
    return this.prisma.tx(async (tx) => {
      const order = await this.engine.lock(tx, orderId);
      const escrow = await this.ledger.escrowBalance(orderId, tx);
      const excess = (await tx.gatewayPayment.aggregate({ where: { virtualAccount: { orderId } }, _sum: { excessPaise: true } }))._sum.excessPaise ?? 0n;
      const terminal = ['SETTLED', 'REFUNDED', 'CANCELLED'].includes(order.state);
      const limit = terminal ? escrow : excess < escrow ? excess : escrow;
      const take = amount ?? limit;
      if (take <= 0n || take > limit) throw new ConflictException(`Only ${limit} paise can be refunded on this order right now`);
      const seq = await tx.refund.count({ where: { orderId, reason: { startsWith: 'excess' } } });
      await this.refundEscrow(tx, order, take, `excess${seq}`);
      return { refundedPaise: take };
    });
  }

  // ---- Invoices ----------------------------------------------------------------------------------------------------
  private async upsertInvoice(tx: Tx, order: Pick<Order, 'id' | 'code'>, type: 'BUYER_INVOICE' | 'FARMER_STATEMENT' | 'LOGISTICS_PAYOUT', data: Record<string, unknown>) {
    const prefix = { BUYER_INVOICE: 'INV', FARMER_STATEMENT: 'STM', LOGISTICS_PAYOUT: 'LOG' }[type];
    const json = JSON.parse(JSON.stringify({ ...data, gstOnCommissionBps: await this.config.get('gstOnCommissionBps', tx) }, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
    await tx.invoice.upsert({ where: { orderId_type: { orderId: order.id, type } }, create: { number: `${prefix}-${order.code}`, orderId: order.id, type, data: json }, update: {} });
  }

  // ---- Reconciliation ----------------------------------------------------------------------------------------------
  /** Compares yesterday's (IST) ledger-side cash against the gateway; a mismatch raises an admin alert. */
  async reconcile(forDate?: string) {
    const date = forDate ?? istDateString(new Date(this.clock.now().getTime() - 86_400_000));
    const from = new Date(`${date}T00:00:00+05:30`);
    const to = new Date(from.getTime() + 86_400_000);
    const range = { gte: from, lt: to };
    const credits = await this.prisma.gatewayPayment.aggregate({ where: { createdAt: range }, _sum: { amountPaise: true } });
    const refunds = await this.prisma.refund.aggregate({ where: { createdAt: range }, _sum: { amountPaise: true } });
    const payouts = await this.prisma.payout.aggregate({ where: { updatedAt: range, status: 'PROCESSED' }, _sum: { amountPaise: true } });
    const ledgerIn = credits._sum.amountPaise ?? 0n;
    const ledgerOut = (refunds._sum.amountPaise ?? 0n) + (payouts._sum.amountPaise ?? 0n);
    const g = await this.gateway.totals(from, to);
    const matched = ledgerIn === g.inPaise && ledgerOut === g.outPaise;
    const trial = await this.ledger.trialBalance();
    const report = await this.prisma.reconciliationReport.upsert({
      where: { forDate: date },
      create: { forDate: date, ledgerInPaise: ledgerIn, gatewayInPaise: g.inPaise, ledgerOutPaise: ledgerOut, gatewayOutPaise: g.outPaise, matched: matched && trial === 0n, details: { gatewayTxnCount: g.count, trialBalancePaise: trial.toString() } },
      update: { ledgerInPaise: ledgerIn, gatewayInPaise: g.inPaise, ledgerOutPaise: ledgerOut, gatewayOutPaise: g.outPaise, matched: matched && trial === 0n, details: { gatewayTxnCount: g.count, trialBalancePaise: trial.toString() } },
    });
    if (!report.matched) await this.alerts.raise(this.prisma, 'RECONCILIATION_MISMATCH', `Reconciliation for ${date} does not match`, null, { ledgerIn, ledgerOut, gatewayIn: g.inPaise, gatewayOut: g.outPaise, trial });
    return report;
  }

  /** Mock mode: lets the dev mock bank record the gateway-side credit that reconciliation compares against. */
  get mockGateway(): MockPaymentGateway | null { return this.gateway instanceof MockPaymentGateway ? this.gateway : null; }
}
