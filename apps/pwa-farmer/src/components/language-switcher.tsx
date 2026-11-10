'use client';
import { useState } from 'react';
import { currentUserId, isSignedIn } from '@/lib/api';
import { LANGUAGES, useI18n } from '@/lib/i18n';
import { enqueue, flushQueue } from '@/lib/queue';
import { GlobeIcon } from './icons';
import { cn } from './ui';

/** Saves the choice on the phone straight away, and on the account through the outbox so that it also works offline. */
export function saveLanguageToAccount(code: string, label: string) {
  const owner = currentUserId();
  if (!isSignedIn() || !owner) return;
  enqueue({ kind: 'LANGUAGE', ownerId: owner, method: 'PATCH', path: '/auth/me', body: { language: code }, label });
  void flushQueue(owner);
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, t, setLanguage } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <div className={className}>
      <label className={cn('flex min-h-12 items-center gap-1 rounded-lg border-2 border-slate-800 bg-white pl-2 text-slate-950')}>
        <GlobeIcon size={22} className="shrink-0" />
        <span className="sr-only">{t('lang.choose')}</span>
        <select
          value={lang}
          onChange={async (e) => {
            const code = e.target.value;
            const ok = await setLanguage(code);
            setFailed(!ok);
            if (ok) saveLanguageToAccount(code, LANGUAGES.find((l) => l.code === code)?.label ?? code);
          }}
          className="min-h-11 max-w-32 appearance-auto bg-transparent pr-1 text-base font-bold focus:outline-none"
        >
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </label>
      {failed && <p role="alert" className="absolute right-3 z-30 mt-1 max-w-64 rounded-lg bg-red-800 p-2 text-white">{t('lang.needsInternet')}</p>}
    </div>
  );
}
