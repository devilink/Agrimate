/**
 * Response shapes of the admin endpoints, which views.ts in the API client does not cover.
 * Written from apps/api/src/admin/admin.ts and checked against the running API.
 */
export type Paise = string;
export type QueueKind = 'kyb' | 'kyc' | 'inspector' | 'logistics' | 'organic';

export interface KybItem { id: string; name: string; companyName: string | null; gstin: string | null; panLast4: string | null; status: string; note: string | null; response: unknown }
export interface KycItem { id: string; name: string; panName: string | null; bankHolderName: string | null; panLast4: string | null; bankLast4: string | null; bankIfsc: string | null; status: string; note: string | null; response: unknown }
export interface InspectorItem { id: string; name: string; degreeType: string | null; degreeFileId: string | null; status: string; pin: string | null }
export interface LogisticsItem { id: string; name: string; partnerType: string; companyName: string | null; gstin: string | null; rcFileId: string | null; dlFileId: string | null; fitnessFileId: string | null; status: string; noCoLoadingAcceptedAt: string | null; vehicles: { id: string; regNo: string; capacityKg: number; tier?: { code: string; name: string } }[] }
export interface OrganicItem { id: string; farmer: string; certifier: string; certNumber: string; expiresAt: string; fileId: string | null; status: string }
export interface Queues { kyb: KybItem[]; kyc: KycItem[]; inspector: InspectorItem[]; logistics: LogisticsItem[]; organic: OrganicItem[] }

export interface AdminOrderRow { id: string; code: string; state: string; flow: string; commodity: string; grade: string; quantityKg: number; gmvPaise: Paise; buyer: string; farmer: string; slaDeadlineAt: string | null; createdAt: string }
export interface InspectorOption { id: string; name: string; available: boolean; pin: string | null; serviceRadiusKm: number }

export interface AdminDispute {
  id: string; orderId: string; raisedBy: string; type: 'WEIGHT' | 'QUALITY'; reason: string; evidenceFileIds: string[]; discrepancyPercent: number | null; status: 'OPEN' | 'RESOLVED';
  outcome: string | null; refundPaise: Paise | null; resolutionNote: string | null; resolvedAt?: string | null; createdAt: string;
  order: { code: string; state: string; dispatchedWeightKg: number | null; receivedWeightKg: number | null; gmvPaise: Paise };
}

export interface AdminPayout { id: string; orderId: string; payeeType: string; payeeId: string; amountPaise: Paise; status: string; statusNote: string | null; gatewayTransferId: string | null; createdAt: string; updatedAt: string; order: { code: string } }

export interface LedgerAccounts { trialBalancePaise: Paise; accounts: { code: string; type: string; balancePaise: Paise }[] }
export interface Journal { id: string; idempotencyKey: string; type: string; orderId: string | null; memo: string | null; createdAt: string; postings: { id: string; amountPaise: Paise; account: { code: string } }[] }
export interface EscrowView { totalPaise: Paise; nodalPaise: Paise; orders: { orderId: string; escrowPaise: Paise; order: { code: string; state: string } | null }[] }

export interface AuditEntry { id: string; actorId: string | null; actorRole: string; action: string; entity: string; entityId: string | null; data: unknown; createdAt: string }
export interface AdminAlert { id: string; kind: string; orderId: string | null; message: string; data: unknown; resolvedAt: string | null; createdAt: string }
export interface SlaBoard { alerts: AdminAlert[]; overdue: { id: string; code: string; state: string; slaDeadlineAt: string }[] }
export interface ReconReport { id: string; forDate: string; ledgerInPaise: Paise; gatewayInPaise: Paise; ledgerOutPaise: Paise; gatewayOutPaise: Paise; matched: boolean; details: { gatewayTxnCount?: number; trialBalancePaise?: string } | null; createdAt: string }
export interface ContractTerms { id: string; version: string; body: string; active: boolean; createdAt: string }
export type PlatformConfig = Record<string, string | number | boolean>;

/** GET /admin/inspections */
export interface AdminInspection {
  id: string; orderId: string; orderCode: string; orderState: string; status: string; scheduledFor: string; commodity: string; grade: string; quantityKg: number; pickupPin: string; farmer: string;
  inspectorId: string | null; inspector: string | null; assignAttempts: number; selfCertRequired: boolean; checkInAt: string | null; checkInMetres: number | null; scaleWeightKg: number | null;
  gradeCheck: { ok: boolean; outOfSpec: string[]; missing: string[]; invalid: string[] } | null; inspectedAt: string | null;
}
/** GET /admin/inspectors */
export interface AdminInspector { id: string; name: string; available: boolean; pin: string | null; serviceRadiusKm: number }
/** GET /admin/trips */
export interface AdminTrip {
  id: string; orderId: string; orderCode: string; orderState: string; status: string; commodity: string; quantityKg: number; pickupPin: string; dropPin: string; distanceKm: number; tierCode: string;
  finalFreightPaise: string; payoutPaise: string; fundedAt: string | null; partner: string | null; vehicleRegNo: string | null; ewayBillNumber: string | null;
  acceptedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null; podOtpVerified: boolean; slaDeadlineAt: string | null; createdAt: string;
}
