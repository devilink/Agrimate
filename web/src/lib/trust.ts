import type { Party } from '@/lib/types';

export type TrustLevel = 'trusted' | 'verified' | 'unverified';

/** Completed trades needed, on top of a full checklist, for the "Trusted trader" badge. */
export const TRUSTED_MIN_TRADES = 10;

type TrustInput = Pick<Party, 'verified' | 'kyc_verified' | 'gst_verified' | 'bank_verified' | 'is_fpo' | 'completed_trades'>;

/**
 * Badges shown to other members. "Verified" is the admin's go-ahead to trade. "Trusted" also needs identity and bank
 * checked, GSTIN checked (or FPO registration), and a track record of completed trades on Agrimate.
 */
export function trustLevel(p: TrustInput): TrustLevel {
  if (!p.verified) return 'unverified';
  if (p.kyc_verified && p.bank_verified && (p.gst_verified || p.is_fpo) && p.completed_trades >= TRUSTED_MIN_TRADES) {
    return 'trusted';
  }
  return 'verified';
}

export const CHECKLIST: { key: 'kyc_verified' | 'gst_verified' | 'bank_verified' | 'is_fpo'; label: string; hint: string }[] = [
  { key: 'kyc_verified', label: 'Identity (KYC)', hint: 'PAN or Aadhaar seen and matched to the name' },
  { key: 'gst_verified', label: 'GSTIN', hint: 'Checked as active on the GST portal' },
  { key: 'bank_verified', label: 'Bank account', hint: 'Penny drop or cancelled cheque matches the name' },
  { key: 'is_fpo', label: 'Registered FPO', hint: 'Farmer Producer Organisation certificate seen' },
];
