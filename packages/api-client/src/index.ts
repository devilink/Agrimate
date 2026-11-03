/**
 * Typed API client shared by every portal. `paths` comes from the OpenAPI document (`pnpm gen:client`), so request paths
 * and bodies are checked by the compiler; response shapes are the view types in ./views, because the API returns
 * role-scoped views rather than one schema per route.
 * Handles bearer auth, one automatic refresh-and-retry on 401, and the signed-URL + SHA-256 file flow.
 */
import type { paths } from './schema';
export type { paths, components } from './schema';
export * from './views';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string, readonly body: unknown) { super(message); }
}

export interface TokenStore {
  getAccess(): string | null | Promise<string | null>;
  getRefresh(): string | null | Promise<string | null>;
  set(access: string, refresh: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

/** Browser default. Native apps pass a SecureStore-backed implementation instead. */
export function localStorageTokens(prefix = 'agrimate'): TokenStore {
  const has = typeof localStorage !== 'undefined';
  return {
    getAccess: () => (has ? localStorage.getItem(`${prefix}.access`) : null),
    getRefresh: () => (has ? localStorage.getItem(`${prefix}.refresh`) : null),
    set: (a, r) => { if (has) { localStorage.setItem(`${prefix}.access`, a); localStorage.setItem(`${prefix}.refresh`, r); } },
    clear: () => { if (has) { localStorage.removeItem(`${prefix}.access`); localStorage.removeItem(`${prefix}.refresh`); } },
  };
}

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  onSignedOut?: () => void;
  fetchImpl?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Accepts templated OpenAPI paths with their parameters filled in, e.g. `/api/v1/orders/${id}`. */
type ApiPath = keyof paths | (string & {});

async function sha256Web(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createApi(o: ApiOptions) {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = (p: string) => `${o.baseUrl}${p.startsWith('/api/') || p === '/health' ? p : `/api/v1${p}`}`;

  async function refresh(): Promise<boolean> {
    const rt = await o.tokens.getRefresh();
    if (!rt) return false;
    const r = await f(url('/auth/refresh'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!r.ok) return false;
    const b = await r.json();
    await o.tokens.set(b.accessToken, b.refreshToken);
    return true;
  }

  async function raw(method: Method, path: string, body?: unknown, retried = false): Promise<Response> {
    const token = await o.tokens.getAccess();
    const res = await f(url(path), {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried && (await o.tokens.getRefresh())) {
      if (await refresh()) return raw(method, path, body, true);
      await o.tokens.clear();
      o.onSignedOut?.();
    }
    return res;
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await raw(method, path, body);
    const text = await res.text();
    let parsed: unknown = undefined;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
    if (!res.ok) {
      const e = parsed as { code?: string; message?: string | string[] } | undefined;
      const message = Array.isArray(e?.message) ? e.message.join(', ') : (e?.message ?? `Request failed (${res.status})`);
      throw new ApiError(res.status, e?.code, message, parsed);
    }
    return parsed as T;
  }

  const api = {
    get: <T>(path: ApiPath) => request<T>('GET', path as string),
    post: <T>(path: ApiPath, body: unknown = {}) => request<T>('POST', path as string, body),
    put: <T>(path: ApiPath, body: unknown = {}) => request<T>('PUT', path as string, body),
    patch: <T>(path: ApiPath, body: unknown = {}) => request<T>('PATCH', path as string, body),
    raw,

    async requestOtp(phone: string) { return api.post<{ sent: boolean; expiresInMinutes: number; devOtp?: string }>('/auth/otp/request', { phone }); },
    async verifyOtp(i: { phone: string; code: string; role?: string; name?: string; language?: string }) {
      const r = await api.post<AuthResult>('/auth/otp/verify', i);
      await o.tokens.set(r.accessToken, r.refreshToken);
      return r.user;
    },
    async login(email: string, password: string) {
      const r = await api.post<AuthResult>('/auth/login', { email, password });
      await o.tokens.set(r.accessToken, r.refreshToken);
      return r.user;
    },
    async logout() {
      const rt = await o.tokens.getRefresh();
      if (rt) await raw('POST', '/auth/logout', { refreshToken: rt }).catch(() => undefined);
      await o.tokens.clear();
    },

    /**
     * Hash → ask for a signed URL → PUT to storage → server re-hashes. Returns the file id.
     * `sha256` lets a caller supply a hash computed elsewhere (React Native has no crypto.subtle).
     * `captureToken` is mandatory for self-certification video.
     */
    async uploadFile(i: { purpose: string; data: Blob | ArrayBuffer; contentType: string; orderId?: string; captureToken?: string; sha256?: string; onProgress?: (fraction: number) => void }) {
      const buffer = i.data instanceof ArrayBuffer ? i.data : await i.data.arrayBuffer();
      const sha256 = i.sha256 ?? (await sha256Web(buffer));
      const init = await api.post<{ fileId: string; uploadUrl: string }>('/files/upload-url', { purpose: i.purpose, sha256, contentType: i.contentType, sizeBytes: buffer.byteLength, orderId: i.orderId, captureToken: i.captureToken });
      const put = await f(init.uploadUrl, { method: 'PUT', headers: { 'Content-Type': i.contentType }, body: buffer });
      if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', 'Upload to storage failed', null);
      i.onProgress?.(1);
      await api.post(`/files/${init.fileId}/complete`);
      return init.fileId;
    },

    /** Resumable: splits into parts, so that a dropped connection costs one part rather than the whole video. */
    async uploadMultipart(i: { purpose: string; data: Blob; contentType: string; sha256: string; orderId?: string; captureToken?: string; partSize?: number; retries?: number; onProgress?: (fraction: number) => void }) {
      const partSize = i.partSize ?? 5 * 1024 * 1024;
      const init = await api.post<{ fileId: string }>('/files/upload-url', { purpose: i.purpose, sha256: i.sha256, contentType: i.contentType, sizeBytes: i.data.size, orderId: i.orderId, captureToken: i.captureToken, multipart: true });
      const total = Math.max(1, Math.ceil(i.data.size / partSize));
      const parts: { partNumber: number; etag: string }[] = [];
      for (let n = 1; n <= total; n++) {
        const chunk = i.data.slice((n - 1) * partSize, n * partSize);
        let etag: string | null = null; let lastError: unknown;
        for (let attempt = 0; attempt <= (i.retries ?? 4) && !etag; attempt++) {
          try {
            const { url: partUrl } = await api.post<{ url: string }>(`/files/${init.fileId}/parts`, { partNumber: n });
            const put = await f(partUrl, { method: 'PUT', body: chunk });
            if (put.ok) etag = put.headers.get('etag');
          } catch (e) { lastError = e; }
          if (!etag) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
        if (!etag) throw lastError instanceof Error ? lastError : new ApiError(0, 'UPLOAD_FAILED', 'Upload failed', null);
        parts.push({ partNumber: n, etag });
        i.onProgress?.(n / total);
      }
      await api.post(`/files/${init.fileId}/multipart-complete`, { parts });
      return init.fileId;
    },
  };
  return api;
}
export type Api = ReturnType<typeof createApi>;
export interface AuthResult { accessToken: string; refreshToken: string; user: SessionUser }
export interface SessionUser { id: string; role: 'BUYER' | 'FARMER' | 'INSPECTOR' | 'LOGISTICS' | 'ADMIN'; name: string; language: string; phoneLast4: string; email: string | null }
