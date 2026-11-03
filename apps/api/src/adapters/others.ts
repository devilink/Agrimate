/**
 * Remaining provider ports: maps, SMS, KYC, market data, storage. Each has a mock and a real implementation chosen by env.
 * Real implementations are written from public docs and have NOT been exercised against live accounts (see README).
 */
import { CreateMultipartUploadCommand, CompleteMultipartUploadCommand, CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { haversineMetres, rupees } from '@agrimate/shared';
import { PrismaService } from '../core/core';
import { httpJson, ProviderError } from './http';

// ---- Maps ---------------------------------------------------------------------------------------------------------
export interface MapsAdapter { readonly name: string; distanceMetres(originPin: string, destPin: string): Promise<number> }
export const MAPS = Symbol('MAPS');

@Injectable()
export class MockMaps implements MapsAdapter {
  readonly name = 'mock';
  constructor(private readonly prisma: PrismaService) {}
  /** Straight-line × 1.3 road factor between seeded PIN coordinates; deterministic pseudo-distance for unknown PINs. */
  async distanceMetres(a: string, b: string) {
    if (a === b) return 5_000;
    const [pa, pb] = await Promise.all([this.prisma.pinCode.findUnique({ where: { pin: a } }), this.prisma.pinCode.findUnique({ where: { pin: b } })]);
    if (pa && pb) return Math.max(5_000, Math.round(haversineMetres(pa, pb) * 1.3));
    return 50_000 + (Math.abs(Number(a) - Number(b)) % 1500) * 1000;
  }
}
@Injectable()
export class GoogleMaps implements MapsAdapter {
  readonly name = 'google';
  async distanceMetres(a: string, b: string) {
    const q = new URLSearchParams({ origins: `${a},India`, destinations: `${b},India`, units: 'metric', key: process.env.GOOGLE_MAPS_API_KEY ?? '' });
    const r = await httpJson<{ status: string; rows: { elements: { status: string; distance?: { value: number } }[] }[] }>(`https://maps.googleapis.com/maps/api/distancematrix/json?${q}`, { label: 'google-maps' });
    const el = r.rows?.[0]?.elements?.[0];
    if (r.status !== 'OK' || el?.status !== 'OK' || !el.distance) throw new ProviderError(`Distance Matrix: ${r.status}/${el?.status}`);
    return el.distance.value;
  }
}

// ---- SMS ----------------------------------------------------------------------------------------------------------
export interface SmsAdapter { readonly name: string; send(to: string, body: string, templateId?: string): Promise<void> }
export const SMS = Symbol('SMS');

@Injectable()
export class MockSms implements SmsAdapter {
  readonly name = 'mock';
  private readonly logger = new Logger('MockSms');
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
    if (this.sent.length > 1000) this.sent.shift();
    this.logger.log(`SMS to ******${to.slice(-4)}: ${body}`);
  }
}
@Injectable()
export class TwilioSms implements SmsAdapter {
  readonly name = 'twilio';
  async send(to: string, body: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
    await httpJson(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', form: true, label: 'twilio',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM ?? '', Body: body }).toString(),
    });
  }
}
/** MSG91 is the practical route for DLT-registered Indian templates. */
@Injectable()
export class Msg91Sms implements SmsAdapter {
  readonly name = 'msg91';
  async send(to: string, body: string, templateId?: string) {
    await httpJson('https://control.msg91.com/api/v5/flow/', {
      method: 'POST', label: 'msg91', headers: { authkey: process.env.MSG91_AUTH_KEY ?? '' },
      body: { template_id: templateId ?? process.env.MSG91_DEFAULT_TEMPLATE, short_url: '0', recipients: [{ mobiles: to.replace('+', ''), message: body }] },
    });
  }
}
@Injectable()
export class SnsSms implements SmsAdapter {
  readonly name = 'sns';
  /** Loaded lazily so the AWS SNS SDK is only needed by deployments that choose SNS. */
  async send(to: string, body: string) {
    const moduleName = '@aws-sdk/client-sns';
    const { SNSClient, PublishCommand } = await import(moduleName);
    await new SNSClient({}).send(new PublishCommand({ PhoneNumber: to, Message: body }));
  }
}

