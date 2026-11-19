/**
 * The heart of the system: ledger, outbox, alerts, durable timers and the order state-machine engine.
 * Domain modules depend on this; this depends on none of them. Side effects are registered by name at boot,
 * which is how the table in packages/shared drives behaviour without a dependency cycle.
 */
import { ConflictException, ForbiddenException, Global, Inject, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LedgerAccountType, Order, Prisma, SlaTimerKind } from '@prisma/client';
import { Actor, AlertKind, checkTransition, Effect, GuardContext, ORDER_TRANSITIONS, OrderState, Transition } from '@agrimate/shared';
import { SMS, SmsAdapter } from '../adapters/others';
import { Clock, CryptoService, env, PrismaService, Tx } from '../core/core';
import { renderTemplate } from '../notifications/templates';

export interface ActorRef { id: string | null; role: Actor }
export const SYSTEM_ACTOR: ActorRef = { id: null, role: 'SYSTEM' };

// ---- Ledger ------------------------------------------------------------------------------------------------------
export const Accounts = {
  nodal: 'gateway_nodal',
  escrow: (orderId: string) => `buyer_escrow:${orderId}`,
  farmerPayable: (id: string) => `farmer_payable:${id}`,
  farmerReceivable: (id: string) => `farmer_receivable:${id}`,
  logisticsPayable: (id: string) => `logistics_payable:${id}`,
  inspectorPayable: (id: string) => `inspector_payable:${id}`,
  commission: 'platform_commission',
  inspectionFee: 'inspection_fee',
  freightMarkup: 'platform_freight_markup',
  gatewayFee: 'gateway_fee',
  inspectorCost: 'inspector_cost',
  platformCash: 'platform_cash',
} as const;

const accountType = (code: string): LedgerAccountType => {
  const head = code.split(':')[0]!;
  if (['gateway_nodal', 'farmer_receivable', 'platform_cash'].includes(head)) return 'ASSET';
  if (['platform_commission', 'inspection_fee', 'platform_freight_markup'].includes(head)) return 'REVENUE';
  if (['gateway_fee', 'inspector_cost'].includes(head)) return 'EXPENSE';
  return 'LIABILITY';
};

export interface JournalLine { account: string; debit?: bigint; credit?: bigint }
export interface JournalInput { key: string; type: string; orderId?: string | null; memo?: string; lines: JournalLine[] }

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Posts a balanced journal exactly once: re-posting the same key is a no-op. */
  async post(tx: Tx, j: JournalInput): Promise<boolean> {
    const lines = j.lines
      .map((l) => ({ account: l.account, amount: (l.debit ?? 0n) - (l.credit ?? 0n) }))
      .filter((l) => l.amount !== 0n);
    const total = lines.reduce((s, l) => s + l.amount, 0n);
    if (total !== 0n) throw new Error(`Unbalanced journal ${j.type}/${j.key}: off by ${total} paise`);
    if (!lines.length) return false;
    if (await tx.journalEntry.findUnique({ where: { idempotencyKey: j.key } })) return false;
    const entry = await tx.journalEntry.create({ data: { idempotencyKey: j.key, type: j.type, orderId: j.orderId ?? null, memo: j.memo } });
    for (const l of lines) {
      const account = await tx.ledgerAccount.upsert({ where: { code: l.account }, create: { code: l.account, type: accountType(l.account) }, update: {} });
      await tx.ledgerPosting.create({ data: { journalId: entry.id, accountId: account.id, amountPaise: l.amount } });
    }
    return true;
  }

  /** Signed balance: debits positive, credits negative. */
  async balance(code: string, db: Tx | PrismaService = this.prisma): Promise<bigint> {
    const r = await db.ledgerPosting.aggregate({ where: { account: { code } }, _sum: { amountPaise: true } });
    return r._sum.amountPaise ?? 0n;
  }
  /** Escrow held for an order (a liability, so returned as a positive number). */
  async escrowBalance(orderId: string, db: Tx | PrismaService = this.prisma) { return -(await this.balance(Accounts.escrow(orderId), db)); }
  /** What a farmer owes the platform: their negative balance, as a positive number. */
  async farmerOwes(farmerId: string, db: Tx | PrismaService = this.prisma) { return this.balance(Accounts.farmerReceivable(farmerId), db); }
  async nodalForOrder(orderId: string, db: Tx | PrismaService = this.prisma): Promise<bigint> {
    const r = await db.ledgerPosting.aggregate({ where: { account: { code: Accounts.nodal }, journal: { orderId } }, _sum: { amountPaise: true } });
    return r._sum.amountPaise ?? 0n;
  }
  /** Sum across every posting; anything other than zero means the books are broken. */
  async trialBalance(db: Tx | PrismaService = this.prisma): Promise<bigint> {
    const r = await db.ledgerPosting.aggregate({ _sum: { amountPaise: true } });
    return r._sum.amountPaise ?? 0n;
  }
}

