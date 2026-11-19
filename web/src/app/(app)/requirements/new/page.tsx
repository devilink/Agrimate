import { redirect } from 'next/navigation';
import { canTrade, requireViewer } from '@/lib/auth';
import { getCommodities, getPartiesOfType } from '@/lib/data';
import { createRequirement } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { CommodityFields } from '@/components/commodity-fields';
import { PartySelect } from '@/components/party-select';
import { Card, Field, Input, Notice, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: 'Post a requirement' };

export default async function NewRequirementPage() {
  const viewer = await requireViewer();
  if (!viewer.isAdmin && viewer.party?.type !== 'buyer') redirect('/market');
  const [commodities, buyers] = await Promise.all([getCommodities(), viewer.isAdmin ? getPartiesOfType('buyer') : []]);

  return (
    <>
      <PageHeader back={{ href: '/market', label: 'Market' }} title="Post a requirement" subtitle="Farmers and FPOs see this on the market and can send you offers." />
      {!canTrade(viewer) && <Notice>Your account is waiting for verification. You can post once our team has verified you.</Notice>}
      <Card className="max-w-2xl">
        <ActionForm action={createRequirement}>
          {viewer.isAdmin && <PartySelect parties={buyers} label="Buyer (posting on their behalf)" />}
          <CommodityFields commodities={commodities} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity needed (kg)"><Input name="quantity_kg" type="number" min={1} step={1} required /></Field>
            <Field label="Target price per kg (₹)" hint="Optional"><Input name="target_price" inputMode="decimal" /></Field>
            <Field label="Delivery location"><Input name="delivery_location" maxLength={200} /></Field>
            <Field label="Delivery PIN code"><Input name="pin" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} /></Field>
            <Field label="Needed by"><Input name="needed_by" type="date" /></Field>
          </div>
          <Field label="Notes" hint="Quality specs, packing, payment terms"><Textarea name="notes" maxLength={1000} /></Field>
          <Submit>Post requirement</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
