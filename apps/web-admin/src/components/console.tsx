'use client';
/** Console-specific building blocks layered on the shared @agrimate/ui primitives. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, EmptyState, Field, Skeleton, Textarea, cn } from '@agrimate/ui';
import { formatIST } from '@agrimate/shared';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import type { Loaded } from '@/lib/use-load';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-6', className)} aria-label={title}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-xs text-slate-600">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ErrorState({ error, onRetry, title = 'This could not be loaded' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert tone="red" role="alert" className="flex flex-wrap items-center justify-between gap-3">
      <span><strong className="font-semibold">{title}.</strong> {errorMessage(error)}</span>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </Alert>
  );
}

export function LoadingRows({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  );
}

/** Renders the loading, failure and empty states of a useLoad result, then the content. */
export function Q<T>({ q, children, isEmpty, emptyTitle, emptyBody, rows }: { q: Loaded<T>; children: (data: T) => ReactNode; isEmpty?: (data: T) => boolean; emptyTitle?: string; emptyBody?: ReactNode; rows?: number }) {
  if (!q.loaded) return q.error ? <ErrorState error={q.error} onRetry={() => void q.reload()} /> : <LoadingRows rows={rows} />;
  const data = q.data as T;
  return (
    <>
      {q.error ? <div className="mb-3"><ErrorState title="The latest refresh failed, so this may be out of date" error={q.error} onRetry={() => void q.reload()} /></div> : null}
      {isEmpty?.(data) ? <EmptyState title={emptyTitle ?? 'Nothing here'}>{emptyBody}</EmptyState> : children(data)}
    </>
  );
}

export interface ConfirmProps {
  title: string;
  /** Exactly what will happen, in plain sentences. */
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the operator must type a reason before confirming. */
  reason?: { label: string; hint?: string; minLength?: number };
  /** Extra inputs, such as a refund amount. */
  extra?: ReactNode;
  canConfirm?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** Native modal dialog, so focus trapping, Esc and focus return come from the browser. Render it only while open. */
export function ConfirmDialog({ title, children, confirmLabel, danger, reason, extra, canConfirm = true, onConfirm, onClose }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = reason?.minLength ?? 3;
  const reasonOk = !reason || text.trim().length >= min;

  // Layout-effect cleanup runs before React removes the node, so close() can still return focus to the opener.
  useLayoutEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !reasonOk || !canConfirm) return;
    setBusy(true); setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      handleAuthError(err);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-full max-w-lg rounded-lg border border-slate-300 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <h2 id="confirm-title" className="text-base font-semibold text-slate-900">{title}</h2>
        <div className="space-y-2 text-sm text-slate-800">{children}</div>
        {extra}
        {reason && (
          <Field label={reason.label} hint={reason.hint ?? `Required, at least ${min} characters.`}>
            <Textarea required autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {error && <Alert tone="red" role="alert">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>Go back</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} size="sm" disabled={busy || !reasonOk || !canConfirm}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

/** Opens a signed download URL. The tab opens first, so the browser treats it as user-initiated, then navigates once signed. */
export function DocLink({ fileId, label }: { fileId: string | null | undefined; label: string }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  if (!fileId) return <span className="text-sm text-amber-800">{label}: no file</span>;
  const open = async () => {
    const tab = window.open('', '_blank');
    setState({ busy: true, error: null });
    try {
      const { url } = await api.get<{ url: string }>(`/files/${fileId}/download-url`);
      if (tab) { tab.opener = null; tab.location.href = url; } else window.location.href = url;
      setState({ busy: false, error: null });
    } catch (e) {
      tab?.close();
      handleAuthError(e);
      setState({ busy: false, error: errorMessage(e) });
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" onClick={open} disabled={state.busy} className="text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:text-slate-400">
        {state.busy ? 'Opening…' : label}
      </button>
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </span>
  );
}

export function JsonDetails({ label = 'Details', value }: { label?: string; value: unknown }) {
  const empty = value == null || (typeof value === 'object' && Object.keys(value as object).length === 0);
  if (empty) return <span className="text-slate-400">—</span>;
  return (
    <details className="max-w-md">
      <summary className="cursor-pointer text-xs font-medium text-slate-700">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap break-all text-slate-800">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export const Ist = ({ at }: { at: string | null | undefined }) => <span className="whitespace-nowrap tabular-nums">{at ? formatIST(at) : '—'}</span>;
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cn('font-mono text-xs break-all', className)}>{children}</span>;
export const OrderLink = ({ id, code }: { id: string; code?: string | null }) => <Link href={`/orders/${id}`} className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950">{code ?? id}</Link>;

export function Tabs<K extends string>({ label, value, onChange, items }: { label: string; value: K; onChange: (k: K) => void; items: { key: K; label: string; count?: number }[] }) {
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((t) => (
        <button
          key={t.key} type="button" aria-current={t.key === value ? 'true' : undefined} onClick={() => onChange(t.key)}
          className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700', t.key === value ? 'border-emerald-700 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900')}
        >
          {t.label}
          {t.count !== undefined && <Badge tone={t.count > 0 ? 'amber' : 'slate'}>{t.count}</Badge>}
        </button>
      ))}
    </nav>
  );
}

export function Dl({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 xl:grid-cols-3', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="break-words text-slate-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export const InlineSuccess = ({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) => (
  <Alert tone="green" className="mb-3 flex items-center justify-between gap-3">
    <span>{children}</span>
    {onDismiss && <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>}
  </Alert>
);
