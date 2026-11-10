'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input, Table, Td, humanise } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Ist, JsonDetails, Mono, PageHeader, Q } from '@/components/console';
import type { AuditEntry } from '@/lib/types';

/** Entity names exactly as the API writes them. The filter is exact and case-sensitive. */
const ENTITIES = ['Order', 'Dispute', 'Inspection', 'Payout', 'AdminAlert', 'kyb', 'kyc', 'inspector', 'logistics', 'organic', 'Commodity', 'Grade', 'VehicleTier', 'InspectionFeeTier', 'PlatformConfig', 'ContractTerms'];

export default function AuditPage() {
  const router = useRouter();
  const params = useSearchParams();
  const entity = params.get('entity') ?? '';
  const entityId = params.get('entityId') ?? '';
  const [form, setForm] = useState({ entity, entityId });
  useEffect(() => setForm({ entity, entityId }), [entity, entityId]);

  const q = useLoad(() => {
    const p = new URLSearchParams();
    if (entity) p.set('entity', entity);
    if (entityId) p.set('entityId', entityId);
    const qs = p.toString();
    return api.get<AuditEntry[]>(`/admin/audit${qs ? `?${qs}` : ''}`);
  }, [entity, entityId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (form.entity.trim()) p.set('entity', form.entity.trim());
    if (form.entityId.trim()) p.set('entityId', form.entityId.trim());
    router.replace(p.size ? `/audit?${p}` : '/audit');
  };

  return (
    <>
      <PageHeader title="Audit log" description="Latest 200 matching admin and system actions, newest first." />
      <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <div className="w-56">
          <Field label="Entity">
            <Input list="audit-entities" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} />
            <datalist id="audit-entities">{ENTITIES.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        </div>
        <div className="w-80"><Field label="Entity id"><Input value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} /></Field></div>
        <Button type="submit" variant="secondary">Filter</Button>
        {(entity || entityId) && <Button type="button" variant="ghost" onClick={() => router.replace('/audit')}>Clear</Button>}
      </form>
      <Q q={q} isEmpty={(d) => d.length === 0} emptyTitle="No audit entries" emptyBody={entity || entityId ? 'The entity filter is exact and case-sensitive.' : 'Actions appear here as admins and the system make them.'}>
        {(rows) => (
          <Table head={['Time', 'Action', 'Entity', 'Entity id', 'Actor', 'Data']}>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td><Ist at={a.createdAt} /></Td>
                <Td className="font-medium">{humanise(a.action)}</Td>
                <Td>{a.entity}</Td>
                <Td><Mono>{a.entityId ?? '—'}</Mono></Td>
                <Td>{humanise(a.actorRole)}{a.actorId && <Mono className="block text-slate-500">{a.actorId}</Mono>}</Td>
                <Td><JsonDetails label="View" value={a.data} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </>
  );
}
