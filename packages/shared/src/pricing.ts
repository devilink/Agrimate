/**
 * Pure pricing & settlement formulas — the single source of truth for the API and every portal.
 * Inputs are integers (paise, kg, metres, basis points), so results are exact and reproducible.
 */
import { applyBps, BPS_DENOMINATOR, mulDivRound } from './money';

// ---- PRD constants ----------------------------------------------------------------------------------------------
export const DEFAULT_ADVANCE_BPS = 3000; // 30% escrow lock
export const DEFAULT_COMMISSION_BPS = 300; // flat 3% of GMV
export const DEFAULT_FREIGHT_MARKUP_BPS = 800; // Final_Freight = Base_Cost × 1.08
/** Contractual, deliberately NOT configurable: 2.5% natural moisture weight-loss tolerance. */
export const SHRINKAGE_TOLERANCE_PERMILLE = 25;

export const gmvPaise = (quantityKg: number, pricePaisePerKg: bigint): bigint => {
  assertPositiveInt(quantityKg, 'quantityKg');
  if (pricePaisePerKg <= 0n) throw new RangeError('price must be positive');
  return BigInt(quantityKg) * pricePaisePerKg;
};

/** Advance is rounded; balance is the exact remainder so advance + balance always equals GMV. */
export function splitTranches(gmv: bigint, advanceBps: number = DEFAULT_ADVANCE_BPS) {
  const advance = applyBps(gmv, advanceBps);
  return { advance, balance: gmv - advance };
}

// ---- Inspection fee tiers -----------------------------------------------------------------------------------------
export interface InspectionFeeTier { maxKgInclusive: number | null; feePaise: bigint }

/** PRD default tiers: ≤2 t ₹800 · >2 t and ≤7 t ₹1,500 · >7 t ₹3,000 (DB-editable; these seed the table). */
export const DEFAULT_INSPECTION_TIERS: InspectionFeeTier[] = [
  { maxKgInclusive: 2000, feePaise: 80_000n },
  { maxKgInclusive: 7000, feePaise: 150_000n },
  { maxKgInclusive: null, feePaise: 300_000n },
];

export function inspectionFee(quantityKg: number, tiers: InspectionFeeTier[] = DEFAULT_INSPECTION_TIERS): bigint {
  assertPositiveInt(quantityKg, 'quantityKg');
  const sorted = [...tiers].sort((a, b) => (a.maxKgInclusive ?? Infinity) - (b.maxKgInclusive ?? Infinity));
  const tier = sorted.find((t) => t.maxKgInclusive === null || quantityKg <= t.maxKgInclusive);
  if (!tier) throw new RangeError(`No inspection tier covers ${quantityKg} kg`);
  return tier.feePaise;
}

// ---- Settlement ---------------------------------------------------------------------------------------------------
export interface SettlementInput {
  gmv: bigint;
  commissionBps: number;
  inspectionFee: bigint;
  /** True when the farmer bears the inspection fee (default). */
  inspectionFeeFromFarmer: boolean;
  /** Positive amount the farmer owes the platform (ledger negative balance) before this payout. */
  outstandingNegative: bigint;
  /** Dispute adjustment refunded to the buyer out of GMV. */
  buyerRefund?: bigint;
}
export interface SettlementResult {
  netGmv: bigint;
  commission: bigint;
  inspectionFee: bigint;
  /** Negative balance actually recovered from this payout. */
  negativeOffset: bigint;
  /** Negative balance still outstanding after this payout. */
  negativeRemaining: bigint;
  farmerPayout: bigint;
  /** What the farmer earned before the negative-balance offset. */
  farmerGross: bigint;
}

/** Farmer payout = GMV − commission − inspection fee − outstanding negative balance (never below zero). */
export function computeSettlement(i: SettlementInput): SettlementResult {
  const refund = i.buyerRefund ?? 0n;
  if (refund < 0n || refund > i.gmv) throw new RangeError('Buyer refund must be between 0 and GMV');
  if (i.outstandingNegative < 0n) throw new RangeError('outstandingNegative must be ≥ 0');
  const netGmv = i.gmv - refund;
  const commission = applyBps(netGmv, i.commissionBps);
  const fee = i.inspectionFeeFromFarmer ? i.inspectionFee : 0n;
  const farmerGross = max0(netGmv - commission - fee);
  const negativeOffset = i.outstandingNegative < farmerGross ? i.outstandingNegative : farmerGross;
  return {
    netGmv,
    commission,
    inspectionFee: fee,
    negativeOffset,
    negativeRemaining: i.outstandingNegative - negativeOffset,
    farmerGross,
    farmerPayout: farmerGross - negativeOffset,
  };
}