// ---- KYC ----------------------------------------------------------------------------------------------------------
export interface PanResult { valid: boolean; registeredName?: string; raw: unknown }
export interface GstinResult { valid: boolean; legalName?: string; active?: boolean; raw: unknown }
export interface BankResult { valid: boolean; holderName?: string; fundAccountId?: string; raw: unknown }
export interface KycAdapter {
  readonly name: string;
  verifyPan(pan: string, name: string): Promise<PanResult>;
  verifyGstin(gstin: string): Promise<GstinResult>;
  /** Penny-drop / fund-account validation. Returns the holder name as the BANK reports it. */
  verifyBank(i: { accountNumber: string; ifsc: string; declaredName: string }): Promise<BankResult>;
}
export const KYC = Symbol('KYC');

@Injectable()
export class MockKyc implements KycAdapter {
  readonly name = 'mock';
  async verifyPan(pan: string, name: string) {
    // Convention: a PAN starting ZZZZZ is "not found", so failure paths can be demoed.
    if (pan.startsWith('ZZZZZ')) return { valid: false, raw: { mock: true, status: 'INVALID' } };
    return { valid: true, registeredName: name.toUpperCase(), raw: { mock: true, status: 'VALID', name: name.toUpperCase() } };
  }
  async verifyGstin(gstin: string) {
    if (gstin.slice(2, 7) === 'ZZZZZ') return { valid: false, raw: { mock: true, status: 'INVALID' } };
    return { valid: true, legalName: 'MOCK LEGAL NAME', active: true, raw: { mock: true, status: 'ACTIVE' } };
  }
  async verifyBank(i: { accountNumber: string; ifsc: string; declaredName: string }) {
    // Convention: an account ending 0000 has a different holder on record, so the mismatch path can be demoed.
    const holderName = i.accountNumber.endsWith('0000') ? 'SOMEONE ELSE ENTIRELY' : i.declaredName.toUpperCase();
    return { valid: true, holderName, fundAccountId: `fa_mock_${i.accountNumber.slice(-6)}`, raw: { mock: true, holderName, utr: 'MOCKPENNY' } };
  }
}
/** Cashfree Verification Suite. Other vendors plug in behind the same port. */
@Injectable()
export class CashfreeKyc implements KycAdapter {
  readonly name = 'cashfree';
  private readonly base = 'https://api.cashfree.com/verification';
  private get headers() { return { 'x-client-id': process.env.CASHFREE_CLIENT_ID ?? '', 'x-client-secret': process.env.CASHFREE_CLIENT_SECRET ?? '' }; }
  async verifyPan(pan: string, name: string) {
    const r = await httpJson<{ valid?: boolean; registered_name?: string }>(`${this.base}/pan`, { method: 'POST', headers: this.headers, body: { pan, name }, label: 'cashfree' });
    return { valid: !!r.valid, registeredName: r.registered_name, raw: r };
  }
  async verifyGstin(gstin: string) {
    const r = await httpJson<{ valid?: boolean; legal_name_of_business?: string; gst_in_status?: string }>(`${this.base}/gstin`, { method: 'POST', headers: this.headers, body: { GSTIN: gstin }, label: 'cashfree' });
    return { valid: !!r.valid, legalName: r.legal_name_of_business, active: r.gst_in_status === 'Active', raw: r };
  }
  async verifyBank(i: { accountNumber: string; ifsc: string; declaredName: string }) {
    const r = await httpJson<{ account_status?: string; name_at_bank?: string; ref_id?: string }>(`${this.base}/bank-account/sync`, { method: 'POST', headers: this.headers, body: { bank_account: i.accountNumber, ifsc: i.ifsc, name: i.declaredName }, label: 'cashfree' });
    return { valid: r.account_status === 'VALID', holderName: r.name_at_bank, fundAccountId: r.ref_id, raw: r };
  }
}

