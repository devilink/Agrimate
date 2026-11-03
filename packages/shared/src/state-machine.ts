/**
 * Table-driven state machines. The table holds allowed transitions, who may trigger them, guards and named side effects.
 * The API is the only enforcer; portals may import this to decide what to render, never to decide what is allowed.
 */
import { BidState, ListingState, OrderState, RfqState, Role } from './enums';

export type Actor = Role | 'SYSTEM';

/** Facts about an order that guards read. Built server-side from the DB inside the transition's transaction. */
export interface GuardContext {
  advancePaid: boolean;
  balancePaid: boolean;
  freightPaid: boolean;
  logisticsMode: 'PLATFORM' | 'EXTERNAL' | null;
  inspected: boolean;
  selfCertified: boolean;
  podCaptured: boolean;
  allDisputesResolved: boolean;
  pendingSpotTests: number;
  disputeWindowElapsed: boolean;
}

export const GUARDS = {
  advancePaid: (c) => c.advancePaid || 'The 30% advance has not been received',
  balancePaid: (c) => c.balancePaid || 'The 70% balance has not been received',
  logisticsSecured: (c) => {
    if (c.logisticsMode === 'EXTERNAL') return true;
    if (c.logisticsMode === 'PLATFORM') return c.freightPaid || 'Platform freight is not fully in escrow';
    return 'Logistics have not been booked or declared';
  },
  qualityCertified: (c) => c.inspected || c.selfCertified || 'Produce has not been inspected or self-certified',
  inspected: (c) => c.inspected || 'Inspection is not complete',
  selfCertified: (c) => c.selfCertified || 'Self-certification is not complete',
  podCaptured: (c) => c.podCaptured || 'Proof of delivery has not been captured',
  disputesResolved: (c) => c.allDisputesResolved || 'There are unresolved disputes',
  windowElapsed: (c) => c.disputeWindowElapsed || 'The dispute window is still open',
  noPendingSpotTests: (c) => c.pendingSpotTests === 0 || 'A spot test is still pending',
} satisfies Record<string, (c: GuardContext) => true | string>;
export type GuardName = keyof typeof GUARDS;

/** Named side effects; the API registers one handler per name and runs them inside the transition's transaction. */
export type Effect =
  | 'ISSUE_VAN' | 'START_SLA' | 'ASSIGN_INSPECTOR' | 'NOTIFY_PARTIES' | 'RELEASE_FREIGHT' | 'OPEN_DISPUTE_WINDOW' | 'SETTLE'
  | 'REFUND_ALL' | 'POST_DEFAULT_FEE' | 'CANCEL_TIMERS' | 'ALERT_ADMIN' | 'RELEASE_MATCH';

export interface Transition {
  from: OrderState;
  to: OrderState;
  actors: readonly Actor[];
  guards?: readonly GuardName[];
  effects?: readonly Effect[];
  /** The engine fires this by itself whenever its guards pass, so orders never wait on a human for bookkeeping steps. */
  auto?: boolean;
}

const S = OrderState;
const SYS = ['SYSTEM'] as const;
const ADMIN_SYS = ['SYSTEM', 'ADMIN'] as const;
/** States in which a farmer can default: after the advance locks and before produce leaves the farm. */
const FARMER_DEFAULTABLE = [S.ADVANCE_LOCKED, S.LOGISTICS_PENDING, S.LOGISTICS_SECURED, S.AWAITING_BALANCE, S.FULLY_FUNDED, S.INSPECTION_SCHEDULED, S.INSPECTED, S.SELF_CERTIFIED] as const;
const BUYER_DEFAULTABLE = [S.ADVANCE_LOCKED, S.LOGISTICS_PENDING, S.LOGISTICS_SECURED, S.AWAITING_BALANCE] as const;
const DEPART_GUARDS = ['balancePaid', 'qualityCertified', 'logisticsSecured'] as const;
const DEPART_ACTORS = ['LOGISTICS', 'BUYER', 'FARMER', 'ADMIN'] as const;

