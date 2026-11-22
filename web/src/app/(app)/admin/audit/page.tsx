import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { dateTimeIN } from '@/lib/money';
import { Card, Empty, FilterPills, PageHeader, Table, Td, buttonClass } from '@/components/ui';
import { IconClock } from '@/components/icons';

export const metadata = { title: 'Activity log' };

const PAGE = 50;
const AREAS: Record<string, string> = {
  party: 'Parties', admin: 'Admins', settings: 'Settings', commodity: 'Commodities', price: 'Prices', vehicle_rate: 'Freight rates',
};

interface Row { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; data: Record<string, unknown>; created_at: string }

/** Short human summary of the JSON payload, without nulls and undefineds. */
function summary(data: Record<string, unknown>): string {
  return Object.entries(data ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 160);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ area?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const area = sp.area && sp.area in AREAS ? sp.area : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const supabase = await createClient();
  let q = supabase.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (area) q = q.like('action', `${area}.%`);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as Row[];

  // Actors are logins (admins have no party), so look up their emails with the secret key, after the admin check.
  const emails = new Map<string, string>();
  await Promise.all([...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[])].map(async (id) => {
    const { data: u } = await adminClient().auth.admin.getUserById(id);
    if (u?.user?.email) emails.set(id, u.user.email);
  }));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => `/admin/audit?${new URLSearchParams({ ...(area ? { area } : {}), page: String(p) })}`;
  const entityHref = (r: Row) => (r.entity === 'party' && r.entity_id ? `/admin/parties/${r.entity_id}` : null);

  return (
    <>
      <PageHeader title="Activity log" subtitle="Who changed accounts, settings and prices, and when. Order changes are on each order's timeline." />
      <FilterPills label="Area" items={[
        { href: '/admin/audit', label: 'Everything', active: !area },
        ...Object.entries(AREAS).map(([k, v]) => ({ href: `/admin/audit?area=${k}`, label: v, active: area === k })),
      ]} />
      <Card padded={false} title={`${(count ?? 0).toLocaleString('en-IN')} entries`} icon={<IconClock />}>
        {rows.length === 0 ? <div className="px-6 pb-6"><Empty>No activity recorded{area ? ` for ${AREAS[area].toLowerCase()}` : ''}.</Empty></div> : (
          <div className="px-5 sm:px-6">
            <Table head={['When', 'Who', 'Action', 'Record', 'Details']}>
              {rows.map((r) => {
                const href = entityHref(r);
                return (
                  <tr key={r.id} className="align-top">
                    <Td className="text-stone-500">{dateTimeIN(r.created_at)}</Td>
                    <Td className="max-w-[14rem] truncate">{r.actor_id ? emails.get(r.actor_id) ?? r.actor_id.slice(0, 8) : 'System'}</Td>
                    <Td className="font-mono text-xs text-stone-800">{r.action}</Td>
                    <Td className="font-mono text-xs">
                      {href ? <Link href={href} className="text-brand-700 hover:underline">{r.entity_id?.slice(0, 8)}</Link> : r.entity_id ? r.entity_id.slice(0, 8) : '—'}
                    </Td>
                    <Td className="max-w-md whitespace-normal text-xs text-stone-600">{summary(r.data) || '—'}</Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className={buttonClass('secondary', true)} href={link(page - 1)}>← Newer</Link> : <span />}
          <span className="text-stone-500">Page {page} of {pages}</span>
          {page < pages ? <Link className={buttonClass('secondary', true)} href={link(page + 1)}>Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