// ---- Market data --------------------------------------------------------------------------------------------------
export interface MarketQuote { commodityCode: string; market: string; district?: string; state: string; date: string; minPaisePerKg: bigint; maxPaisePerKg: bigint; modalPaisePerKg: bigint }
export interface MarketDataAdapter { readonly name: string; fetchDaily(date: string, commodities: { code: string; name: string }[]): Promise<MarketQuote[]> }
export const MARKET_DATA = Symbol('MARKET_DATA');

/** Base prices in ₹/kg for mock quotes and seed history. Placeholder magnitudes only, not real market data. */
export const MOCK_BASE_PRICES: Record<string, number> = { PADDY: 24, RICE: 42, POTATO: 16, ONION: 22, TEA_LEAF: 28, GINGER: 70, TURMERIC: 95, MAIZE: 21, MUSTARD: 58 };
export const MOCK_MARKETS = [
  { market: 'Guwahati', district: 'Kamrup Metropolitan', state: 'Assam' }, { market: 'Siliguri', district: 'Darjeeling', state: 'West Bengal' },
  { market: 'Lasalgaon', district: 'Nashik', state: 'Maharashtra' }, { market: 'Khanna', district: 'Ludhiana', state: 'Punjab' },
];
export function mockQuote(code: string, marketIdx: number, date: string): Omit<MarketQuote, 'commodityCode' | 'market' | 'state' | 'date'> {
  const base = MOCK_BASE_PRICES[code] ?? 30;
  // Deterministic gentle seasonality so that charts look plausible and tests are repeatable.
  const seed = createHash('md5').update(`${code}|${marketIdx}|${date}`).digest()[0]! / 255;
  const dayOfYear = Math.floor((Date.parse(date) - Date.parse(date.slice(0, 4) + '-01-01')) / 86_400_000);
  const modal = base * (1 + 0.12 * Math.sin(dayOfYear / 28 + marketIdx) + (seed - 0.5) * 0.04);
  const toP = (x: number) => rupees(Math.round(x * 100) / 100);
  return { modalPaisePerKg: toP(modal), minPaisePerKg: toP(modal * 0.93), maxPaisePerKg: toP(modal * 1.07) };
}
@Injectable()
export class MockMarketData implements MarketDataAdapter {
  readonly name = 'mock';
  async fetchDaily(date: string, commodities: { code: string; name: string }[]) {
    return commodities.flatMap((c) => MOCK_MARKETS.map((m, i) => ({ commodityCode: c.code, market: m.market, district: m.district, state: m.state, date, ...mockQuote(c.code, i, date) })));
  }
}
/** Agmarknet "current daily price" dataset on data.gov.in. Prices come per quintal; 1 quintal = 100 kg. */
@Injectable()
export class AgmarknetData implements MarketDataAdapter {
  readonly name = 'agmarknet';
  private get resource() { return process.env.AGMARKNET_RESOURCE_ID ?? '9ef84268-d588-465a-a308-a864a43d0070'; }
  async fetchDaily(date: string, commodities: { code: string; name: string }[]) {
    const out: MarketQuote[] = [];
    const [y, m, d] = date.split('-');
    for (const c of commodities) {
      const q = new URLSearchParams({ 'api-key': process.env.DATA_GOV_IN_API_KEY ?? '', format: 'json', limit: '500', 'filters[commodity]': c.name, 'filters[arrival_date]': `${d}/${m}/${y}` });
      const r = await httpJson<{ records?: { state: string; district: string; market: string; min_price: string; max_price: string; modal_price: string }[] }>(`https://api.data.gov.in/resource/${this.resource}?${q}`, { label: 'agmarknet' });
      for (const x of r.records ?? []) {
        const perKg = (s: string) => BigInt(Math.round(Number(s))); // ₹/quintal numerically equals paise/kg.
        out.push({ commodityCode: c.code, market: x.market, district: x.district, state: x.state, date, minPaisePerKg: perKg(x.min_price), maxPaisePerKg: perKg(x.max_price), modalPaisePerKg: perKg(x.modal_price) });
      }
    }
    return out;
  }
}

