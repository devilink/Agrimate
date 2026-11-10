'use client';
/** Portal-level building blocks on top of @agrimate/ui: page frames, loading and error states, dialogs and small fields. */
import type { GradeParameter } from '@agrimate/shared';
import { Alert, Button, cn, Input, Skeleton, Table, Td } from '@agrimate/ui';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef } from 'react';
import { api, errorMessage, openFile } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A link that looks like a Button; a button inside a link is invalid HTML and adds a second tab stop. */
export function LinkButton({ href, variant = 'primary', size = 'md', children }: { href: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md'; children: ReactNode }) {
  return (
    <Link href={href} className={cn('inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700', variant === 'primary' ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50', size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm')}>
      {children}
    </Link>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <span>{message}</span>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export const FormError = ({ message }: { message: string | null }) => (message ? <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-800">{message}</div> : null);

export function TableSkeleton({ head, rows = 5 }: { head: ReactNode[]; rows?: number }) {
  return (
    <Table head={head}>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>{head.map((_, c) => <Td key={c}><Skeleton className="h-4 w-full" /></Td>)}</tr>
      ))}
    </Table>
  );
}

export const CardSkeleton = ({ lines = 3 }: { lines?: number }) => (
  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5" aria-busy="true">
    <span className="sr-only">Loading</span>
    <Skeleton className="h-5 w-1/3" />
    {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
  </div>
);

/** A definition row, for the dense label/value lists used across the order screen. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/** Modal built on the native <dialog>, which supplies the focus trap, Escape handling and the inert background. */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cn('m-auto w-full rounded-lg border border-slate-200 bg-white p-0 shadow-lg', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-base font-semibold text-slate-900">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">Close</Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-800">
      <input type="checkbox" className="mt-0.5 size-4 accent-emerald-700" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function GradeSpecTable({ parameters }: { parameters: GradeParameter[] }) {
  if (!parameters.length) return <p className="text-sm text-slate-600">This grade has no parameters on file.</p>;
  return (
    <Table head={['Parameter', 'Accepted range', 'Required']}>
      {parameters.map((p) => (
        <tr key={p.key}>
          <Td>{p.label}</Td>
          <Td className="tabular-nums">{specRange(p)}</Td>
          <Td>{p.required ? 'Yes' : 'No'}</Td>
        </tr>
      ))}
    </Table>
  );
}

export function specRange(p: GradeParameter): string {
  const u = p.unit ? ` ${p.unit}` : '';
  if (p.min !== undefined && p.max !== undefined) return `${p.min} to ${p.max}${u}`;
  if (p.max !== undefined) return `Up to ${p.max}${u}`;
  if (p.min !== undefined) return `At least ${p.min}${u}`;
  return 'Recorded only';
}

interface PinRecord { pin: string; district: string; state: string }

/** Delivery PIN input that confirms the place as soon as six digits are in. */
export function PinInput({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  const valid = /^[1-9][0-9]{5}$/.test(value);
  const place = useResource<PinRecord>(valid ? () => api.get<PinRecord>(`/masters/pincodes/${value}`) : null, [value, valid]);
  return (
    <>
      <Input id={id} inputMode="numeric" maxLength={6} autoComplete="postal-code" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} placeholder="781001" />
      {valid && (
        <span className="block text-xs text-slate-500">
          {place.loading ? 'Looking up PIN' : place.error || !place.data ? 'PIN not found in our list. Check it before continuing.' : `${place.data.district}, ${place.data.state}`}
        </span>
      )}
    </>
  );
}

export function KybBlockedNotice({ action }: { action: string }) {
  const { me, kybVerified } = useSession();
  if (kybVerified) return null;
  const status = me.buyer?.kybStatus ?? 'NOT_SUBMITTED';
  return (
    <Alert tone="amber">
      You cannot {action} until your business is verified. Current status: {status.toLowerCase().replace(/_/g, ' ')}.{' '}
      <Link href="/kyb" className="font-medium underline">Go to business verification</Link>
    </Alert>
  );
}

/** Opens a stored file through a fresh signed URL. */
export function FileButton({ fileId, label }: { fileId: string; label: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => openFile(fileId))}>{busy ? 'Opening' : label}</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** Thumbnail for an image file; other content types fall back to an open button. */
export function FileThumb({ fileId, label }: { fileId: string; label: string }) {
  const r = useResource(() => api.get<{ url: string; contentType: string }>(`/files/${fileId}/download-url`), [fileId]);
  if (r.loading && !r.data) return <Skeleton className="size-28" />;
  if (r.error || !r.data) return <span className="text-xs text-red-700">{r.error ?? errorMessage(null)}</span>;
  if (!r.data.contentType.startsWith('image/')) return <FileButton fileId={fileId} label={label} />;
  return (
    <a href={r.data.url} target="_blank" rel="noreferrer" className="block size-28 overflow-hidden rounded-md border border-slate-200">
      {/* Signed storage URLs, so next/image optimisation does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={r.data.url} alt={label} className="size-full object-cover" loading="lazy" />
    </a>
  );
}
