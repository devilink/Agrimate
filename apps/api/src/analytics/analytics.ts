/** Read-only aggregates behind the dashboards. Scoped by role in one place, so a buyer or farmer only ever sees their own orders. */
import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderState, Prisma } from '@prisma/client';
import { applyBps, istDateString } from '@agrimate/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/auth';
import { Clock, PrismaService } from '../core/core';

const DAY_MS = 86_400_000;
const ALLOWED_DAYS = [7, 30, 90, 365];
const MAX_GRAPH_ORDERS = 400;
const MAX_GRAPH_NODES = 80;

/** The order journey in the order a reader expects it, grouped into stages people recognise. */
const STAGES: { key: string; label: string; states: OrderState[] }[] = [
  { key: 'funding', label: 'Awaiting advance', states: ['MATCHED', 'AWAITING_ADVANCE'] },
  { key: 'logistics', label: 'Arranging transport', states: ['ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE'] },
  { key: 'quality', label: 'Quality check', states: ['FULLY_FUNDED', 'INSPECTION_SCHEDULED'] },
  { key: 'ready', label: 'Ready to move', states: ['INSPECTED', 'SELF_CERTIFIED'] },
  { key: 'transit', label: 'In transit', states: ['IN_TRANSIT'] },
  { key: 'window', label: 'Delivered', states: ['DELIVERED', 'DISPUTE_WINDOW'] },
  { key: 'disputed', label: 'In dispute', states: ['DISPUTED', 'RESOLVED'] },
];
const ACTIVE_STATES = STAGES.flatMap((s) => s.states);
const OUTCOMES: { key: string; label: string; states: OrderState[] }[] = [
  { key: 'settled', label: 'Settled', states: ['SETTLED'] },
  { key: 'refunded', label: 'Refunded', states: ['REFUNDED'] },
  { key: 'cancelled', label: 'Cancelled', states: ['CANCELLED'] },
  { key: 'defaulted', label: 'Defaulted', states: ['BUYER_DEFAULTED', 'FARMER_DEFAULTED'] },
];
const DEPARTED_OR_LATER: OrderState[] = ['IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW', 'DISPUTED', 'RESOLVED', 'SETTLED'];

const rate = (ok: number, sample: number) => ({ value: sample ? Math.round((ok / sample) * 1000) / 10 : null, ok, sample });
const parseDays = (raw?: string) => {
  const days = raw === undefined ? 30 : Number(raw);
  if (!ALLOWED_DAYS.includes(days)) throw new BadRequestException(`days must be one of ${ALLOWED_DAYS.join(', ')}`);
  return days;
};
/** Keeps the largest rows and folds the rest, so that charts stay readable and colours never run out. */
function topWithOther<T extends { name: string; gmvPaise: bigint; orders: number }>(rows: T[], keep: number) {
  const sorted = [...rows].sort((a, b) => (a.gmvPaise === b.gmvPaise ? 0 : a.gmvPaise > b.gmvPaise ? -1 : 1));
  const head = sorted.slice(0, keep).map((r) => ({ name: r.name, gmvPaise: r.gmvPaise, orders: r.orders }));
  const tail = sorted.slice(keep);
  if (tail.length) head.push({ name: `Other (${tail.length})`, gmvPaise: tail.reduce((s, r) => s + r.gmvPaise, 0n), orders: tail.reduce((s, r) => s + r.orders, 0) });
  return head;
}

