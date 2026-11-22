import { redirect } from 'next/navigation';
import { canTrade, requireViewer } from '@/lib/auth';
import { getCommodities, getPartiesOfType } from '@/lib/data';
import { createListing } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { CommodityFields } from '@/components/commodity-fields';
import { PartySelect } from '@/components/party-select';
import { PriceField, QuantityField } from '@/components/unit-fields';
import { Card, Checkbox, Field, Input, Notice, PageHeader, Textarea } from '@/components/ui';

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
            <QuantityField label="Quantity" hint="1 quintal = 100 kg, 1 tonne = 1000 kg" />
            <PriceField label="Price" hint="Mandis quote per quintal; choose the unit you think in." unit="qtl" />
            <QuantityField name="min_order" label="Minimum order" hint="Optional. Smaller offers are refused (except for the last remainder)." required={false} />
            <Field label="Packaging" hint="e.g. 50 kg PP bags, loose"><Input name="packaging" maxLength={80} /></Field>
            <Field label="Pickup location" hint="Village / mandi / warehouse"><Input name="location" maxLength={200} /></Field>
            <Field label="PIN code"><Input name="pin" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} /></Field>
            <Field label="Available from"><Input name="available_from" type="date" /></Field>
            <Field label="Harvest" hint="e.g. Kharif 2026"><Input name="harvest" maxLength={60} /></Field>
          </div>
          <fieldset className="rounded-xl border border-stone-200 p-4">
            <legend className="px-1 text-sm font-semibold text-stone-900">Quality <span className="font-normal text-stone-500">· optional, in %</span></legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Moisture"><Input name="moisture_pct" inputMode="decimal" maxLength={6} placeholder="12" /></Field>
              <Field label="Foreign matter"><Input name="foreign_matter_pct" inputMode="decimal" maxLength={6} placeholder="1" /></Field>
              <Field label="Broken / damaged"><Input name="broken_pct" inputMode="decimal" maxLength={6} placeholder="2" /></Field>
              <Field label="Purity"><Input name="purity_pct" inputMode="decimal" maxLength={6} placeholder="98" /></Field>
            </div>
            <p className="mt-3 text-xs text-stone-500">Declare what you expect an inspector to find. Buyers rely on these when they offer.</p>
          </fieldset>
          <Checkbox name="fixed_price" label="Fixed price" hint="Buyers can only offer at your price; no counter-offers." />
          <Field label="Notes" hint="Variety, storage, anything else a buyer should know"><Textarea name="notes" maxLength={1000} /></Field>
          <Submit>Publish listing</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