// ---- Notifications (outbox) --------------------------------------------------------------------------------------
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly clock: Clock, @Inject(SMS) private readonly sms: SmsAdapter) {}

  /** Written in the same transaction as the business change; sent later, so a rollback never texts anyone. */
  async enqueue(db: Tx | PrismaService, userId: string, template: string, params: Record<string, unknown> = {}, dedupeKey?: string) {
    const data = { userId, template, params: params as Prisma.InputJsonValue, dedupeKey };
    if (dedupeKey) await db.notificationOutbox.upsert({ where: { dedupeKey }, create: data, update: {} });
    else await db.notificationOutbox.create({ data });
  }

  /** Drains pending messages. Safe to run repeatedly; a message is retried up to 5 times. */
  async flush(limit = 100): Promise<number> {
    const batch = await this.prisma.notificationOutbox.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: limit });
    let sent = 0;
    for (const m of batch) {
      const claimed = await this.prisma.notificationOutbox.updateMany({ where: { id: m.id, status: 'PENDING', attempts: m.attempts }, data: { attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
        await this.sms.send(this.crypto.decrypt(user.phoneEnc), renderTemplate(m.template, user.language, m.params as Record<string, unknown>));
        await this.prisma.notificationOutbox.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: this.clock.now() } });
        sent++;
      } catch (e) {
        const failed = m.attempts + 1 >= 5;
        await this.prisma.notificationOutbox.update({ where: { id: m.id }, data: { lastError: (e as Error).message, ...(failed ? { status: 'FAILED' as const } : {}) } });
        this.logger.warn(`Outbox ${m.id} attempt ${m.attempts + 1} failed`);
      }
    }
    return sent;
  }
}

// ---- Admin alerts ------------------------------------------------------------------------------------------------
@Injectable()
export class AlertsService {
  raise(db: Tx | PrismaService, kind: AlertKind, message: string, orderId?: string | null, data: Record<string, unknown> = {}) {
    return db.adminAlert.create({ data: { kind, message, orderId: orderId ?? null, data: JSON.parse(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) } });
  }
}

// ---- Jobs --------------------------------------------------------------------------------------------------------
type JobHandler = () => Promise<unknown>;
type JobSchedule = { every: number } | { dailyIst: { hour: number; minute: number } };
const DAILY_CHECK_MS = 5 * 60_000;
const IST_OFFSET_MS = 330 * 60_000;
/**
 * Background work, driven from Postgres so that nothing beyond the database is needed. Every handler acts on durable,
 * idempotent DB state. A slow run is never overlapped by the next tick. Daily jobs claim a row per job and IST day, so
 * they run once across instances and still run after downtime. JOBS_ENABLED=false (tests) leaves all of this to the test.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly jobs: { name: string; handler: JobHandler; schedule: JobSchedule }[] = [];
  private readonly intervals: NodeJS.Timeout[] = [];
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  repeat(name: string, handler: JobHandler, schedule: JobSchedule) { this.jobs.push({ name, handler, schedule }); }

  /** Called after every module has registered its handlers. */
  startSchedules() {
    if (!env.jobsEnabled) return;
    for (const job of this.jobs) {
      const { schedule } = job;
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try { await ('every' in schedule ? job.handler() : this.runDailyIfDue(job.name, job.handler, schedule.dailyIst)); }
        catch (e) { this.logger.error(`Job ${job.name} failed: ${(e as Error).message}`); }
        finally { running = false; }
      };
      this.intervals.push(setInterval(() => void tick(), 'every' in schedule ? schedule.every : DAILY_CHECK_MS));
      void tick();
    }
  }

  /** The row is released if the job fails, so that it is tried again at the next check rather than lost for the day. */
  async runDailyIfDue(name: string, handler: JobHandler, at: { hour: number; minute: number }) {
    const ist = new Date(this.clock.now().getTime() + IST_OFFSET_MS);
    if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < at.hour * 60 + at.minute) return false;
    const forDate = ist.toISOString().slice(0, 10);
    const claim = await this.prisma.jobClaim.createMany({ data: [{ name, forDate }], skipDuplicates: true });
    if (claim.count === 0) return false;
    try { await handler(); return true; }
    catch (e) { await this.prisma.jobClaim.delete({ where: { name_forDate: { name, forDate } } }); throw e; }
  }

  onModuleDestroy() { this.intervals.forEach(clearInterval); }
}

