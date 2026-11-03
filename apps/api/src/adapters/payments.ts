/**
 * Payment gateway port: Smart Collect virtual accounts, Route transfers, refunds, webhooks.
 * Mock: full behaviour, persisted to MockGatewayTxn so reconciliation works and survives restarts.
 * Real: Razorpay REST. Written from Razorpay's public API docs, NOT yet exercised against a live or test account.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../core/core';
import { httpJson } from './http';

export interface VirtualAccountDetails { gatewayId: string; ifsc: string; accountNumber: string; beneficiary: string }
export interface CreditEvent { gatewayPaymentId: string; virtualAccountGatewayId: string; amountPaise: bigint; feePaise: bigint; bankRef?: string }
export interface ParsedWebhook { eventId: string; type: string; credit?: CreditEvent; raw: unknown }
export interface GatewayTotals { inPaise: bigint; outPaise: bigint; count: number }

export interface PaymentGateway {
  readonly name: string;
  createVirtualAccount(i: { orderId: string; orderCode: string; expectedPaise: bigint; customerName: string }): Promise<VirtualAccountDetails>;
  closeVirtualAccount(gatewayId: string): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(rawBody: Buffer, eventIdHeader?: string): ParsedWebhook;
  /** Route transfer to a linked account. Must be idempotent on idempotencyKey. */
  transfer(i: { idempotencyKey: string; fundAccountId: string; amountPaise: bigint; notes?: Record<string, string> }): Promise<{ transferId: string }>;
  refund(i: { idempotencyKey: string; gatewayPaymentId: string; amountPaise: bigint }): Promise<{ refundId: string }>;
  /** Totals for the daily reconciliation job. */
  totals(from: Date, to: Date): Promise<GatewayTotals>;
}
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dev-only-webhook-secret';
function verifyHmac(raw: Buffer, sig: string | undefined): boolean {
  if (!sig) return false;
  const expected = Buffer.from(createHmac('sha256', webhookSecret()).update(raw).digest('hex'));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
/** Both real and mock webhooks share Razorpay's virtual_account.credited payload shape. */
function parseRazorpayPayload(raw: Buffer, header?: string): ParsedWebhook {
  const body = JSON.parse(raw.toString('utf8'));
  const payment = body?.payload?.payment?.entity;
  const va = body?.payload?.virtual_account?.entity;
  const bank = body?.payload?.bank_transfer?.entity;
  const eventId = header ?? `${body.event}:${payment?.id ?? randomBytes(6).toString('hex')}`;
  if (body.event !== 'virtual_account.credited' || !payment || !va) return { eventId, type: body.event ?? 'unknown', raw: body };
  return {
    eventId, type: body.event, raw: body,
    credit: { gatewayPaymentId: payment.id, virtualAccountGatewayId: va.id, amountPaise: BigInt(payment.amount), feePaise: BigInt(payment.fee ?? 0), bankRef: bank?.utr },
  };
}

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';
  private readonly logger = new Logger('MockGateway');
  constructor(private readonly prisma: PrismaService) {}
  private get feeBps() { return BigInt(process.env.MOCK_GATEWAY_FEE_BPS ?? 150); }

  async createVirtualAccount(i: { orderId: string; orderCode: string; expectedPaise: bigint; customerName: string }) {
    const digits = BigInt('0x' + i.orderId.slice(-10).replace(/[^0-9a-f]/gi, '0')).toString().padStart(12, '0').slice(-12);
    return { gatewayId: `va_mock_${i.orderId}`, ifsc: 'RATN0VAAPIS', accountNumber: `2223330${digits}`.slice(0, 16), beneficiary: `Agrimate Escrow ${i.orderCode}` };
  }
  async closeVirtualAccount() { /* nothing to do */ }
  verifyWebhookSignature = verifyHmac;
  parseWebhook = parseRazorpayPayload;

  /** Builds and signs exactly what Razorpay would POST for a NEFT/RTGS credit. Used only by the dev mock bank and tests. */
  async buildCreditWebhook(i: { gatewayVaId: string; amountPaise: bigint; paymentId?: string }) {
    const id = i.paymentId ?? `pay_mock_${randomBytes(8).toString('hex')}`;
    const fee = (i.amountPaise * this.feeBps + 5000n) / 10000n;
    const body = {
      event: 'virtual_account.credited',
      payload: {
        payment: { entity: { id, amount: Number(i.amountPaise), fee: Number(fee), currency: 'INR', method: 'bank_transfer' } },
        virtual_account: { entity: { id: i.gatewayVaId } },
        bank_transfer: { entity: { utr: `MOCKUTR${randomBytes(5).toString('hex').toUpperCase()}`, mode: 'NEFT' } },
      },
    };
    const raw = Buffer.from(JSON.stringify(body));
    return { raw, signature: createHmac('sha256', webhookSecret()).update(raw).digest('hex'), paymentId: id, feePaise: fee };
  }
  /** Separate call so that a replayed webhook records the gateway-side credit only once. */
  async recordCredit(ref: string, amountPaise: bigint, feePaise: bigint) {
    await this.prisma.mockGatewayTxn.upsert({ where: { ref }, create: { kind: 'CREDIT', ref, amountPaise, feePaise }, update: {} });
  }
  async transfer(i: { idempotencyKey: string; fundAccountId: string; amountPaise: bigint; notes?: Record<string, string> }) {
    if (i.fundAccountId.startsWith('fa_fail')) throw new Error('Mock transfer failure');
    const ref = `trf_${i.idempotencyKey}`;
    await this.prisma.mockGatewayTxn.upsert({ where: { ref }, create: { kind: 'TRANSFER', ref, amountPaise: i.amountPaise }, update: {} });
    this.logger.debug(`transfer ${ref}`);
    return { transferId: ref };
  }
  async refund(i: { idempotencyKey: string; gatewayPaymentId: string; amountPaise: bigint }) {
    const ref = `rfnd_${i.idempotencyKey}`;
    await this.prisma.mockGatewayTxn.upsert({ where: { ref }, create: { kind: 'REFUND', ref, amountPaise: i.amountPaise }, update: {} });
    return { refundId: ref };
  }
  async totals(from: Date, to: Date) {
    const rows = await this.prisma.mockGatewayTxn.findMany({ where: { createdAt: { gte: from, lt: to } } });
    let inPaise = 0n; let outPaise = 0n;
    for (const r of rows) { if (r.kind === 'CREDIT') inPaise += r.amountPaise; else outPaise += r.amountPaise; }
    return { inPaise, outPaise, count: rows.length };
  }
}