type NodeType = 'BUYER' | 'FARMER' | 'COMMODITY' | 'STATE' | 'INSPECTOR' | 'TRANSPORTER';
interface GraphNode { id: string; type: NodeType; label: string; gmvPaise: bigint; orderCount: number; flagged: boolean; orders: { id: string; code: string; state: string }[] }
interface GraphLink { source: string; target: string; kind: string; orderCount: number; gmvPaise: bigint }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  private scope(u: AuthUser): Prisma.OrderWhereInput {
    if (u.role === 'ADMIN') return {};
    return u.role === 'BUYER' ? { buyerId: u.id } : { farmerId: u.id };
  }

  private async escrowPaise(u: AuthUser): Promise<bigint> {
    const filter = u.role === 'ADMIN' ? Prisma.empty : u.role === 'BUYER' ? Prisma.sql`AND o."buyerId" = ${u.id}` : Prisma.sql`AND o."farmerId" = ${u.id}`;
    const [row] = await this.prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(-p."amountPaise"), 0)::text AS total
      FROM "LedgerPosting" p JOIN "LedgerAccount" a ON a.id = p."accountId" JOIN "Order" o ON a.code = 'buyer_escrow:' || o.id
      WHERE true ${filter}`;
    return BigInt(row!.total);
  }

  async summary(u: AuthUser, rawDays?: string) {
    const days = parseDays(rawDays);
    const now = this.clock.now();
    const since = new Date(now.getTime() - days * DAY_MS);
    const before = new Date(since.getTime() - days * DAY_MS);
    const scope = this.scope(u);
    const inPeriod: Prisma.OrderWhereInput = { ...scope, createdAt: { gte: since } };

    const [orders, previous, byState, escrowPaise, unpaid, payouts] = await Promise.all([
      this.prisma.order.findMany({
        where: inPeriod,
        select: {
          id: true, state: true, gmvPaise: true, quantityKg: true, createdAt: true, commissionBps: true, buyerRefundPaise: true, inspectionFeePaise: true, slaDeadlineAt: true, deliveredAt: true,
          commodity: { select: { name: true } }, farmer: { select: { state: true } }, inspection: { select: { status: true } }, trip: { select: { finalFreightPaise: true, pickedUpAt: true } },
          disputes: { select: { id: true } }, events: { where: { to: 'IN_TRANSIT' }, select: { createdAt: true }, take: 1 },
        },
      }),
      this.prisma.order.aggregate({ where: { ...scope, createdAt: { gte: before, lt: since }, state: { not: 'CANCELLED' } }, _sum: { gmvPaise: true }, _count: true }),
      this.prisma.order.groupBy({ by: ['state'], where: { ...scope, state: { in: ACTIVE_STATES } }, _count: true }),
      this.escrowPaise(u),
      u.role === 'FARMER' ? Promise.resolve([]) : this.prisma.tranche.findMany({ where: { status: { not: 'PAID' }, order: { ...scope, state: { in: ACTIVE_STATES } } }, select: { expectedPaise: true, receivedPaise: true } }),
      u.role === 'BUYER' ? Promise.resolve([]) : this.prisma.payout.findMany({ where: { createdAt: { gte: since }, ...(u.role === 'FARMER' ? { payeeType: 'FARMER' as const, payeeId: u.id } : {}) }, select: { payeeType: true, status: true, amountPaise: true } }),
    ]);

    const trendMap = new Map<string, { date: string; gmvPaise: bigint; orders: number }>();
    for (let i = days - 1; i >= 0; i--) { const date = istDateString(new Date(now.getTime() - i * DAY_MS)); trendMap.set(date, { date, gmvPaise: 0n, orders: 0 }); }
    const commodities = new Map<string, { name: string; gmvPaise: bigint; orders: number }>();
    const regions = new Map<string, { name: string; gmvPaise: bigint; orders: number }>();
    const bump = (m: Map<string, { name: string; gmvPaise: bigint; orders: number }>, name: string, gmv: bigint) => { const r = m.get(name) ?? { name, gmvPaise: 0n, orders: 0 }; r.gmvPaise += gmv; r.orders++; m.set(name, r); };

    let gmvPaise = 0n; let quantityKg = 0; let cancelledNoFunds = 0;
    let slaMet = 0; let slaKnown = 0; let passed = 0; let inspected = 0; let delivered = 0; let disputed = 0; let finished = 0; let settled = 0;
    let commissionPaise = 0n; let inspectionFeesPaise = 0n; let freightPaise = 0n; let goodsPaise = 0n;

    for (const o of orders) {
      if (o.state === 'CANCELLED') { cancelledNoFunds++; } else { gmvPaise += o.gmvPaise; quantityKg += o.quantityKg; }
      const day = trendMap.get(istDateString(o.createdAt));
      if (day && o.state !== 'CANCELLED') { day.gmvPaise += o.gmvPaise; day.orders++; }
      if (o.state !== 'CANCELLED') { bump(commodities, o.commodity.name, o.gmvPaise); bump(regions, o.farmer.state ?? 'Unknown', o.gmvPaise); }

      if (o.slaDeadlineAt) {
        const departedAt = o.trip?.pickedUpAt ?? o.events[0]?.createdAt;
        if (departedAt) { slaKnown++; if (departedAt <= o.slaDeadlineAt) slaMet++; }
        else if (o.slaDeadlineAt < now && !DEPARTED_OR_LATER.includes(o.state) && ACTIVE_STATES.includes(o.state)) slaKnown++;
      }
      if (o.inspection?.status === 'INSPECTED') { inspected++; passed++; } else if (o.inspection?.status === 'FAILED_GRADE') inspected++;
      if (o.deliveredAt) { delivered++; if (o.disputes.length) disputed++; }
      if (OUTCOMES.some((x) => x.states.includes(o.state))) { finished++; if (o.state === 'SETTLED') settled++; }
      if (o.state === 'SETTLED') {
        const net = o.gmvPaise - o.buyerRefundPaise;
        goodsPaise += net; commissionPaise += applyBps(net, o.commissionBps); inspectionFeesPaise += o.inspectionFeePaise;
        freightPaise += o.trip?.finalFreightPaise ?? 0n;
      }
    }
    const sumPayouts = (t: string) => payouts.filter((p) => p.payeeType === t && p.status === 'PROCESSED').reduce((s, p) => s + p.amountPaise, 0n);
    const payoutsDone = payouts.filter((p) => p.status === 'PROCESSED').length;
    const payoutsSettled = payouts.filter((p) => p.status !== 'PENDING').length;

    const counts = new Map(byState.map((s) => [s.state, s._count]));
    const pipeline = STAGES.map((s) => ({ key: s.key, label: s.label, states: s.states, count: s.states.reduce((n, st) => n + (counts.get(st) ?? 0), 0) }));
    const outcomes = OUTCOMES.map((x) => ({ key: x.key, label: x.label, count: orders.filter((o) => x.states.includes(o.state)).length }));

    const split = u.role === 'ADMIN'
      ? [{ key: 'farmers', label: 'Paid to farmers', paise: sumPayouts('FARMER') }, { key: 'transport', label: 'Paid to transport', paise: sumPayouts('LOGISTICS') }, { key: 'inspectors', label: 'Paid to inspectors', paise: sumPayouts('INSPECTOR') }, { key: 'commission', label: 'Platform commission', paise: commissionPaise }]
      : u.role === 'BUYER'
        ? [{ key: 'goods', label: 'Produce', paise: goodsPaise }, { key: 'freight', label: 'Freight', paise: freightPaise }]
        : [{ key: 'received', label: 'Received by you', paise: sumPayouts('FARMER') }, { key: 'commission', label: 'Commission', paise: commissionPaise }, { key: 'inspection', label: 'Inspection fee', paise: inspectionFeesPaise }];

    return {
      role: u.role, days, generatedAt: now.toISOString(),
      kpis: {
        gmvPaise, previousGmvPaise: previous._sum.gmvPaise ?? 0n, orders: orders.length - cancelledNoFunds, previousOrders: previous._count, quantityKg, activeOrders: pipeline.reduce((n, s) => n + s.count, 0), escrowPaise,
        duePaise: unpaid.reduce((s, t) => s + (t.expectedPaise - t.receivedPaise), 0n), receivedPaise: sumPayouts('FARMER'), ...(u.role === 'ADMIN' ? { commissionPaise } : {}),
      },
      dials: {
        slaOnTime: rate(slaMet, slaKnown), qualityPass: rate(passed, inspected), disputeFree: rate(delivered - disputed, delivered), completion: rate(settled, finished),
        ...(u.role === 'BUYER' ? {} : { payoutSuccess: rate(payoutsDone, payoutsSettled) }),
      },
      trend: [...trendMap.values()], pipeline, outcomes, split,
      commodities: topWithOther([...commodities.values()], 7), regions: topWithOther([...regions.values()], 7),
    };
  }

  /** Who trades what with whom, weighted by value. Buyers and farmers get their own network only, and no inspector or transporter names. */
  async graph(u: AuthUser, rawDays?: string) {
    const days = parseDays(rawDays ?? '90');
    const since = new Date(this.clock.now().getTime() - days * DAY_MS);
    const showStaff = u.role === 'ADMIN';
    const orders = await this.prisma.order.findMany({
      where: { ...this.scope(u), createdAt: { gte: since }, state: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: MAX_GRAPH_ORDERS,
      select: {
        id: true, code: true, state: true, gmvPaise: true, buyerId: true, farmerId: true, commodityId: true,
        commodity: { select: { name: true } }, buyer: { select: { companyName: true } }, farmer: { select: { state: true, user: { select: { name: true } } } },
        inspection: { select: { inspectorId: true, inspector: { select: { user: { select: { name: true } } } } } },
        trip: { select: { partnerId: true, partner: { select: { companyName: true, user: { select: { name: true } } } } } },
        disputes: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });

    const nodes = new Map<string, GraphNode>();
    const links = new Map<string, GraphLink>();
    const touch = (id: string, type: NodeType, label: string, o: (typeof orders)[number]) => {
      const n = nodes.get(id) ?? { id, type, label, gmvPaise: 0n, orderCount: 0, flagged: false, orders: [] };
      n.gmvPaise += o.gmvPaise; n.orderCount++; n.flagged ||= o.disputes.length > 0;
      if (n.orders.length < 5) n.orders.push({ id: o.id, code: o.code, state: o.state });
      nodes.set(id, n);
      return id;
    };
    const link = (source: string, target: string, kind: string, o: (typeof orders)[number]) => {
      const key = `${source}|${target}|${kind}`;
      const l = links.get(key) ?? { source, target, kind, orderCount: 0, gmvPaise: 0n };
      l.orderCount++; l.gmvPaise += o.gmvPaise;
      links.set(key, l);
    };

    for (const o of orders) {
      const buyer = touch(`buyer:${o.buyerId}`, 'BUYER', o.buyer.companyName, o);
      const farmer = touch(`farmer:${o.farmerId}`, 'FARMER', o.farmer.user.name, o);
      const commodity = touch(`commodity:${o.commodityId}`, 'COMMODITY', o.commodity.name, o);
      link(buyer, commodity, 'BUYS', o);
      link(farmer, commodity, 'SUPPLIES', o);
      if (o.farmer.state) link(farmer, touch(`state:${o.farmer.state}`, 'STATE', o.farmer.state, o), 'GROWN_IN', o);
      if (showStaff && o.inspection?.inspectorId && o.inspection.inspector) link(touch(`inspector:${o.inspection.inspectorId}`, 'INSPECTOR', o.inspection.inspector.user.name, o), farmer, 'INSPECTS', o);
      if (showStaff && o.trip?.partnerId && o.trip.partner) link(touch(`transport:${o.trip.partnerId}`, 'TRANSPORTER', o.trip.partner.companyName ?? o.trip.partner.user.name, o), buyer, 'HAULS_FOR', o);
    }

    const ranked = [...nodes.values()].sort((a, b) => (a.gmvPaise === b.gmvPaise ? 0 : a.gmvPaise > b.gmvPaise ? -1 : 1));
    const kept = ranked.slice(0, MAX_GRAPH_NODES);
    const keptIds = new Set(kept.map((n) => n.id));
    return {
      days, truncatedOrders: orders.length === MAX_GRAPH_ORDERS, hiddenNodes: ranked.length - kept.length,
      nodes: kept, links: [...links.values()].filter((l) => keptIds.has(l.source) && keptIds.has(l.target)),
    };
  }
}

@ApiTags('analytics') @ApiBearerAuth() @Roles('ADMIN', 'BUYER', 'FARMER') @Controller('analytics')
export class AnalyticsController {
  constructor(private readonly s: AnalyticsService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.s.summary(u, days); }
  @Get('graph') graph(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.s.graph(u, days); }
}
