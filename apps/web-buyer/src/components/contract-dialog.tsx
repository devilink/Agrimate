'use client';
/** Explicit contract acceptance: shows the active terms, and the confirm button stays off until the box is ticked. */
import { Button, Skeleton } from '@agrimate/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import { Checkbox, ErrorState, FormError, Modal } from './common';

interface ContractTerms { id: string; version: string; body: string }

export function ContractDialog({ open, title, confirmLabel, busy, error, canConfirm = true, onConfirm, onClose, children }: {
  open: boolean; title: string; confirmLabel: string; busy: boolean; error: string | null; canConfirm?: boolean;
  onConfirm: () => void; onClose: () => void; children: ReactNode;
}) {
  const [accepted, setAccepted] = useState(false);
  const terms = useResource<ContractTerms | undefined>(open ? () => api.get<ContractTerms | undefined>('/masters/contract-terms/active') : null, [open]);
  useEffect(() => { if (open) setAccepted(false); }, [open]);

  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      <div className="space-y-4">
        {children}
        <section aria-labelledby="terms-heading">
          <h3 id="terms-heading" className="mb-1 text-sm font-medium text-slate-800">Contract terms{terms.data ? `, version ${terms.data.version}` : ''}</h3>
          {terms.loading && !terms.data && <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>}
          {terms.error && <ErrorState message={terms.error} onRetry={() => void terms.reload()} />}
          {!terms.loading && !terms.error && !terms.data && <ErrorState message="No contract terms are active, so this cannot be accepted right now." />}
          {terms.data && (
            <div tabIndex={0} aria-label="Contract terms text" className="max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-800">
              {terms.data.body}
            </div>
          )}
        </section>
        <Checkbox label="I have read these contract terms and accept them on behalf of my business." checked={accepted} onChange={setAccepted} disabled={busy || !terms.data} />
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={onConfirm} disabled={busy || !accepted || !terms.data || !canConfirm}>{busy ? 'Submitting' : confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