export const ORDER_TRANSITIONS: readonly Transition[] = [
  { from: S.MATCHED, to: S.AWAITING_ADVANCE, actors: SYS, auto: true, effects: ['ISSUE_VAN', 'NOTIFY_PARTIES'] },
  { from: S.MATCHED, to: S.CANCELLED, actors: ['BUYER', 'ADMIN', 'SYSTEM'], effects: ['RELEASE_MATCH'] },
  { from: S.AWAITING_ADVANCE, to: S.CANCELLED, actors: ['BUYER', 'ADMIN', 'SYSTEM'], effects: ['CANCEL_TIMERS', 'RELEASE_MATCH', 'NOTIFY_PARTIES'] },
  { from: S.AWAITING_ADVANCE, to: S.ADVANCE_LOCKED, actors: SYS, auto: true, guards: ['advancePaid'], effects: ['START_SLA', 'ASSIGN_INSPECTOR', 'NOTIFY_PARTIES'] },
  { from: S.ADVANCE_LOCKED, to: S.LOGISTICS_PENDING, actors: SYS, auto: true },
  { from: S.LOGISTICS_PENDING, to: S.LOGISTICS_SECURED, actors: SYS, auto: true, guards: ['logisticsSecured'], effects: ['NOTIFY_PARTIES'] },
  { from: S.LOGISTICS_SECURED, to: S.AWAITING_BALANCE, actors: SYS, auto: true },
  { from: S.AWAITING_BALANCE, to: S.FULLY_FUNDED, actors: SYS, auto: true, guards: ['balancePaid'], effects: ['NOTIFY_PARTIES'] },
  { from: S.FULLY_FUNDED, to: S.INSPECTION_SCHEDULED, actors: SYS, auto: true, guards: ['balancePaid'] },
  { from: S.INSPECTION_SCHEDULED, to: S.INSPECTED, actors: ['INSPECTOR', 'BUYER', 'ADMIN'], guards: ['balancePaid', 'inspected'], effects: ['NOTIFY_PARTIES'] },
  { from: S.INSPECTION_SCHEDULED, to: S.SELF_CERTIFIED, actors: ['FARMER', 'ADMIN'], guards: ['balancePaid', 'selfCertified'], effects: ['NOTIFY_PARTIES'] },
  // Hard guard from the PRD: no departure unless the balance is in escrow AND quality is certified.
  { from: S.INSPECTED, to: S.IN_TRANSIT, actors: DEPART_ACTORS, guards: DEPART_GUARDS, effects: ['NOTIFY_PARTIES'] },
  { from: S.SELF_CERTIFIED, to: S.IN_TRANSIT, actors: DEPART_ACTORS, guards: DEPART_GUARDS, effects: ['NOTIFY_PARTIES'] },
  { from: S.IN_TRANSIT, to: S.DELIVERED, actors: ['LOGISTICS', 'BUYER', 'ADMIN'], guards: ['podCaptured'], effects: ['RELEASE_FREIGHT', 'NOTIFY_PARTIES'] },
  { from: S.DELIVERED, to: S.DISPUTE_WINDOW, actors: SYS, auto: true, effects: ['OPEN_DISPUTE_WINDOW'] },
  { from: S.DISPUTE_WINDOW, to: S.SETTLED, actors: ADMIN_SYS, guards: ['windowElapsed', 'disputesResolved', 'noPendingSpotTests'], effects: ['SETTLE', 'CANCEL_TIMERS', 'NOTIFY_PARTIES'] },
  { from: S.DISPUTE_WINDOW, to: S.DISPUTED, actors: ['BUYER', 'SYSTEM', 'ADMIN'], effects: ['ALERT_ADMIN', 'NOTIFY_PARTIES'] },
  { from: S.DISPUTED, to: S.RESOLVED, actors: ['ADMIN'], guards: ['disputesResolved'], effects: ['NOTIFY_PARTIES'] },
  { from: S.RESOLVED, to: S.SETTLED, actors: ADMIN_SYS, effects: ['SETTLE', 'CANCEL_TIMERS', 'NOTIFY_PARTIES'] },
  { from: S.RESOLVED, to: S.REFUNDED, actors: ADMIN_SYS, effects: ['REFUND_ALL', 'POST_DEFAULT_FEE', 'CANCEL_TIMERS', 'NOTIFY_PARTIES'] },
  ...FARMER_DEFAULTABLE.map((from): Transition => ({ from, to: S.FARMER_DEFAULTED, actors: ['ADMIN', 'FARMER', 'SYSTEM'], effects: ['CANCEL_TIMERS', 'NOTIFY_PARTIES'] })),
  { from: S.FARMER_DEFAULTED, to: S.REFUNDED, actors: ADMIN_SYS, auto: true, effects: ['REFUND_ALL', 'POST_DEFAULT_FEE', 'NOTIFY_PARTIES'] },
  ...BUYER_DEFAULTABLE.map((from): Transition => ({ from, to: S.BUYER_DEFAULTED, actors: ADMIN_SYS, effects: ['CANCEL_TIMERS', 'ALERT_ADMIN', 'NOTIFY_PARTIES'] })),
  { from: S.BUYER_DEFAULTED, to: S.REFUNDED, actors: ['ADMIN'], effects: ['REFUND_ALL', 'NOTIFY_PARTIES'] },
  { from: S.BUYER_DEFAULTED, to: S.CANCELLED, actors: ['ADMIN'] },
];

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; code: 'ILLEGAL_TRANSITION' | 'ACTOR_NOT_ALLOWED' | 'GUARD_FAILED'; reason: string };

