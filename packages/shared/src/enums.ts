/** Shared enums. Values mirror the Prisma enums one-for-one (a test in apps/api asserts parity). */
const e = <T extends string>(...v: T[]) => Object.freeze(Object.fromEntries(v.map((k) => [k, k]))) as { readonly [K in T]: K };
export type ValueOf<T> = T[keyof T];

export const Role = e('BUYER', 'FARMER', 'INSPECTOR', 'LOGISTICS', 'ADMIN');
export type Role = ValueOf<typeof Role>;

export const OrderState = e(
  'MATCHED', 'AWAITING_ADVANCE', 'ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE',
  'FULLY_FUNDED', 'INSPECTION_SCHEDULED', 'INSPECTED', 'SELF_CERTIFIED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW',
  'SETTLED', 'FARMER_DEFAULTED', 'REFUNDED', 'BUYER_DEFAULTED', 'DISPUTED', 'RESOLVED', 'CANCELLED',
);
export type OrderState = ValueOf<typeof OrderState>;

export const RfqState = e('RFQ_OPEN', 'BIDDING', 'MATCHED', 'CANCELLED', 'EXPIRED');
export type RfqState = ValueOf<typeof RfqState>;
export const ListingState = e('LISTED', 'MATCHED', 'WITHDRAWN');
export type ListingState = ValueOf<typeof ListingState>;
export const BidState = e('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
export type BidState = ValueOf<typeof BidState>;

export const OrderFlow = e('RFQ', 'CATALOG');
export type OrderFlow = ValueOf<typeof OrderFlow>;
export const TrancheKind = e('ADVANCE', 'BALANCE', 'FREIGHT');
export type TrancheKind = ValueOf<typeof TrancheKind>;
export const TrancheStatus = e('PENDING', 'PARTIAL', 'PAID');
export type TrancheStatus = ValueOf<typeof TrancheStatus>;
export const LogisticsMode = e('PLATFORM', 'EXTERNAL');
export type LogisticsMode = ValueOf<typeof LogisticsMode>;

export const VerificationStatus = e('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED');
export type VerificationStatus = ValueOf<typeof VerificationStatus>;
export const FarmerType = e('INDIVIDUAL', 'FPO');
export type FarmerType = ValueOf<typeof FarmerType>;
export const LogisticsPartnerType = e('INDIVIDUAL', 'AGENCY');
export type LogisticsPartnerType = ValueOf<typeof LogisticsPartnerType>;

/** Degree dropdown. Animal husbandry / veterinary are listed so that they can be explicitly rejected. */
export const DegreeType = e('BSC_AGRICULTURE', 'MSC_AGRICULTURE', 'BSC_ANIMAL_HUSBANDRY', 'MSC_ANIMAL_HUSBANDRY', 'VETERINARY');
export type DegreeType = ValueOf<typeof DegreeType>;
export const ALLOWED_DEGREES: readonly DegreeType[] = [DegreeType.BSC_AGRICULTURE, DegreeType.MSC_AGRICULTURE];

export const FilePurpose = e(
  'KYC_DOC', 'DEGREE_CERT', 'RC', 'DRIVING_LICENCE', 'FITNESS_CERT', 'ORGANIC_CERT', 'DISPATCH_PHOTO', 'INSPECTION_PHOTO',
  'SELF_CERT_VIDEO', 'EWAY_BILL', 'POD_PHOTO', 'POD_SIGNATURE', 'DISPUTE_EVIDENCE', 'SPOT_TEST_REPORT',
);
export type FilePurpose = ValueOf<typeof FilePurpose>;

export const DisputeType = e('WEIGHT', 'QUALITY');
export type DisputeType = ValueOf<typeof DisputeType>;
export const DisputeStatus = e('OPEN', 'RESOLVED');
export type DisputeStatus = ValueOf<typeof DisputeStatus>;
export const DisputeOutcome = e('RELEASE_TO_FARMER', 'PARTIAL_REFUND', 'FULL_REFUND_FARMER_FAULT');
export type DisputeOutcome = ValueOf<typeof DisputeOutcome>;
export const SpotTestStatus = e('REQUESTED', 'PASSED', 'FAILED');
export type SpotTestStatus = ValueOf<typeof SpotTestStatus>;

export const InspectionStatus = e('UNASSIGNED', 'ASSIGNED', 'CHECKED_IN', 'INSPECTED', 'FAILED_GRADE', 'WAIVED_SELF_CERT');
export type InspectionStatus = ValueOf<typeof InspectionStatus>;
export const TripStatus = e('OPEN', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED');
export type TripStatus = ValueOf<typeof TripStatus>;
export const PayoutStatus = e('BLOCKED', 'PENDING', 'PROCESSED', 'FAILED');
export type PayoutStatus = ValueOf<typeof PayoutStatus>;
export const PayeeType = e('FARMER', 'LOGISTICS', 'INSPECTOR');
export type PayeeType = ValueOf<typeof PayeeType>;
export const InvoiceType = e('BUYER_INVOICE', 'FARMER_STATEMENT', 'LOGISTICS_PAYOUT');
export type InvoiceType = ValueOf<typeof InvoiceType>;
export const SlaTimerKind = e(
  'REMINDER_T24', 'REMINDER_T6', 'REMINDER_T1', 'SLA_BREACH', 'INSPECTOR_RETRY', 'SELF_CERT_FALLBACK', 'DISPUTE_WINDOW_END',
);
export type SlaTimerKind = ValueOf<typeof SlaTimerKind>;
export const AlertKind = e(
  'UNDERPAYMENT', 'OVERPAYMENT', 'UNMATCHED_PAYMENT', 'BUYER_DEFAULT', 'SLA_BREACH', 'INSPECTION_FAILED', 'INSPECTOR_ESCALATION',
  'RECONCILIATION_MISMATCH', 'PAYOUT_FAILED',
);
export type AlertKind = ValueOf<typeof AlertKind>;
export const InspectionFeePayer = e('FARMER', 'BUYER');
export type InspectionFeePayer = ValueOf<typeof InspectionFeePayer>;
export const BidPriceRule = e('LTE_TARGET', 'EQ_TARGET');
export type BidPriceRule = ValueOf<typeof BidPriceRule>;
export const LANGUAGES = ['en', 'hi', 'as', 'bn'] as const;
export type Language = (typeof LANGUAGES)[number];
