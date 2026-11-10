import { ApiError } from '@agrimate/api-client';
import type { T, Vars } from './i18n';

export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

/** fetch rejects with a TypeError when the request never completed. */
export const isNetworkError = (e: unknown) => e instanceof TypeError;

/** Numbers that the API sends with a rejection, such as how far the phone was from the farm. */
function varsFrom(body: unknown): Vars {
  const vars: Vars = {};
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) if (typeof v === 'number' || typeof v === 'string') vars[k] = v;
  }
  return vars;
}

/** Turns any failure into one plain sentence in the farmer's language. API messages are English, so codes map to keys. */
export function errorText(e: unknown, t: T, has: (key: string) => boolean): string {
  if (isNetworkError(e)) return t('error.network');
  if (e instanceof ApiError) {
    const key = `apiError.${e.code}`;
    if (e.code && has(key)) return t(key, varsFrom(e.body));
    if (e.status === 400) return t('error.badInput');
    if (e.status === 401) return t('error.signedOut');
    if (e.status === 403) return t('error.forbidden');
    if (e.status === 404) return t('error.notFound');
    if (e.status === 429) return t('error.tooMany');
    if (e.status >= 500) return t('error.server');
  }
  return t('error.generic');
}