// ---- Durable timers ------------------------------------------------------------------------------------------------
export type TimerHandler = (tx: Tx, order: Order, kind: SlaTimerKind) => Promise<void>;
@Injectable()
export class TimerService {
  private readonly logger = new Logger('Timers');
  private readonly handlers = new Map<SlaTimerKind, TimerHandler>();
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}
  onFire(kind: SlaTimerKind, h: TimerHandler) { this.handlers.set(kind, h); }

  /** The row is the whole timer: the sla-sweep job fires it within seconds of falling due. */
  async schedule(tx: Tx, orderId: string, kind: SlaTimerKind, fireAt: Date) {
    return tx.slaTimer.create({ data: { orderId, kind, fireAt } });
  }
  cancelAll(tx: Tx, orderId: string, kinds?: SlaTimerKind[]) {
    return tx.slaTimer.updateMany({ where: { orderId, status: 'PENDING', ...(kinds ? { kind: { in: kinds } } : {}) }, data: { status: 'CANCELLED' } });
  }
  /** Fires one timer at most once, however many workers race for it. */
  async fire(timerId: string) {
    return this.prisma.tx(async (tx) => {
      const claimed = await tx.slaTimer.updateMany({ where: { id: timerId, status: 'PENDING', fireAt: { lte: this.clock.now() } }, data: { status: 'FIRED', firedAt: this.clock.now() } });
      if (!claimed.count) return false;
      const t = await tx.slaTimer.findUniqueOrThrow({ where: { id: timerId }, include: { order: true } });
      await this.handlers.get(t.kind)?.(tx, t.order, t.kind);
      return true;
    });
  }
  /** Runs on a short interval. Each timer claims itself, so overlapping sweeps can't double-fire one. */
  async fireDue(limit = 200): Promise<number> {
    const due = await this.prisma.slaTimer.findMany({ where: { status: 'PENDING', fireAt: { lte: this.clock.now() } }, orderBy: { fireAt: 'asc' }, take: limit });
    let fired = 0;
    for (const t of due) {
      try { if (await this.fire(t.id)) fired++; } catch (e) { this.logger.error(`Timer ${t.id} (${t.kind}) failed: ${(e as Error).message}`); }
    }
    return fired;
  }
}

// ---- Order engine --------------------------------------------------------------------------------------------------
export interface EffectContext { tx: Tx; order: Order; transition: Transition; actor: ActorRef; payload: Record<string, unknown> }
export type EffectHandler = (c: EffectContext) => Promise<void>;

@Injectable()
export class OrderEngine {
  private readonly effects = new Map<Effect, EffectHandler>();
  constructor(private readonly clock: Clock, notifications: NotificationsService, alerts: AlertsService, timers: TimerService) {
    this.register('NOTIFY_PARTIES', async ({ tx, order, transition }) => {
      const params = { code: order.code, state: transition.to };
      for (const uid of [order.buyerId, order.farmerId]) await notifications.enqueue(tx, uid, 'order_state', params);
    });
    this.register('CANCEL_TIMERS', async ({ tx, order }) => { await timers.cancelAll(tx, order.id); });
    this.register('ALERT_ADMIN', async ({ tx, order, transition }) => {
      await alerts.raise(tx, transition.to === 'BUYER_DEFAULTED' ? 'BUYER_DEFAULT' : 'SLA_BREACH', `Order ${order.code} moved to ${transition.to}`, order.id);
    });
  }
  register(effect: Effect, h: EffectHandler) { this.effects.set(effect, h); }

