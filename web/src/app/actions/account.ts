'use server';

import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, fail, pin, required, run, text, type ActionState } from '@/lib/action';
import { privateFields } from '@/lib/party-fields';

/**
 * A party edits its own details. Once verified, bank, PAN and GSTIN are locked: changing where payouts go is a
 * classic fraud route, so those changes go through the Agrimate team.
 */
export async function updateMyDetails(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const party = viewer.party ?? fail('Admins have no business profile.');
    const db = adminClient();
    const priv = privateFields(form);
    check(await db.from('parties').update({
      name: required(form, 'name', 'Name', 120),
      company: text(form, 'company', 160),
      district: text(form, 'district', 80),
      state: text(form, 'state', 80),
      pin: pin(form, 'pin'),
    }).eq('id', party.id));

    const update: Record<string, string | null> = { phone: priv.phone, address: priv.address, updated_at: new Date().toISOString() };
    if (!party.verified) {
      Object.assign(update, {
        gstin: priv.gstin, pan: priv.pan, bank_holder: priv.bank_holder, bank_account_no: priv.bank_account_no,
        bank_ifsc: priv.bank_ifsc, upi_id: priv.upi_id,
      });
    }
    check(await db.from('party_private').upsert({ party_id: party.id, ...update }));
    revalidatePath('/account');
    return 'Saved.';
  });
}
