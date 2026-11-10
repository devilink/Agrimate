'use client';
/**
 * Receives a farmer session from the main Agrimate sign-in page, which runs on another origin and so cannot write to
 * this app's storage. Tokens arrive in the URL fragment (never sent to a server) and the fragment is wiped at once.
 */
import { useEffect, useRef, useState } from 'react';
import type { MeView } from '@agrimate/api-client';
import { useRouter } from 'next/navigation';
import { SproutIcon } from '@/components/icons';
import { BigButton, Notice } from '@/components/ui';
import { adoptSession, api, rememberUser } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function HandoffPage() {
  const { t, lang, setLanguage } = useI18n();
  const router = useRouter();
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
    if (!access || !refresh) { router.replace('/login'); return; }

    void (async () => {
      try {
        await adoptSession(access, refresh);
        const me = await api.get<MeView>('/auth/me');
        if (me.role !== 'FARMER') {
          await api.logout();
          router.replace('/login');
          return;
        }
        rememberUser(me.id);
        if (me.language !== lang) await setLanguage(me.language);
        router.replace('/');
      } catch {
        setFailed(true);
      }
    })();
  }, [router, lang, setLanguage]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <SproutIcon size={48} className="text-emerald-800" />
      {failed ? (
        <>
          <Notice tone="error">{t('error.signedOut')}</Notice>
          <BigButton onClick={() => router.replace('/login')}>{t('login.title')}</BigButton>
        </>
      ) : (
        <p className="text-xl font-bold text-slate-900" role="status">{t('common.wait')}</p>
      )}
    </div>
  );
}