  /** Row lock serialises everything that can touch one order, e.g. a webhook racing a user action. */
  async lock(tx: Tx, orderId: string): Promise<Order> {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  async guardContext(tx: Tx, o: Order): Promise<GuardContext> {
    const [tranches, inspection, selfCert, openDisputes, pendingSpot] = await Promise.all([
      tx.tranche.findMany({ where: { orderId: o.id } }),
      tx.inspection.findUnique({ where: { orderId: o.id } }),
      tx.selfCertification.findUnique({ where: { orderId: o.id } }),
      tx.dispute.count({ where: { orderId: o.id, status: 'OPEN' } }),
      tx.spotTest.count({ where: { orderId: o.id, status: 'REQUESTED' } }),
    ]);
    const paid = (k: string) => tranches.some((t) => t.kind === k && t.status === 'PAID');
    return {
      advancePaid: paid('ADVANCE'), balancePaid: paid('BALANCE'), freightPaid: paid('FREIGHT'),
      logisticsMode: o.logisticsMode,
      inspected: inspection?.status === 'INSPECTED',
      selfCertified: !!selfCert?.submittedAt,
      podCaptured: !!o.deliveredAt,
      allDisputesResolved: openDisputes === 0,
      pendingSpotTests: pendingSpot,
      disputeWindowElapsed: !!o.disputeDeadlineAt && o.disputeDeadlineAt.getTime() <= this.clock.now().getTime(),
    };
  }

  private async apply(tx: Tx, o: Order, transition: Transition, actor: ActorRef, payload: Record<string, unknown>) {
    // The guarded update is a second line of defence behind the row lock.
    const updated = await tx.order.updateMany({ where: { id: o.id, state: o.state }, data: { state: transition.to } });
    if (!updated.count) throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Order changed while processing' });
    await tx.orderEvent.create({
      data: { orderId: o.id, actorId: actor.id, actorRole: actor.role, from: o.state, to: transition.to, payload: JSON.parse(JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) },
    });
    const fresh = { ...o, state: transition.to };
    for (const name of transition.effects ?? []) {
      const h = this.effects.get(name);
      if (!h) throw new Error(`No handler registered for effect ${name}`);
      await h({ tx, order: fresh, transition, actor, payload });
    }
  }

  /** The only way an order's state ever changes. Illegal or guard-failed moves are 409; wrong actor is 403. */
  async transition(tx: Tx, orderId: string, to: OrderState, actor: ActorRef, payload: Record<string, unknown> = {}): Promise<Order> {
    const o = await this.lock(tx, orderId);
    const check = checkTransition(o.state as OrderState, to, actor.role, await this.guardContext(tx, o));
    if (!check.ok) {
      if (check.code === 'ACTOR_NOT_ALLOWED') throw new ForbiddenException({ code: check.code, message: check.reason });
      throw new ConflictException({ code: check.code, message: check.reason });
    }
    await this.apply(tx, o, check.transition, actor, payload);
    return this.advance(tx, orderId);
  }

  /** Runs every auto transition whose guards now pass. Call after anything that may have satisfied a guard. */
  async advance(tx: Tx, orderId: string): Promise<Order> {
    for (let hops = 0; hops < 25; hops++) {
      const o = await this.lock(tx, orderId);
      const ctx = await this.guardContext(tx, o);
      const next = ORDER_TRANSITIONS.find((t) => t.auto && t.from === o.state && checkTransition(o.state as OrderState, t.to, 'SYSTEM', ctx).ok);
      if (!next) return o;
      await this.apply(tx, o, next, SYSTEM_ACTOR, { auto: true });
    }
    throw new Error(`Auto-transition loop on order ${orderId}`);
  }
}

@Global()
@Module({
  providers: [LedgerService, NotificationsService, AlertsService, JobsService, TimerService, OrderEngine],
  exports: [LedgerService, NotificationsService, AlertsService, JobsService, TimerService, OrderEngine],
})
export class EngineModule {}