@Injectable()
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';
  private readonly base = 'https://api.razorpay.com/v1';
  private get auth() { return 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64'); }
  private call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    return httpJson<T>(`${this.base}${path}`, { method, body, headers: { Authorization: this.auth, ...(idempotencyKey ? { 'X-Razorpay-Idempotency': idempotencyKey } : {}) }, label: 'razorpay' });
  }
  async createVirtualAccount(i: { orderId: string; orderCode: string; expectedPaise: bigint; customerName: string }) {
    const r = await this.call<{ id: string; receivers: { ifsc: string; account_number: string; name: string }[] }>('POST', '/virtual_accounts', {
      receivers: { types: ['bank_account'] }, description: `Escrow ${i.orderCode}`, notes: { orderId: i.orderId, orderCode: i.orderCode },
    }, `va_${i.orderId}`);
    const rec = r.receivers[0]!;
    return { gatewayId: r.id, ifsc: rec.ifsc, accountNumber: rec.account_number, beneficiary: rec.name };
  }
  async closeVirtualAccount(id: string) { await this.call('POST', `/virtual_accounts/${id}/close`); }
  verifyWebhookSignature = verifyHmac;
  parseWebhook = parseRazorpayPayload;
  async transfer(i: { idempotencyKey: string; fundAccountId: string; amountPaise: bigint; notes?: Record<string, string> }) {
    const r = await this.call<{ id: string }>('POST', '/transfers', { account: i.fundAccountId, amount: Number(i.amountPaise), currency: 'INR', notes: i.notes ?? {} }, i.idempotencyKey);
    return { transferId: r.id };
  }
  async refund(i: { idempotencyKey: string; gatewayPaymentId: string; amountPaise: bigint }) {
    const r = await this.call<{ id: string }>('POST', `/payments/${i.gatewayPaymentId}/refund`, { amount: Number(i.amountPaise), speed: 'normal' }, i.idempotencyKey);
    return { refundId: r.id };
  }
  async totals(from: Date, to: Date) {
    const fromS = Math.floor(from.getTime() / 1000); const toS = Math.floor(to.getTime() / 1000);
    let skip = 0; let inPaise = 0n; let outPaise = 0n; let count = 0;
    for (;;) {
      const r = await this.call<{ items: { type: string; credit: number; debit: number }[] }>('GET', `/settlements/recon/combined?from=${fromS}&to=${toS}&count=100&skip=${skip}`);
      for (const x of r.items) { inPaise += BigInt(x.credit ?? 0); outPaise += BigInt(x.debit ?? 0); count++; }
      if (r.items.length < 100) break;
      skip += 100;
    }
    return { inPaise, outPaise, count };
  }
}
