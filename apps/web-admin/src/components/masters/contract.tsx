'use client';
import { useState, type FormEvent } from 'react';
import { Alert, Button, EmptyState, Field, Input, Textarea } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Dl, InlineSuccess, Ist, Q, Section } from '@/components/console';
import type { ContractTerms } from '@/lib/types';

export function ContractEditor() {
  const q = useLoad(async () => (await api.get<ContractTerms | undefined>('/masters/contract-terms/active')) ?? null, []);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <Alert tone="blue" className="mb-3">Publishing makes the new version active for orders accepted from now on. Existing orders stay on the version they accepted.</Alert>
      {flash && <InlineSuccess onDismiss={() => setFlash(null)}>{flash}</InlineSuccess>}
      <Q q={q}>
        {(active) => (
          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Active version">
              {active ? (
                <>
                  <Dl className="mb-2 sm:grid-cols-2 xl:grid-cols-2" items={[['Version', active.version], ['Published', <Ist key="p" at={active.createdAt} />]]} />
                  <pre className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 bg-white p-4 font-sans text-sm whitespace-pre-wrap text-slate-900">{active.body}</pre>
                </>
              ) : <EmptyState title="No active contract terms">Buyers cannot accept an order until a version is published.</EmptyState>}
            </Section>
            <PublishForm key={active?.id ?? 'none'} active={active} onDone={async (m) => { setFlash(m); await q.reload(); }} />
          </div>
        )}
      </Q>
    </>
  );
}

function PublishForm({ active, onDone }: { active: ContractTerms | null; onDone: (m: string) => Promise<void> }) {
  const [version, setVersion] = useState('');
  const [body, setBody] = useState(active?.body ?? '');
  const [confirm, setConfirm] = useState(false);
  const sameVersion = version.trim() === active?.version;
  const valid = !!version.trim() && !sameVersion && body.length >= 50;
  return (
    <Section title="Publish a new version">
      <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (valid) setConfirm(true); }}>
        <Field label="Version" error={sameVersion ? 'This version is already active' : undefined}><Input required value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
        <Field label="Terms" hint={`At least 50 characters. ${body.length} so far.`}><Textarea required className="h-80" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Button type="submit" size="sm" disabled={!valid}>Review and publish</Button>
      </form>
      {confirm && (
        <ConfirmDialog
          title={`Publish contract terms ${version.trim()}`} confirmLabel="Publish" onClose={() => setConfirm(false)}
          onConfirm={async () => { await api.post('/masters/contract-terms', { version: version.trim(), body }); await onDone(`Contract terms ${version.trim()} are now active.`); }}
        >
          <p>Version {version.trim()} becomes the active contract{active ? `, replacing ${active.version}` : ''}. Every order accepted from now on is bound by it, and it cannot be unpublished from this console.</p>
          <p>Contract text needs legal review before it goes live.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