// ---- Storage ------------------------------------------------------------------------------------------------------
export interface StorageAdapter {
  readonly name: string;
  init(): Promise<void>;
  signedPutUrl(key: string, contentType: string, ttlSec?: number): Promise<string>;
  signedGetUrl(key: string, ttlSec?: number): Promise<string>;
  /** SHA-256 and size computed from the stored bytes, streamed so that large videos do not sit in memory. */
  hashObject(key: string): Promise<{ sha256: string; size: number } | null>;
  createMultipart(key: string, contentType: string): Promise<string>;
  signedPartUrl(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
}
export const STORAGE = Symbol('STORAGE');

@Injectable()
export class S3Storage implements StorageAdapter {
  readonly name = 's3';
  private readonly bucket = process.env.S3_BUCKET ?? 'agrimate';
  private readonly logger = new Logger('S3Storage');
  private client(endpoint?: string) {
    return new S3Client({
      region: process.env.S3_REGION ?? 'ap-south-1', forcePathStyle: true, ...(endpoint ? { endpoint } : {}),
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? 'agrimate', secretAccessKey: process.env.S3_SECRET_KEY ?? 'agrimate-secret' },
    });
  }
  private get internal() { return this.client(process.env.S3_ENDPOINT ?? 'http://localhost:9000'); }
  /** Signed URLs must carry the host the device can reach, which differs from the API's own in Docker. */
  private get external() { return this.client(process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000'); }
  async init() {
    try { await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket })); }
    catch {
      try { await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket })); this.logger.log(`Created bucket ${this.bucket}`); }
      catch (e) { this.logger.warn(`Could not ensure bucket: ${(e as Error).message}`); }
    }
  }
  signedPutUrl(key: string, contentType: string, ttl = 900) { return getSignedUrl(this.external, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: ttl }); }
  signedGetUrl(key: string, ttl = 600) { return getSignedUrl(this.external, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttl }); }
  async hashObject(key: string) {
    try {
      const r = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const h = createHash('sha256'); let size = 0;
      for await (const chunk of r.Body as AsyncIterable<Buffer>) { h.update(chunk); size += chunk.length; }
      return { sha256: h.digest('hex'), size };
    } catch { return null; }
  }
  async createMultipart(key: string, contentType: string) {
    const r = await this.internal.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    return r.UploadId!;
  }
  signedPartUrl(key: string, uploadId: string, partNumber: number) { return getSignedUrl(this.external, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: 3600 }); }
  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    await this.internal.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) } }));
  }
}

/** In-memory store for tests. */
@Injectable()
export class MockStorage implements StorageAdapter {
  readonly name = 'mock';
  readonly objects = new Map<string, Buffer>();
  async init() { /* nothing to do */ }
  async signedPutUrl(key: string) { return `http://mock-storage/put/${encodeURIComponent(key)}`; }
  async signedGetUrl(key: string) { return `http://mock-storage/get/${encodeURIComponent(key)}`; }
  put(key: string, data: Buffer) { this.objects.set(key, data); }
  async hashObject(key: string) {
    const b = this.objects.get(key);
    return b ? { sha256: createHash('sha256').update(b).digest('hex'), size: b.length } : null;
  }
  async createMultipart() { return 'mock-upload'; }
  async signedPartUrl(key: string, _u: string, n: number) { return `http://mock-storage/part/${encodeURIComponent(key)}/${n}`; }
  async completeMultipart() { /* nothing to do */ }
}
