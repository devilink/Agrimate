import { redirect } from 'next/navigation';
import { canTrade, requireViewer } from '@/lib/auth';
import { getCommodities, getPartiesOfType } from '@/lib/data';
import { createListing } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { CommodityFields } from '@/components/commodity-fields';
import { PartySelect } from '@/components/party-select';
import { Card, Field, Input, Notice, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: 'List produce' };

export default async function NewListingPage() {
  const viewer = await requireViewer();
  if (!viewer.isAdmin && viewer.party?.type !== 'farmer') redirect('/market');
  const [commodities, farmers] = await Promise.all([getCommodities(), viewer.isAdmin ? getPartiesOfType('farmer') : []]);

  return (
    <>
      <PageHeader back={{ href: '/market', label: 'Market' }} title="List produce" subtitle="Buyers see this on the market and can send you offers." />
      {!canTrade(viewer) && <Notice>Your account is waiting for verification. You can list produce once our team has verified you.</Notice>}
      <Card className="max-w-2xl">
        <ActionForm action={createListing}>
          {viewer.isAdmin && <PartySelect parties={farmers} label="Farmer / FPO (listing on their behalf)" />}
          <CommodityFields commodities={commodities} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity (kg)" hint="1 tonne = 1000 kg"><Input name="quantity_kg" type="number" min={1} step={1} required /></Field>
            <Field label="Price per kg (₹)"><Input name="price" inputMode="decimal" placeholder="24.50" required /></Field>
            <Field label="Pickup location" hint="Village / mandi / warehouse"><Input name="location" maxLength={200} /></Field>
            <Field label="PIN code"><Input name="pin" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} /></Field>
            <Field label="Available from"><Input name="available_from" type="date" /></Field>
          </div>
          <Field label="Notes" hint="Moisture, packing, harvest date, anything a buyer should know"><Textarea name="notes" maxLength={1000} /></Field>
          <Submit>Publish listing</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
