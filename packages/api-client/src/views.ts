/**
 * Response shapes. Money fields (…Paise) are decimal strings: pass them straight to formatINR() from @agrimate/shared.
 * Dates are ISO strings in UTC; display with formatIST().
 */
import type { GradeParameter } from '@agrimate/shared';

export type Paise = string;
export interface CommodityRef { id: string; code: string; name: string; names?: Record<string, string> }
export interface GradeRef { id: string; code: string; name: string; parameters: GradeParameter[] }
export interface Commodity extends CommodityRef { grades: GradeRef[] }
export interface VehicleTier { id: string; code: string; name: string; minKg: number; maxKg: number; ratePaisePerKm: Paise; active: boolean }
export interface InspectionFeeTier { id: string; maxKgInclusive: number | null; feePaise: Paise }
export interface Tranche { kind: 'ADVANCE' | 'BALANCE' | 'FREIGHT'; expectedPaise: Paise; receivedPaise: Paise; status: 'PENDING' | 'PARTIAL' | 'PAID'; paidAt?: string | null }
export interface Party { id: string; name: string; phone: string; phoneUnlocked: boolean; district?: string | null; state?: string | null }
export interface FreightBreakdown { distanceKm: number; ratePaisePerKm: Paise; loadingFeePaise: Paise; baseCostPaise: Paise; markupPaise: Paise; finalFreightPaise: Paise; displayPtkmPaise: Paise }
export interface FreightQuote { distanceKm: number; vehicleRatePaisePerKm: Paise; loadingFeePaise: Paise; haulagePaise: Paise; baseCostPaise: Paise; markupPaise: Paise; finalFreightPaise: Paise; displayPtkmPaise: Paise; tonnes: number; tierCode: string; tierName: string }
export interface InspectionView { id: string; status: string; scheduledFor: string; inspectorId: string | null; checkInAt: string | null; readings: Record<string, number> | null; gradeCheck: { ok: boolean; outOfSpec: string[]; missing: string[]; invalid: string[] } | null; scaleWeightKg: number | null; inspectedAt: string | null; photoFileIds: string[]; deviationAcceptedAt: string | null }
export interface SelfCertView { submittedAt: string | null; certifiedWeightKg: number | null; scaleVideoFileId: string | null; vehicleVideoFileId: string | null; scaleCapture: unknown; vehicleCapture: unknown }
export interface TripView { id: string; status: string; vehicleRegNo: string | null; tierCode: string; distanceKm: number; ewayBillNumber: string | null; noCoLoadingAttestedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null; podPhotoFileId: string | null; ewayBillFileId: string | null; fundedAt: string | null }
export interface DisputeView { id: string; orderId: string; type: 'WEIGHT' | 'QUALITY'; reason: string; evidenceFileIds: string[]; discrepancyPercent: number | null; status: 'OPEN' | 'RESOLVED'; outcome: string | null; refundPaise: Paise | null; resolutionNote: string | null; createdAt: string }
export interface SpotTestView { id: string; orderId: string; status: 'REQUESTED' | 'PASSED' | 'FAILED'; reportFileId: string | null; resultNote: string | null; createdAt: string }
export interface InvoiceRef { id: string; number: string; type: 'BUYER_INVOICE' | 'FARMER_STATEMENT' | 'LOGISTICS_PAYOUT'; createdAt: string }
export interface OrderEventView { id: string; orderId: string; actorId: string | null; actorRole: string; from: string | null; to: string; payload: Record<string, unknown>; createdAt: string }

