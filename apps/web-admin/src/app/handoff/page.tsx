'use client';
/**
 * Receives a transport manager's session from the main Agrimate sign-in page, which runs on another origin and so
 * cannot write to this app's storage. Tokens arrive in the URL fragment (never sent to a server) and the fragment is
 * wiped at once. Only transport accounts are accepted here; admins and verifiers sign in at /adminagri.
 */
import { useEffect, useRef, useState } from 'react';
import type { MeView } from '@agrimate/api-client';
import { Alert } from '@agrimate/ui';
import { api, PORTAL_URL, setEntry, tokens } from '@/lib/api';
import { HOME } from '@/lib/roles';

const BACK = `${PORTAL_URL}/login?as=transport`;

export default function HandoffPage() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    // Out of the address bar and history before anything else can read it.
    window.history.replaceState(null, '', '/handoff');
    const access = hash.get('at');
    const refresh = hash.get('rt');
    if (!access || !refresh) { window.location.replace(BACK); return; }

    void (async () => {
      try {
        await tokens.clear();
        await tokens.set(access, refresh);
        const me = await api.get<MeView>('/auth/me');
        if (me.role !== 'LOGISTICS') {
          await api.logout();
          window.location.replace(BACK);
          return;
        }
        setEntry('transport');
        window.location.replace(HOME.LOGISTICS);
      } catch {
        await tokens.clear();
        setFailed(true);
      }
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      {failed ? (
        <Alert tone="red" role="alert" className="max-w-sm">
          Your sign-in could not be completed. <a href={BACK} className="font-medium underline">Sign in again</a>.
        </Alert>
      ) : (
        <p role="status" className="text-sm text-slate-600">Opening your transport desk…</p>
      )}
    </main>
  );
}
