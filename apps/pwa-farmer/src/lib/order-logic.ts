import type { FarmerOrder, OrderEventView } from '@agrimate/api-client';
import { ORDER_TIMELINE, formatIST } from '@agrimate/shared';

export const ACTIVE_STATES = ['MATCHED', 'AWAITING_ADVANCE', 'ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE', 'FULLY_FUNDED', 'INSPECTION_SCHEDULED', 'INSPECTED', 'SELF_CERTIFIED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW', 'DISPUTED', 'RESOLVED'];
const BEFORE_FUNDED = ['ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE'];

export interface NextStep {
  /** Message key. */
  text: string;
  vars?: Record<string, string>;
  /** Screen to open; absent when the farmer has nothing to do but wait. */
  href?: string;
  action?: string;
  tone: 'act' | 'wait' | 'done' | 'alert';
}

/** The one thing the farmer should do next on this order. Display only: the API enforces every rule. */
export function nextStep(o: FarmerOrder): NextStep {
  const certPending = o.selfCertRequired && !o.selfCert?.submittedAt;
  const clipsDone = !!o.selfCert?.scaleVideoFileId && !!o.selfCert?.vehicleVideoFileId;
  const selfCertHref = `/orders/self-cert?id=${o.id}`;
  const dispatchHref = `/orders/dispatch?id=${o.id}`;
  const inspectionDay = o.inspectionDayAt ? formatIST(o.inspectionDayAt) : '';

  switch (o.state) {
    case 'MATCHED':
    case 'AWAITING_ADVANCE':
      return { text: 'next.waitAdvance', tone: 'wait' };
    case 'ADVANCE_LOCKED':
    case 'LOGISTICS_PENDING':
    case 'LOGISTICS_SECURED':
    case 'AWAITING_BALANCE':
    case 'FULLY_FUNDED':
    case 'INSPECTION_SCHEDULED': {
      if (o.inspection?.status === 'FAILED_GRADE') return { text: 'next.inspectionFailed', tone: 'alert', href: `/orders/detail?id=${o.id}`, action: 'next.seeReport' };
      if (certPending) {
        if (!clipsDone) return { text: 'next.recordVideos', tone: 'act', href: selfCertHref, action: 'next.recordVideosAction' };
        if (o.state === 'INSPECTION_SCHEDULED') return { text: 'next.submitWeight', tone: 'act', href: selfCertHref, action: 'next.submitWeightAction' };
        return { text: 'next.waitBalanceVideosDone', tone: 'wait' };
      }
      if (BEFORE_FUNDED.includes(o.state)) return { text: 'next.harvestNow', tone: 'act', vars: { date: inspectionDay } };
      return { text: 'next.inspectionDay', tone: 'act', vars: { date: inspectionDay } };
    }
    case 'INSPECTED':
    case 'SELF_CERTIFIED':
      if (!o.dispatchPhotos.length) return { text: 'next.dispatchPhotos', tone: 'act', href: dispatchHref, action: 'next.dispatchPhotosAction' };
      if (o.logisticsMode === 'EXTERNAL') return { text: 'next.confirmDeparted', tone: 'act', href: dispatchHref, action: 'next.confirmDepartedAction' };
      return { text: 'next.waitTruck', tone: 'wait' };
    case 'IN_TRANSIT':
      return { text: 'next.inTransit', tone: 'wait' };
    case 'DELIVERED':
    case 'DISPUTE_WINDOW':
      return { text: 'next.paymentSoon', tone: 'wait', vars: { date: o.disputeDeadlineAt ? formatIST(o.disputeDeadlineAt) : '' } };
    case 'DISPUTED':
    case 'RESOLVED':
      return { text: 'next.disputed', tone: 'alert' };
    case 'SETTLED':
      return { text: 'next.paid', tone: 'done', href: '/ledger', action: 'next.paidAction' };
    default:
      return { text: 'next.closed', tone: 'alert' };
  }
}

export interface TimelineStep { key: string; done: boolean; current: boolean; at: string | null }
const STEPS: { key: string; states: string[] }[] = [
  { key: 'confirmed', states: ['MATCHED'] },
  { key: 'advance', states: ['ADVANCE_LOCKED'] },
  { key: 'transport', states: ['LOGISTICS_SECURED'] },
  { key: 'funded', states: ['FULLY_FUNDED'] },
  { key: 'quality', states: ['INSPECTED', 'SELF_CERTIFIED'] },
  { key: 'departed', states: ['IN_TRANSIT'] },
  { key: 'delivered', states: ['DELIVERED'] },
  { key: 'paid', states: ['SETTLED'] },
];

const rank = (state: string) => {
  const aliased = state === 'SELF_CERTIFIED' ? 'INSPECTED' : state === 'DISPUTED' || state === 'RESOLVED' ? 'DISPUTE_WINDOW' : state;
  return (ORDER_TIMELINE as readonly string[]).indexOf(aliased);
};

/** Eight plain steps instead of the 13 internal states. Events give the times; orders off the happy path use them alone. */
export function buildTimeline(o: FarmerOrder, events: OrderEventView[] | undefined): TimelineStep[] {
  const now = rank(o.state);
  const steps = STEPS.map(({ key, states }) => {
    const event = events?.find((e) => states.includes(e.to));
    const reached = !!event || (now >= 0 && now >= Math.min(...states.map(rank).filter((r) => r >= 0)));
    return { key, done: reached, current: false, at: event?.createdAt ?? null };
  });
  const firstOpen = steps.findIndex((s) => !s.done);
  if (firstOpen >= 0 && now >= 0) steps[firstOpen]!.current = true;
  return steps;
}
