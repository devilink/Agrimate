import { requireAdmin } from '@/lib/auth';
import { createParty } from '@/app/actions/admin';
import { ActionForm, Submit } from '@/components/action-form';
import { PartyFormFields } from '@/components/party-form-fields';
import { Card, Checkbox, Field, PageHeader, Select } from '@/components/ui';

export const metadata = { title: 'Add party' };

export default async function NewPartyPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader back={{ href: '/admin/parties', label: 'Parties' }} title="Add party" subtitle="For people who trade through you offline. You can give them a login later." />
      <Card className="max-w-3xl">
        <ActionForm action={createParty} className="space-y-6">
          <Field label="Type">
            <Select name="type" required defaultValue="">
              <option value="" disabled>Choose…</option>
              <option value="farmer">Farmer / FPO</option>
              <option value="buyer">Buyer</option>
              <option value="transporter">Transporter</option>
              <option value="inspector">Quality inspector</option>
            </Select>
          </Field>
          <PartyFormFields showAdminNotes />
          <Checkbox name="verified" label="Verified" hint="KYC checked. They can trade straight away." />
          <Submit>Add party</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
