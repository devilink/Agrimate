/** Shared outbound HTTP for real adapters: retries with backoff, timeouts, PII-redacted logging. */
import { Logger } from '@nestjs/common';
import { redact } from '../core/core';

const logger = new Logger('Outbound');
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) { super(message); }
}
export interface HttpOpts { method?: string; body?: unknown; headers?: Record<string, string>; label: string; retries?: number; timeoutMs?: number; form?: boolean }

/** Retries network errors, 429 and 5xx with exponential backoff; 4xx fails immediately. */
export async function httpJson<T>(url: string, o: HttpOpts): Promise<T> {
  const retries = o.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1) + Math.random() * 100));
    try {
      const res = await fetch(url, {
        method: o.method ?? 'GET',
        headers: { ...(o.body && !o.form ? { 'Content-Type': 'application/json' } : {}), ...(o.headers ?? {}) },
        body: o.body === undefined ? undefined : o.form ? (o.body as string) : JSON.stringify(o.body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON body, keep the text */ }
      logger.log(JSON.stringify({ provider: o.label, status: res.status, attempt, response: redact(parsed) }));
      if (res.ok) return parsed as T;
      lastErr = new ProviderError(`${o.label} responded ${res.status}`, res.status, parsed);
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}
