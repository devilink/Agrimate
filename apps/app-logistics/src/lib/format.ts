/**
 * Display helpers.
 *
 * IST is formatted by hand on purpose. The shared formatIST() depends on Intl.DateTimeFormat with a time zone and
 * dateStyle, which varies across Hermes builds. IST is a fixed +05:30, so plain arithmetic is always correct.
 * BigInt (used inside formatINR) is supported by Hermes, so money uses the shared helper as it is.
 */
import { ApiError } from '@agrimate/api-client';
import { IST_OFFSET_MS } from '@agrimate/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function istDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const t = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  if (Number.isNaN(t.getTime())) return '-';
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

export function istDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const t = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  if (Number.isNaN(t.getTime())) return '-';
  const h = t.getUTCHours();
  const m = String(t.getUTCMinutes()).padStart(2, '0');
  return `${istDate(value)}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'} IST`;
}

export const kg = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `${n.toLocaleString('en-IN')} kg`);

export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The API's own wording wherever there is one. Network failures get a sentence a person can act on. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status >= 500) return 'Something went wrong on our side. Please try again.';
    if (e.status === 429) return 'Too many tries. Please wait a minute and try again.';
    return e.message;
  }
  if (e instanceof Error && e.name !== 'TypeError' && e.name !== 'AbortError') return e.message;
  return 'Could not reach Agrimate. Check your connection and try again.';
}

export const isNetworkError = (e: unknown) => !(e instanceof ApiError) && e instanceof Error && (e.name === 'TypeError' || e.name === 'AbortError');

const WORDS: Record<string, string> = {
  ASSIGNED: 'Assigned', CHECKED_IN: 'Checked in', INSPECTED: 'Inspected', FAILED_GRADE: 'Failed grade', UNASSIGNED: 'Unassigned', WAIVED_SELF_CERT: 'Self-certified',
  OPEN: 'Open', ACCEPTED: 'Accepted', PICKED_UP: 'In transit', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
  BLOCKED: 'On hold', PENDING: 'Pending', PROCESSED: 'Paid', FAILED: 'Failed',
  NOT_SUBMITTED: 'Not submitted', VERIFIED: 'Approved', MANUAL_REVIEW: 'Under review', REJECTED: 'Rejected',
};
export const statusLabel = (s: string) => WORDS[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Order states are shown to field staff in plain words. Anything unlisted falls back to the state name. */
const ORDER_WORDS: Record<string, string> = {
  ADVANCE_LOCKED: 'Advance paid, balance not paid yet', LOGISTICS_PENDING: 'Advance paid, transport not arranged yet', LOGISTICS_SECURED: 'Transport arranged, balance not paid yet', AWAITING_BALANCE: 'Waiting for the buyer to pay the balance',
  FULLY_FUNDED: 'Fully paid', INSPECTION_SCHEDULED: 'Fully paid, ready for inspection', INSPECTED: 'Inspected', SELF_CERTIFIED: 'Self-certified by the farmer', IN_TRANSIT: 'In transit', DELIVERED: 'Delivered', DISPUTE_WINDOW: 'Delivered, dispute window open', SETTLED: 'Settled', REFUNDED: 'Refunded', CANCELLED: 'Cancelled', DISPUTED: 'Disputed', RESOLVED: 'Dispute resolved', FARMER_DEFAULTED: 'Farmer default', BUYER_DEFAULTED: 'Buyer default',
};
export const orderStateLabel = (s: string) => ORDER_WORDS[s] ?? statusLabel(s);
