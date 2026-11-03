/** Daily mandi price ingest, 6-month series for charts, and the market-average suggestion shown when posting an RFQ. */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { istDateString } from '@agrimate/shared';
import { MARKET_DATA, MarketDataAdapter } from '../adapters/others';
import { Clock, PrismaService } from '../core/core';
import { JobsService } from '../engine/engine';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger('MarketData');
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly jobs: JobsService, private readonly orders: OrdersService, @Inject(MARKET_DATA) private readonly adapter: MarketDataAdapter) {}

  onModuleInit() {
    this.jobs.repeat('market-daily', () => this.ingest(), { pattern: '0 20 * * *' });
    this.jobs.repeat('organic-expiry-daily', () => this.orders.expireOrganicCerts(), { pattern: '5 0 * * *' });
  }

  /** Idempotent per commodity + market + date, so a re-run just refreshes the numbers. */
  async ingest(date = istDateString(this.clock.now())) {
    const commodities = await this.prisma.commodity.findMany({ where: { active: true } });
    const byCode = new Map(commodities.map((c) => [c.code, c.id]));
    const quotes = await this.adapter.fetchDaily(date, commodities.map((c) => ({ code: c.code, name: c.name })));
    let saved = 0;
    for (const q of quotes) {
      const commodityId = byCode.get(q.commodityCode);
      if (!commodityId) continue;
      const data = { minPaisePerKg: q.minPaisePerKg, maxPaisePerKg: q.maxPaisePerKg, modalPaisePerKg: q.modalPaisePerKg, district: q.district, state: q.state, source: this.adapter.name };
      await this.prisma.marketPrice.upsert({ where: { commodityId_market_date: { commodityId, market: q.market, date: new Date(q.date) } }, create: { commodityId, market: q.market, date: new Date(q.date), ...data }, update: data });
      saved++;
    }
    this.logger.log(`Ingested ${saved} quotes for ${date}`);
    return saved;
  }

  /** Average of modal prices over the last 7 days of data, across all markets. */
  async suggestion(commodityId: string) {
    const since = new Date(this.clock.now().getTime() - 7 * 86_400_000);
    const rows = await this.prisma.marketPrice.findMany({ where: { commodityId, date: { gte: since } }, select: { modalPaisePerKg: true } });
    if (!rows.length) return { averagePaisePerKg: null, sampleSize: 0, windowDays: 7 };
    const sum = rows.reduce((s, r) => s + r.modalPaisePerKg, 0n);
    return { averagePaisePerKg: sum / BigInt(rows.length), sampleSize: rows.length, windowDays: 7 };
  }

  async series(commodityId: string, market?: string, months = 6) {
    const since = new Date(this.clock.now().getTime() - months * 30.5 * 86_400_000);
    const rows = await this.prisma.marketPrice.findMany({ where: { commodityId, market, date: { gte: since } }, orderBy: { date: 'asc' } });
    return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), market: r.market, state: r.state, minPaisePerKg: r.minPaisePerKg, maxPaisePerKg: r.maxPaisePerKg, modalPaisePerKg: r.modalPaisePerKg, source: r.source }));
  }

  async markets(commodityId: string) {
    const rows = await this.prisma.marketPrice.findMany({ where: { commodityId }, distinct: ['market'], select: { market: true, state: true } });
    return rows;
  }
}