interface OrderBase {
  id: string; code: string; flow: 'RFQ' | 'CATALOG'; state: string; isOrganic: boolean; quantityKg: number; createdAt: string;
  commodity: CommodityRef; grade: GradeRef; pickupPin: string; pickupLat: number; pickupLng: number; deliveryPin: string; t0At: string | null; slaDays: number; slaDeadlineAt: string | null; inspectionDayAt: string | null; logisticsMode: 'PLATFORM' | 'EXTERNAL' | null; selfCertRequired: boolean;
  dispatchedWeightKg: number | null; receivedWeightKg: number | null; deliveredAt: string | null; disputeDeadlineAt: string | null; settledAt: string | null; inspection: InspectionView | null; selfCert: SelfCertView | null; selfCertifiedBadge: boolean;
  farmer: Party;
}
interface OrderCommercial {
  buyer: Party; pricePaisePerKg: Paise; gmvPaise: Paise; advanceBps: number; commissionBps: number; inspectionFeePaise: Paise; inspectionFeePayer: string; buyerRefundPaise: Paise;
  tranches: Tranche[]; invoices: InvoiceRef[]; contract: { version: string; acceptedAt: string | null; body: string }; disputes: DisputeView[]; spotTests: SpotTestView[]; trip: TripView | null;
}
/** GET /orders/:id as a buyer (or admin, which adds payouts and events). */
export interface BuyerOrder extends OrderBase, OrderCommercial {
  virtualAccount: { ifsc: string; accountNumber: string; beneficiary: string; closedAt: string | null } | null;
  freight: FreightBreakdown | null; external: { vehicleNo: string; driverPhone: string } | null; escrowPaise: Paise;
  payouts?: { id: string; payeeType: string; payeeId: string; amountPaise: Paise; status: string; statusNote: string | null }[]; events?: OrderEventView[];
}
/** GET /orders/:id as a farmer. */
export interface FarmerOrder extends OrderBase, OrderCommercial {
  settlementPreview: { netGmv: Paise; commission: Paise; inspectionFee: Paise; negativeOffset: Paise; negativeRemaining: Paise; farmerPayout: Paise; farmerGross: Paise };
  dispatchPhotos: { id: string; fileId: string; createdAt: string }[];
}
export interface OrderListItem { id: string; code: string; flow: string; state: string; commodity: string; grade: string; isOrganic: boolean; quantityKg: number; slaDeadlineAt: string | null; createdAt: string; gmvPaise?: Paise; tranches?: Pick<Tranche, 'kind' | 'status' | 'expectedPaise' | 'receivedPaise'>[] }
export interface DisputeEligibility { windowOpen: boolean; disputeDeadlineAt: string | null; dispatchedWeightKg: number | null; receivedWeightKg: number | null; discrepancyPercent: number | null; tolerancePercent: number; weightDisputeAllowed: boolean; qualityDisputeAllowed: boolean; spotTestAllowed: boolean }

