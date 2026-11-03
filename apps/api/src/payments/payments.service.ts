/**
 * Collection side of escrow: issues a VAN per order, turns gateway credits into tranche payments and ledger entries.
 * Replays are harmless: GatewayPayment.gatewayPaymentId is unique and the whole credit is one transaction.
 */
import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Prisma, Tranche } from '@prisma/client';
import { Clock, CryptoService, PrismaService, Tx } from '../core/core';
import { Accounts, AlertsService, LedgerService, OrderEngine } from '../engine/engine';
import { CreditEvent, PAYMENT_GATEWAY, PaymentGateway } from '../adapters/payments';
import { TERMINAL_STATES, OrderState } from '@agrimate/shared';

export interface Allocation { trancheId: string; kind: string; amount: bigint }
const ORDER: Record<string, number> = { ADVANCE: 0, FREIGHT: 1, BALANCE: 2 };

/**
 * Decides which open tranches a credit pays. Pure, so every branch is unit-tested.
 * 1. Exact match on one tranche. 2. Exact match on all open tranches together.
 * 3. Otherwise waterfall in priority order; anything left over is excess.
 */
export function allocateCredit(amount: bigint, tranches: Pick<Tranche, 'id' | 'kind' | 'expectedPaise' | 'receivedPaise'>[]) {
  const open = tranches
    .map((t) => ({ t, remaining: t.expectedPaise - t.receivedPaise }))
    .filter((x) => x.remaining > 0n)
    .sort((a, b) => ORDER[a.t.kind]! - ORDER[b.t.kind]!);
  const alloc = (t: (typeof open)[number]['t'], a: bigint): Allocation => ({ trancheId: t.id, kind: t.kind, amount: a });
  const exact = open.find((x) => x.remaining === amount);
  if (exact) return { allocations: [alloc(exact.t, amount)], excess: 0n, shortfall: false };
  const totalOpen = open.reduce((s, x) => s + x.remaining, 0n);
  if (open.length && totalOpen === amount) return { allocations: open.map((x) => alloc(x.t, x.remaining)), excess: 0n, shortfall: false };
  const allocations: Allocation[] = [];
  let left = amount; let shortfall = false;
  for (const x of open) {
    if (left <= 0n) break;
    const take = left < x.remaining ? left : x.remaining;
    allocations.push(alloc(x.t, take));
    if (take < x.remaining) shortfall = true;
    left -= take;
  }
  return { allocations, excess: left, shortfall };
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger('Payments');
  constructor(
    private readonly prisma: PrismaService, private readonly clock: Clock, private readonly engine: OrderEngine, private readonly ledger: LedgerService,
    private readonly alerts: AlertsService, private readonly crypto: CryptoService, @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    this.engine.register('ISSUE_VAN', async ({ tx, order }) => {
      const buyer = await tx.buyerProfile.findUniqueOrThrow({ where: { userId: order.buyerId } });
      const d = await this.gateway.createVirtualAccount({ orderId: order.id, orderCode: order.code, expectedPaise: order.gmvPaise, customerName: buyer.companyName });
      await tx.virtualAccount.create({ data: { orderId: order.id, gatewayId: d.gatewayId, ifsc: d.ifsc, accountNumber: d.accountNumber, beneficiary: d.beneficiary } });
    });
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined) {
    if (!rawBody) throw new BadRequestException('Missing body');
    if (!this.gateway.verifyWebhookSignature(rawBody, signature)) throw new UnauthorizedException('Invalid webhook signature');
    const parsed = this.gateway.parseWebhook(rawBody, eventIdHeader);
    if (!parsed.credit) return { status: 'ignored', type: parsed.type };
    return this.applyCredit(parsed.credit, parsed.raw);
  }

  async applyCredit(c: CreditEvent, raw: unknown) {
    if (c.amountPaise <= 0n) throw new BadRequestException('Credit amount must be positive');
    try {
      return await this.prisma.tx((tx) => this.creditInTx(tx, c, raw));
    } catch (e) {
      // Unique violation on gatewayPaymentId: this credit was already applied, so a replay changes nothing.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.log(`Duplicate credit ${c.gatewayPaymentId} ignored`);
        return { status: 'duplicate' };
      }
      throw e;
    }
  }

  private async creditInTx(tx: Tx, c: CreditEvent, raw: unknown) {
    const rawJson = JSON.parse(JSON.stringify(raw ?? {})) as Prisma.InputJsonValue;
    const va = await tx.virtualAccount.findUnique({ where: { gatewayId: c.virtualAccountGatewayId } });
    if (!va) {
      await tx.gatewayPayment.create({ data: { gatewayPaymentId: c.gatewayPaymentId, amountPaise: c.amountPaise, feePaise: c.feePaise, excessPaise: c.amountPaise, payerBankRef: c.bankRef, raw: rawJson } });
      await this.alerts.raise(tx, 'UNMATCHED_PAYMENT', `Credit ${c.gatewayPaymentId} matches no virtual account`, null, { amountPaise: c.amountPaise });
      return { status: 'unmatched' };
    }
    const order = await this.engine.lock(tx, va.orderId);
    const closed = TERMINAL_STATES.includes(order.state as OrderState) || ['FARMER_DEFAULTED', 'BUYER_DEFAULTED'].includes(order.state);
    const tranches = await tx.tranche.findMany({ where: { orderId: order.id } });
    // Money arriving on a dead order is never applied to a tranche; it waits as excess for an admin refund.
    const plan = closed ? { allocations: [] as Allocation[], excess: c.amountPaise, shortfall: false } : allocateCredit(c.amountPaise, tranches);
    const now = this.clock.now();
    await tx.gatewayPayment.create({ data: { virtualAccountId: va.id, gatewayPaymentId: c.gatewayPaymentId, amountPaise: c.amountPaise, feePaise: c.feePaise, excessPaise: plan.excess, payerBankRef: c.bankRef, raw: rawJson } });

    await this.ledger.post(tx, {
      key: `credit:${c.gatewayPaymentId}`, type: 'TRANCHE_CREDIT', orderId: order.id, memo: plan.allocations.map((a) => a.kind).join('+') || 'EXCESS',
      lines: [{ account: Accounts.nodal, debit: c.amountPaise }, { account: Accounts.escrow(order.id), credit: c.amountPaise }],
    });
    if (c.feePaise > 0n) {
      await this.ledger.post(tx, {
        key: `credit-fee:${c.gatewayPaymentId}`, type: 'GATEWAY_FEE', orderId: order.id,
        lines: [{ account: Accounts.gatewayFee, debit: c.feePaise }, { account: Accounts.nodal, credit: c.feePaise }],
      });
    }

    let freightPaid = false;
    for (const a of plan.allocations) {
      const t = tranches.find((x) => x.id === a.trancheId)!;
      const received = t.receivedPaise + a.amount;
      const paid = received >= t.expectedPaise;
      await tx.tranche.update({ where: { id: t.id }, data: { receivedPaise: received, status: paid ? 'PAID' : 'PARTIAL', paidAt: paid ? now : null } });
      if (paid && t.kind === 'FREIGHT') freightPaid = true;
    }
    if (freightPaid) await tx.trip.updateMany({ where: { orderId: order.id, fundedAt: null }, data: { fundedAt: now } });
    if (plan.shortfall) await this.alerts.raise(tx, 'UNDERPAYMENT', `Order ${order.code}: credit of ${c.amountPaise} paise left a tranche part-paid`, order.id, { paymentId: c.gatewayPaymentId });
    if (plan.excess > 0n) await this.alerts.raise(tx, 'OVERPAYMENT', `Order ${order.code}: ${plan.excess} paise above what is due; held in escrow for refund`, order.id, { paymentId: c.gatewayPaymentId, excessPaise: plan.excess });

    const after = await this.engine.advance(tx, order.id);
    return { status: 'applied', orderState: after.state, allocations: plan.allocations.map((a) => ({ kind: a.kind, amountPaise: a.amount.toString() })), excessPaise: plan.excess.toString() };
  }
}