// ---- Freight ------------------------------------------------------------------------------------------------------
export interface FreightInput {
  distanceMetres: number;
  /** Tier rate in paise per km. */
  vehicleRatePaisePerKm: bigint;
  loadingFeePaise: bigint;
  quantityKg: number;
  markupBps?: number;
}
export interface FreightQuote {
  distanceKm: number;
  vehicleRatePaisePerKm: bigint;
  loadingFeePaise: bigint;
  haulagePaise: bigint;
  baseCostPaise: bigint;
  markupPaise: bigint;
  finalFreightPaise: bigint;
  /** Final freight per tonne-km, in paise, rounded. Shown to the buyer as ₹x.xx/tonne-km. */
  displayPtkmPaise: bigint;
  tonnes: number;
}

/**
 * The PRD's five-step algorithm:
 * Base_Cost = (Distance_KM × Vehicle_Rate) + Loading_Fee; Final = Base × 1.08; PTKM = Final ÷ (Distance_KM × Tonnes).
 */
export function computeFreight(i: FreightInput): FreightQuote {
  assertPositiveInt(i.distanceMetres, 'distanceMetres');
  assertPositiveInt(i.quantityKg, 'quantityKg');
  const metres = BigInt(i.distanceMetres);
  const kg = BigInt(i.quantityKg);
  const haulage = mulDivRound(metres, i.vehicleRatePaisePerKm, 1000n);
  const base = haulage + i.loadingFeePaise;
  const markupBps = BigInt(i.markupBps ?? DEFAULT_FREIGHT_MARKUP_BPS);
  const final = mulDivRound(base, BPS_DENOMINATOR + markupBps, BPS_DENOMINATOR);
  // Final ÷ ((m/1000) × (kg/1000)) = Final × 10⁶ ÷ (m × kg)
  const ptkm = mulDivRound(final, 1_000_000n, metres * kg);
  return {
    distanceKm: i.distanceMetres / 1000,
    vehicleRatePaisePerKm: i.vehicleRatePaisePerKm,
    loadingFeePaise: i.loadingFeePaise,
    haulagePaise: haulage,
    baseCostPaise: base,
    markupPaise: final - base,
    finalFreightPaise: final,
    displayPtkmPaise: ptkm,
    tonnes: i.quantityKg / 1000,
  };
}

export interface VehicleTierLike { id: string; minKg: number; maxKg: number; ratePaisePerKm: bigint }
/** Smallest tier whose capacity covers the payload; matched on capacity so gaps between bands still resolve. */
export function pickVehicleTier<T extends VehicleTierLike>(quantityKg: number, tiers: T[]): T {
  const t = [...tiers].sort((a, b) => a.maxKg - b.maxKg).find((x) => quantityKg <= x.maxKg);
  if (!t) throw new RangeError(`No vehicle tier can carry ${quantityKg} kg`);
  return t;
}

// ---- Transit shrinkage --------------------------------------------------------------------------------------------
/** discrepancy % = (dispatched − received) ÷ dispatched × 100, returned as a display number. */
export function discrepancyPercent(dispatchedKg: number, receivedKg: number): number {
  assertPositiveInt(dispatchedKg, 'dispatchedKg');
  return Math.round(((dispatchedKg - receivedKg) / dispatchedKg) * 100 * 100) / 100;
}

/** Exact integer test — a weight dispute is allowed only when discrepancy is strictly above 2.5%. */
export function weightDisputeAllowed(dispatchedKg: number, receivedKg: number): boolean {
  assertPositiveInt(dispatchedKg, 'dispatchedKg');
  if (receivedKg < 0) throw new RangeError('receivedKg must be ≥ 0');
  return (dispatchedKg - receivedKg) * 1000 > dispatchedKg * SHRINKAGE_TOLERANCE_PERMILLE;
}

const max0 = (v: bigint) => (v < 0n ? 0n : v);
function assertPositiveInt(v: number, name: string) {
  if (!Number.isInteger(v) || v <= 0) throw new RangeError(`${name} must be a positive integer, got ${v}`);
}
