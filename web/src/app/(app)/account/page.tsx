import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { updateMyDetails } from '@/app/actions/account';
import { ActionForm, Submit } from '@/components/action-form';
import { PartyFormFields } from '@/components/party-form-fields';
import { TrustBadges, TrustChecklist } from '@/components/trust';
import { Badge, Card, PageHeader } from '@/components/ui';
import { IconShield, IconUser } from '@/components/icons';
import type { PartyPrivate } from '@/lib/types';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requireViewer();
  const party = viewer.party;
  let priv: PartyPrivate | null = null;
  if (party) {
    const supabase = await createClient();
    const { data } = await supabase.from('party_private').select('*').eq('party_id', party.id).maybeSingle();
    priv = data as PartyPrivate | null;
  }

  return (
    <>
      <PageHeader
        title="Account"
        subtitle={<><span>{viewer.email}</span><span className="text-stone-300">·</span><Link href="/account/password" className="font-medium text-brand-700 hover:text-brand-900 hover:underline">Change password</Link></>}
      />
      {party ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Business details" icon={<IconUser />} action={party.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">awaiting verification</Badge>}>
            <ActionForm action={updateMyDetails} className="space-y-6">
              <PartyFormFields party={party} priv={priv} lockFinancial={party.verified} />
              <Submit>Save</Submit>
            </ActionForm>
          </Card>
          <Card title="Your badges" icon={<IconShield />} className="h-fit" action={<TrustBadges party={party} />}
            description="What other members see next to your name. Our team ticks these after checking your documents.">
            <TrustChecklist party={party} />
          </Card>
        </div>
      ) : (
        <Card className="max-w-xl" title="Agrimate admin" icon={<IconShield />}><p className="text-sm text-stone-600">You are signed in as an Agrimate admin. Admin accounts have no business profile.</p></Card>
      )}
    </>
  );
}
