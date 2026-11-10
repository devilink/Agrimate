export interface OrganicCert { id: string; fileId: string; certifier: string; certNumber: string; expiresAt: string; status: string; note: string | null; createdAt: string }

/** Only a verified, unexpired certificate can make produce organic. */
export const certIsUsable = (c: OrganicCert) => c.status === 'VERIFIED' && new Date(c.expiresAt) > new Date();

/** Dropdown instead of free text. The value is stored as the certifier; "Other" stays reviewable by the admin who verifies. */
export const CERTIFIERS = ['NPOP', 'PGS_INDIA', 'JAIVIK_BHARAT', 'OTHER'];
