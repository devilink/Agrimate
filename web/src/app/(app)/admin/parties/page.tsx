import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dateIN } from '@/lib/money';
import { Avatar, Badge, ButtonLink, Card, Empty, Input, PageHeader, Select, Table, Td, buttonClass } from '@/components/ui';
import { IconPlus, IconSearch, IconUsers } from '@/components/icons';
import type { Party } from '@/lib/types';

export const metadata = { title: 'Parties' };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<{ type?: string; verified?: string; q?: string }> }) {
  await requireAdmin();
  const { type, verified, q } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from('parties').select('*').order('created_at', { ascending: false }).limit(300);
  if (type && ['buyer', 'farmer', 'transporter', 'inspector'].includes(type)) query = query.eq('type', type);
  if (verified === 'no') query = query.eq('verified', false);
  if (q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = q.replace(/[%,().*\\]/g, ' ').trim().slice(0, 60);
    if (term) query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%,district.ilike.%${term}%`);
  }
  const { data } = await query;
  const parties = (data ?? []) as Party[];

  return (
    <>
      <PageHeader title="Parties" subtitle="Buyers, farmers, transporters and inspectors, with or without a login." action={<ButtonLink href="/admin/parties/new"><IconPlus />Add party</ButtonLink>} />
      <form role="search" className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input name="q" type="search" aria-label="Search parties" placeholder="Search name, company, district" defaultValue={q ?? ''} className="pl-9" />
        </div>
        <Select name="type" defaultValue={type ?? ''} className="max-w-[10rem]" aria-label="Type">
          <option value="">All types</option>
          <option value="buyer">Buyers</option>
          <option value="farmer">Farmers</option>
          <option value="transporter">Transporters</option>
          <option value="inspector">Inspectors</option>
        </Select>
        <Select name="verified" defaultValue={verified ?? ''} className="max-w-[12rem]" aria-label="Verification">
          <option value="">Any status</option>
          <option value="no">Needs verification</option>
        </Select>
        <button className={buttonClass('secondary')}>Apply</button>
      </form>
      <Card>
        {parties.length === 0 ? <Empty icon={<IconUsers />}>No parties match these filters.</Empty> : (
          <Table head={['Name', 'Type', 'Place', 'Status', 'Login', 'Joined']}>
            {parties.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={p.name} />
                    <div>
                      <Link href={`/admin/parties/${p.id}`} className="font-semibold text-stone-900 hover:text-brand-700 hover:underline">{p.name}</Link>
                      {p.company && <div className="text-xs text-stone-500">{p.company}</div>}
                    </div>
                  </div>
                </Td>
                <Td><span className="capitalize">{p.type}</span></Td>
                <Td>{[p.district, p.state].filter(Boolean).join(', ') || '—'}</Td>
                <Td>
                  {!p.active ? <Badge tone="red">deactivated</Badge> : p.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}
                </Td>
                <Td>{p.user_id ? 'Yes' : <span className="text-stone-500">Offline</span>}</Td>
                <Td>{dateIN(p.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
