import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartiesOfType } from '@/lib/data';
import { createManualOrder } from '@/app/actions/orders';
import { ActionForm, Submit } from '@/components/action-form';
import { CommodityFields } from '@/components/commodity-fields';
import { PartySelect } from '@/components/party-select';
import { Card, Field, Input, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: 'Enter an offline order' };

export default async function NewOrderPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [buyers, farmers, commodities, { data: settings }] = await Promise.all([
    getPartiesOfType('buyer'), getPartiesOfType('farmer'), getCommodities(),
    supabase.from('settings').select('commission_bps').eq('id', 1).single(),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: '/orders', label: 'Orders' }}
        title="Enter an offline order"
        subtitle={<>For deals agreed by phone, at the mandi or on WhatsApp. Party not listed? <Link href="/admin/parties/new" className="font-medium text-brand-700 underline underline-offset-2">Add them first</Link>.</>}
      />
      <Card className="max-w-3xl">
        <ActionForm action={createManualOrder}>
          <div className="grid gap-4 sm:grid-cols-2">
            <PartySelect parties={buyers} label="Buyer" name="buyer_id" />
            <PartySelect parties={farmers} label="Farmer / FPO" name="farmer_id" />
          </div>
          <CommodityFields commodities={commodities} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Quantity (kg)"><Input name="quantity_kg" type="number" min={1} required /></Field>
            <Field label="Price per kg (₹)"><Input name="price" inputMode="decimal" required /></Field>
            <Field label="Platform fee (%)"><Input name="commission_pct" inputMode="decimal" defaultValue={(settings?.commission_bps ?? 0) / 100} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pickup location"><Input name="pickup_location" maxLength={300} /></Field>
            <Field label="Delivery location"><Input name="delivery_location" maxLength={300} /></Field>
            <Field label="Expected date"><Input name="expected_date" type="date" /></Field>
          </div>
          <Field label="Note for the timeline" hint="How the deal was agreed, special terms"><Textarea name="note" maxLength={2000} /></Field>
          <Submit>Create order</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
