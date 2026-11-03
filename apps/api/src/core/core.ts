/**
 * Cross-cutting infrastructure: env, Prisma, clock, PII crypto, typed platform config, audit trail.
 * Everything here is free of domain knowledge.
 */
import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export type Tx = Prisma.TransactionClient;

// ---- Env ---------------------------------------------------------------------------------------------------------
const PROD = process.env.NODE_ENV === 'production';
function secret(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  // Dev defaults exist so `docker compose up` works with zero setup; production refuses to boot on them.
  if (PROD) throw new Error(`${name} must be set in production`);
  return devDefault;
}
export const env = {
  get isProd() { return PROD; },
  get port() { return Number(process.env.PORT ?? 4000); },
  get jwtSecret() { return secret('JWT_SECRET', 'dev-only-jwt-secret-change-me'); },
  get piiKey() { return secret('PII_ENCRYPTION_KEY', 'dev-only-pii-key-change-me'); },
  get piiHashKey() { return secret('PII_HASH_KEY', 'dev-only-pii-hash-key-change-me'); },
  get paymentProvider() { return process.env.PAYMENT_PROVIDER ?? 'mock'; },
  get mapsProvider() { return process.env.MAPS_PROVIDER ?? 'mock'; },
  get smsProvider() { return process.env.SMS_PROVIDER ?? 'mock'; },
  get kycProvider() { return process.env.KYC_PROVIDER ?? 'mock'; },
  get marketProvider() { return process.env.MARKET_DATA_PROVIDER ?? 'mock'; },
  get storageProvider() { return process.env.STORAGE_PROVIDER ?? 's3'; },
  get queuesEnabled() { return (process.env.QUEUES_ENABLED ?? 'true') !== 'false'; },
  get redisUrl() { return process.env.REDIS_URL ?? 'redis://localhost:6379'; },
  /** Dev helpers (returning OTPs, the mock bank) exist only while the matching provider is mocked AND not in production. */
  get devToolsEnabled() { return !PROD && this.paymentProvider === 'mock'; },
  get exposeDevOtp() { return !PROD && this.smsProvider === 'mock'; },
  get corsOrigins() { return (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001,http://localhost:3002').split(','); },
};

// ---- Prisma ------------------------------------------------------------------------------------------------------
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
  /** Money transitions can call a provider mid-way, so they get a longer leash than Prisma's 5 s default. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
  }
}

// ---- Clock -------------------------------------------------------------------------------------------------------
/** All business time flows through here so that SLA behaviour is testable without sleeping. */
@Injectable()
export class Clock {
  private offsetMs = 0;
  now(): Date { return new Date(Date.now() + this.offsetMs); }
  /** Test/dev only: shifts perceived time. */
  advance(ms: number) { this.offsetMs += ms; }
  setNow(d: Date) { this.offsetMs = d.getTime() - Date.now(); }
  reset() { this.offsetMs = 0; }
}

// ---- Crypto ------------------------------------------------------------------------------------------------------
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
@Injectable()
export class CryptoService {
  private get key() { return createHash('sha256').update(env.piiKey).digest(); }
  /** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }
  decrypt(blob: string): string {
    const [v, iv, tag, ct] = blob.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised ciphertext');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
  /** Keyed blind index: same input maps to the same value, but it can't be brute-forced without the key. */
  blindIndex(value: string): string { return createHmac('sha256', env.piiHashKey).update(value).digest('hex'); }
  sha256(v: string | Buffer): string { return createHash('sha256').update(v).digest('hex'); }
  randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
  randomDigits(n: number): string {
    let out = '';
    while (out.length < n) { const b = randomBytes(1)[0]!; if (b < 250) out += String(b % 10); }
    return out;
  }
  async hashPassword(pw: string): Promise<string> {
    const salt = randomBytes(16);
    return `${salt.toString('base64url')}.${(await scryptAsync(pw, salt, 64)).toString('base64url')}`;
  }
  async verifyPassword(pw: string, stored: string): Promise<boolean> {
    const [salt, hash] = stored.split('.');
    if (!salt || !hash) return false;
    const a = await scryptAsync(pw, Buffer.from(salt, 'base64url'), 64);
    const b = Buffer.from(hash, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

// ---- Platform config ---------------------------------------------------------------------------------------------
/** Every [Default — configurable] item in the PRD. Admin edits go to PlatformConfig; orders snapshot on creation. */
export const CONFIG_DEFAULTS = {
  advanceBps: 3000,
  commissionBps: 300,
  freightMarkupBps: 800,
  loadingFeePaise: '100000',
  advanceExpiryHours: 48,
  rfqSlaDays: 3,
  catalogSlaDays: 2,
  slaEndOfDay: true,
  disputeWindowHours: 24,
  spotTestExtensionHours: 72,
  inspectionFeePayer: 'FARMER',
  inspectorShareBps: 7000,
  waiveInspectionFeeOnSelfCert: true,
  checkInRadiusMetres: 500,
  selfCertRadiusMetres: 500,
  selfCertFallbackHours: 24,
  selfCertSessionMinutes: 30,
  inspectorMaxJobsPerDay: 5,
  inspectorRetryHours: 2,
  inspectorMaxAttempts: 3,
  bidPriceRule: 'LTE_TARGET',
  advanceForfeitureOnBuyerDefault: false,
  otpTtlMinutes: 10,
  otpMaxPerHour: 5,
  gstOnCommissionBps: 1800,
  gstOnGoodsBps: 0,
} as const;
export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends string ? string : T;

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}
  async get<K extends ConfigKey>(key: K, db: Tx | PrismaService = this.prisma): Promise<Widen<(typeof CONFIG_DEFAULTS)[K]>> {
    const row = await db.platformConfig.findUnique({ where: { key } });
    return (row ? row.value : CONFIG_DEFAULTS[key]) as Widen<(typeof CONFIG_DEFAULTS)[K]>;
  }
  async all() {
    const rows = await this.prisma.platformConfig.findMany();
    const out: Record<string, unknown> = { ...CONFIG_DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
  async set(key: ConfigKey, value: unknown, updatedBy: string) {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.platformConfig.upsert({ where: { key }, create: { key, value: json, updatedBy }, update: { value: json, updatedBy } });
  }
}

// ---- Audit -------------------------------------------------------------------------------------------------------
export interface AuditEntry { actorId?: string | null; actorRole: string; action: string; entity: string; entityId?: string | null; data?: unknown }
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  log(e: AuditEntry, db: Tx | PrismaService = this.prisma) {
    return db.auditLog.create({
      data: { actorId: e.actorId ?? null, actorRole: e.actorRole, action: e.action, entity: e.entity, entityId: e.entityId ?? null, data: (e.data ?? {}) as Prisma.InputJsonValue },
    });
  }
}

@Global()
@Module({ providers: [PrismaService, Clock, CryptoService, ConfigService, AuditService], exports: [PrismaService, Clock, CryptoService, ConfigService, AuditService] })
export class CoreModule {}

/** PII-safe log formatting: keeps structure, hides anything that looks sensitive. */
const SENSITIVE = /(phone|pan|account|otp|password|token|secret|authorization|key_secret|signature|ifsc|holder|name)/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 5 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(x, depth + 1)]));
}
