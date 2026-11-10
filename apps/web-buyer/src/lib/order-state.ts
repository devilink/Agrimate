/** How order states read to a buyer: which are still live, and what happens next. The API alone decides what is allowed. */
import type { OrderListItem } from '@agrimate/api-client';

const CLOSED = ['SETTLED', 'REFUNDED', 'CANCELLED'];
export const isActiveOrder = (state: string) => !CLOSED.includes(state);

/** States that have left the normal path; they get failure styling on the timeline. */
export const OFF_PATH_STATES = ['FARMER_DEFAULTED', 'BUYER_DEFAULTED', 'DISPUTED', 'RESOLVED', 'REFUNDED', 'CANCELLED'];
/** Off-path states after which the remaining normal steps will never happen. */
export const DEAD_END_STATES = ['FARMER_DEFAULTED', 'BUYER_DEFAULTED', 'REFUNDED', 'CANCELLED'];

export function nextStep(o: Pick<OrderListItem, 'state' | 'tranches'>): string {
  const freight = o.tranches?.find((t) => t.kind === 'FREIGHT');
  const freightDue = !!freight && freight.status !== 'PAID';
  switch (o.state) {
    case 'MATCHED':
    case 'AWAITING_ADVANCE': return 'Pay the advance';
    case 'ADVANCE_LOCKED':
    case 'LOGISTICS_PENDING': return freightDue ? 'Pay the freight' : 'Choose logistics';
    case 'LOGISTICS_SECURED':
    case 'AWAITING_BALANCE': return 'Pay the balance';
    case 'FULLY_FUNDED':
    case 'INSPECTION_SCHEDULED': return 'Waiting for quality check';
    case 'INSPECTED':
    case 'SELF_CERTIFIED': return 'Ready to depart';
    case 'IN_TRANSIT': return 'In transit';
    case 'DELIVERED':
    case 'DISPUTE_WINDOW': return 'Check the delivery';
    case 'DISPUTED': return 'Dispute under review';
    case 'RESOLVED': return 'Closing after dispute';
    case 'FARMER_DEFAULTED': return 'Refund in progress';
    case 'BUYER_DEFAULTED': return 'Under admin review';
    default: return 'No action needed';
  }
}

/** Unpaid amount across tranches, in paise. */
export function outstandingPaise(o: Pick<OrderListItem, 'tranches'>): bigint {
  return (o.tranches ?? []).reduce((sum, t) => {
    const due = BigInt(t.expectedPaise) - BigInt(t.receivedPaise);
    return due > 0n ? sum + due : sum;
  }, 0n);
}