export interface RfqView { id: string; code: string; buyerId: string; commodityId: string; gradeId: string; commodity: CommodityRef; grade: GradeRef; quantityKg: number; deliveryPin: string; neededBy: string; suggestedPricePaisePerKg: Paise | null; targetPricePaisePerKg: Paise; organicRequired: boolean; state: string; createdAt: string; buyerName: string; buyerPhoneMasked: string; bidCount: number; myBid?: { id: string; pricePaisePerKg: Paise; quantityKg: number; state: string } | null; order: { id: string; code: string } | null }
export interface BidView { id: string; rfqId: string; state: string; quantityKg: number; pricePaisePerKg: Paise; createdAt: string; farmer: { id: string; name: string; type: string; fpoName: string | null; district: string | null; state: string | null; phoneMasked: string } }
export interface ListingView { id: string; code: string; state: string; quantityKg: number; pricePaisePerKg: Paise; gmvPaise: Paise; pickupPin: string; createdAt: string; isOrganic: boolean; commodity: CommodityRef; grade: GradeRef; farmer: { name: string; type: string; fpoName: string | null; district: string | null; state: string | null; phoneMasked: string } }
export interface PricePoint { date: string; market: string; state: string; minPaisePerKg: Paise; maxPaisePerKg: Paise; modalPaisePerKg: Paise; source: string }
export interface PriceSuggestion { averagePaisePerKg: Paise | null; sampleSize: number; windowDays: number }
export interface MeView { id: string; role: string; name: string; language: string; phoneLast4: string; email: string | null; phone: string; buyer: { companyName: string; kybStatus: string; kybNote: string | null; gstin: string | null; defaultPin: string | null } | null; farmer: { type: string; fpoName: string | null; kycStatus: string; kycNote: string | null; payoutsEnabled: boolean; pin: string | null; district: string | null; state: string | null; bankLast4: string | null; panLast4: string | null } | null; inspector: { status: string; statusNote: string | null; available: boolean; serviceRadiusKm: number; degreeType: string | null; pin: string | null } | null; logistics: { status: string; statusNote: string | null; partnerType: string; companyName: string | null; noCoLoadingAcceptedAt: string | null } | null }
export interface FarmerLedger { negativeBalancePaise: Paise; payablePaise: Paise; payouts: { id: string; orderCode: string; amountPaise: Paise; status: string; statusNote: string | null; createdAt: string }[]; entries: { id: string; type: string; memo: string | null; account: string; orderId: string | null; amountPaise: Paise; createdAt: string }[] }
export interface EarningsView { totalPaidPaise: Paise; payouts: { id: string; orderCode: string; amountPaise: Paise; status: string; statusNote: string | null; createdAt: string }[] }
export interface InspectorJob { id: string; orderId: string; orderCode: string; orderState: string; status: string; scheduledFor: string; commodity: string; grade: string; quantityKg: number; pickupPin: string; pickupLat: number; pickupLng: number; parameters: GradeParameter[]; checkInAt: string | null; readings: Record<string, number> | null; scaleWeightKg: number | null; photoFileIds: string[] }
export interface AvailableTrip { id: string; orderCode: string; commodity: string; quantityKg: number; pickupPin: string; dropPin: string; distanceKm: number; tierCode: string; payoutPaise: Paise; slaDeadlineAt: string | null }
export interface MyTrip { id: string; orderId: string; orderCode: string; orderState: string; status: string; commodity: string; quantityKg: number; pickupPin: string; pickupLat: number; pickupLng: number; dropPin: string; distanceKm: number; payoutPaise: Paise; vehicleRegNo?: string; ewayBillNumber: string | null; pickedUpAt: string | null; deliveredAt: string | null }
export interface VehicleView { id: string; regNo: string; capacityKg: number; tier: VehicleTier }
export interface CaptureSession { sessionId: string; captureToken: string; serverTime: string; expiresAt: string; kind: 'SCALE' | 'VEHICLE' }

export interface RateDial { value: number | null; ok: number; sample: number }
export interface AnalyticsRow { name: string; gmvPaise: Paise; orders: number }
export interface AnalyticsSummary {
  role: string; days: number; generatedAt: string;
  kpis: { gmvPaise: Paise; previousGmvPaise: Paise; orders: number; previousOrders: number; quantityKg: number; activeOrders: number; escrowPaise: Paise; duePaise: Paise; receivedPaise: Paise; commissionPaise?: Paise };
  dials: { slaOnTime: RateDial; qualityPass: RateDial; disputeFree: RateDial; completion: RateDial; payoutSuccess?: RateDial };
  trend: { date: string; gmvPaise: Paise; orders: number }[];
  pipeline: { key: string; label: string; states: string[]; count: number }[];
  outcomes: { key: string; label: string; count: number }[];
  split: { key: string; label: string; paise: Paise }[];
  commodities: AnalyticsRow[];
  regions: AnalyticsRow[];
}
export type GraphNodeType = 'BUYER' | 'FARMER' | 'COMMODITY' | 'STATE' | 'INSPECTOR' | 'TRANSPORTER';
export interface KnowledgeGraphNode { id: string; type: GraphNodeType; label: string; gmvPaise: Paise; orderCount: number; flagged: boolean; orders: { id: string; code: string; state: string }[] }
export interface KnowledgeGraphLink { source: string; target: string; kind: string; orderCount: number; gmvPaise: Paise }
export interface KnowledgeGraphView { days: number; truncatedOrders: boolean; hiddenNodes: number; nodes: KnowledgeGraphNode[]; links: KnowledgeGraphLink[] }
