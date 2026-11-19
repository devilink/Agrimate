import { Field, Input, Textarea } from '@/components/ui';
import type { Party, PartyPrivate } from '@/lib/types';

/** Shared fields for a party's public profile and private details. */
export function PartyFormFields({ party, priv, lockFinancial = false, showAdminNotes = false }: {
  party?: Partial<Party>; priv?: Partial<PartyPrivate> | null; lockFinancial?: boolean; showAdminNotes?: boolean;
}) {
  const lockHint = lockFinancial ? 'Locked after verification. Contact Agrimate to change it.' : undefined;
  return (
    <>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-stone-900">Profile <span className="font-normal text-stone-500">· visible to other members</span></legend>
        <Field label="Name"><Input name="name" required maxLength={120} defaultValue={party?.name ?? ''} /></Field>
        <Field label="Company / FPO"><Input name="company" maxLength={160} defaultValue={party?.company ?? ''} /></Field>
        <Field label="District"><Input name="district" maxLength={80} defaultValue={party?.district ?? ''} /></Field>
        <Field label="State"><Input name="state" maxLength={80} defaultValue={party?.state ?? ''} /></Field>
        <Field label="PIN code"><Input name="pin" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} defaultValue={party?.pin ?? ''} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-stone-900">Contact and bank details <span className="font-normal text-stone-500">· private to you and Agrimate</span></legend>
        <Field label="Mobile"><Input name="phone" type="tel" maxLength={20} defaultValue={priv?.phone ?? ''} /></Field>
        <Field label="Email"><Input name="email" type="email" maxLength={254} defaultValue={priv?.email ?? ''} /></Field>
        <Field label="Address"><Input name="address" maxLength={500} defaultValue={priv?.address ?? ''} /></Field>
        <Field label="GSTIN" hint={lockHint}><Input name="gstin" maxLength={15} defaultValue={priv?.gstin ?? ''} disabled={lockFinancial} /></Field>
        <Field label="PAN" hint={lockHint}><Input name="pan" maxLength={10} defaultValue={priv?.pan ?? ''} disabled={lockFinancial} /></Field>
        <Field label="Bank account holder" hint={lockHint}><Input name="bank_holder" maxLength={120} defaultValue={priv?.bank_holder ?? ''} disabled={lockFinancial} /></Field>
        <Field label="Bank account number" hint={lockHint}><Input name="bank_account_no" inputMode="numeric" maxLength={20} defaultValue={priv?.bank_account_no ?? ''} disabled={lockFinancial} /></Field>
        <Field label="IFSC" hint={lockHint}><Input name="bank_ifsc" maxLength={11} defaultValue={priv?.bank_ifsc ?? ''} disabled={lockFinancial} /></Field>
        <Field label="UPI ID" hint={lockHint}><Input name="upi_id" maxLength={100} defaultValue={priv?.upi_id ?? ''} disabled={lockFinancial} /></Field>
      </fieldset>
      {showAdminNotes && (
        <Field label="Internal notes (admins only)" hint="KYC documents seen, how they were verified, payment terms…">
          <Textarea name="admin_notes" maxLength={2000} defaultValue={priv?.admin_notes ?? ''} />
        </Field>
      )}
    </>
  );
}
