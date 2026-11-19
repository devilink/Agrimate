'use client';

import { useEffect } from 'react';
import { buttonClass } from '@/components/ui';
import { IconAlert, IconRefresh } from '@/components/icons';

/** Friendly error screen. Shows the digest so support can find the server log entry; never the raw message. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100"><IconAlert className="size-6" /></span>
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-stone-600">
        This page couldn’t load. It’s usually temporary: try again, and if it keeps happening, contact the Agrimate team.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-stone-400">Reference: {error.digest}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClass('primary')}><IconRefresh />Try again</button>
        {/* A full page load, in case the client router itself is in a bad state. */}
        <a href="/dashboard" className={buttonClass('secondary')}>Go to dashboard</a>
      </div>
    </div>
  );
}
