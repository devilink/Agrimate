'use client';
import type { BuyerOrder, DisputeEligibility, SpotTestView } from '@agrimate/api-client';
import { formatIST } from '@agrimate/shared';
import { Button, Card, CardTitle, Field, Input, StateBadge, Table, Td } from '@agrimate/ui';
import { useState } from 'react';
import { ErrorState, FileButton, FormError } from '@/components/common';
import { FileUpload, type UploadedFile } from '@/components/file-upload';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';

function ResultForm({ order, test, onChanged }: { order: BuyerOrder; test: SpotTestView; onChanged: () => Promise<void> }) {
  const [result, setResult] = useState<'PASSED' | 'FAILED' | ''>('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState<UploadedFile[]>([]);
  const { busy, error, run } = useAction();
  const submit = () => void run(async () => {
    await api.post(`/spot-tests/${test.id}/result`, { passed: result === 'PASSED', reportFileId: report[0]!.id, ...(note.trim() ? { note: note.trim() } : {}) });
    await onChanged();
  });
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-medium text-slate-800">Upload the lab result</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <FileUpload label="Lab report (required)" purpose="SPOT_TEST_REPORT" orderId={order.id} accept="application/pdf,image/*" files={report} onChange={setReport} disabled={busy} single />
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Result</legend>
          <div className="flex gap-4 text-sm text-slate-800">
            <label className="flex items-center gap-1.5"><input type="radio" name={`spot-${test.id}`} className="accent-emerald-700" checked={result === 'PASSED'} disabled={busy} onChange={() => setResult('PASSED')} /> Passed</label>
            <label className="flex items-center gap-1.5"><input type="radio" name={`spot-${test.id}`} className="accent-emerald-700" checked={result === 'FAILED'} disabled={busy} onChange={() => setResult('FAILED')} /> Failed</label>
          </div>
          {result === 'FAILED' && <p className="mt-1 text-xs text-slate-600">A failed result opens a quality dispute automatically.</p>}
        </fieldset>
      </div>
      <Field label="Note (optional)"><Input value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} /></Field>
      <FormError message={error} />
      <Button disabled={busy || !result || !report[0]} onClick={submit}>{busy ? 'Saving' : 'Save result'}</Button>
    </div>
  );
}

export function SpotTestCard({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const e = useResource(() => api.get<DisputeEligibility>(`/orders/${order.id}/dispute-eligibility`), [order.id, order.state, order.disputeDeadlineAt]);
  const request = useAction();
  const pending = order.spotTests.filter((t) => t.status === 'REQUESTED');

  return (
    <Card>
      <CardTitle>Organic spot test</CardTitle>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">You can have this organic produce lab tested for pesticide residue. Requesting a test extends the dispute window, and settlement waits for the result.</p>
        {e.error && <ErrorState message={e.error} onRetry={() => void e.reload()} />}
        {e.data?.spotTestAllowed && pending.length === 0 && (
          <div>
            <Button variant="secondary" disabled={request.busy} onClick={() => void request.run(async () => { await api.post(`/orders/${order.id}/spot-tests`); await onChanged(); })}>{request.busy ? 'Requesting' : 'Request spot test'}</Button>
            <div className="mt-2 empty:hidden"><FormError message={request.error} /></div>
          </div>
        )}
        {e.data && !e.data.spotTestAllowed && order.spotTests.length === 0 && <p className="text-sm text-slate-600">Spot tests can be requested only while the dispute window is open.</p>}
        {order.spotTests.length > 0 && (
          <Table head={['Requested', 'Status', 'Report', 'Note']}>
            {order.spotTests.map((t) => (
              <tr key={t.id}>
                <Td className="whitespace-nowrap">{formatIST(t.createdAt)}</Td>
                <Td><StateBadge state={t.status === 'PASSED' ? 'VERIFIED' : t.status === 'FAILED' ? 'FAILED' : 'PENDING'} /> <span className="sr-only">{t.status}</span></Td>
                <Td>{t.reportFileId ? <FileButton fileId={t.reportFileId} label="Open report" /> : '—'}</Td>
                <Td>{t.resultNote ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
        {pending.map((t) => <ResultForm key={t.id} order={order} test={t} onChanged={onChanged} />)}
      </div>
    </Card>
  );
}