export function findTransition(from: OrderState, to: OrderState): Transition | undefined {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function checkTransition(from: OrderState, to: OrderState, actor: Actor, ctx: GuardContext): TransitionCheck {
  const transition = findTransition(from, to);
  if (!transition) return { ok: false, code: 'ILLEGAL_TRANSITION', reason: `Cannot move an order from ${from} to ${to}` };
  if (!transition.actors.includes(actor)) return { ok: false, code: 'ACTOR_NOT_ALLOWED', reason: `${actor} cannot move an order from ${from} to ${to}` };
  for (const g of transition.guards ?? []) {
    const r = GUARDS[g](ctx);
    if (r !== true) return { ok: false, code: 'GUARD_FAILED', reason: r };
  }
  return { ok: true, transition };
}

/**
 * Phone numbers unlock from MATCHED onward. RFQ/listing states before a match keep them masked, and so does an RFQ or
 * listing that ended without a match.
 */
export const phonesUnlocked = (state: OrderState | RfqState | ListingState): boolean =>
  !(['RFQ_OPEN', 'BIDDING', 'LISTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED'] as string[]).includes(state);

/** Terminal order states: no further money movement. */
export const TERMINAL_STATES: readonly OrderState[] = [S.SETTLED, S.REFUNDED, S.CANCELLED];

/** Ordered happy path, used by the portals' timelines. */
export const ORDER_TIMELINE: readonly OrderState[] = [
  S.MATCHED, S.AWAITING_ADVANCE, S.ADVANCE_LOCKED, S.LOGISTICS_PENDING, S.LOGISTICS_SECURED, S.AWAITING_BALANCE, S.FULLY_FUNDED,
  S.INSPECTION_SCHEDULED, S.INSPECTED, S.IN_TRANSIT, S.DELIVERED, S.DISPUTE_WINDOW, S.SETTLED,
];

export const RFQ_TRANSITIONS: Readonly<Record<RfqState, readonly RfqState[]>> = {
  RFQ_OPEN: ['BIDDING', 'CANCELLED', 'EXPIRED'], BIDDING: ['MATCHED', 'CANCELLED', 'EXPIRED'], MATCHED: [], CANCELLED: [], EXPIRED: [],
};
export const LISTING_TRANSITIONS: Readonly<Record<ListingState, readonly ListingState[]>> = { LISTED: ['MATCHED', 'WITHDRAWN'], MATCHED: [], WITHDRAWN: [] };
export const BID_TRANSITIONS: Readonly<Record<BidState, readonly BidState[]>> = { SUBMITTED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'], ACCEPTED: [], REJECTED: [], WITHDRAWN: [] };
