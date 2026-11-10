'use client';
import { useState } from 'react';
import type { SessionUser } from '@agrimate/api-client';
import { PHONE_RE } from '@agrimate/shared';
import { useRouter } from 'next/navigation';
import { CheckIcon, PhoneIcon, SproutIcon } from '@/components/icons';
import { LanguageSwitcher, saveLanguageToAccount } from '@/components/language-switcher';
import { BigButton, ErrorNotice, Field, Notice, TextInput } from '@/components/ui';
import { api, clearSavedData, rememberUser } from '@/lib/api';
import { errorCode } from '@/lib/errors';
import { LANGUAGES, useI18n } from '@/lib/i18n';

type Step = 'phone' | 'code';

export default function LoginPage() {
  const { t, lang, setLanguage } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notFarmer, setNotFarmer] = useState(false);

  const phone = `+91${digits}`;
  const phoneValid = PHONE_RE.test(phone);

  async function sendCode() {
    const r = await api.requestOtp(phone);
    setDevOtp(r.devOtp ?? null);
    setCode('');
  }

  async function finish(user: SessionUser, createdNow: boolean) {
    if (user.role !== 'FARMER') {
      await api.logout();
      setNotFarmer(true);
      setStep('phone');
      return;
    }
    await clearSavedData();
    rememberUser(user.id);
    if (createdNow) {
      // A new account starts with whatever language the farmer picked on this screen.
      saveLanguageToAccount(lang, LANGUAGES.find((l) => l.code === lang)?.label ?? lang);
    } else if (user.language !== lang) {
      await setLanguage(user.language);
    }
    router.replace('/');
  }

  async function onPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneValid || busy) return;
    setBusy(true); setError(null); setNotFarmer(false);
    try {
      await sendCode();
      setStep('code');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    if (isNew && name.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      const user = await api.verifyOtp(isNew ? { phone, code, role: 'FARMER', name: name.trim() } : { phone, code });
      await finish(user, isNew);
    } catch (err) {
      if (errorCode(err) === 'SIGNUP_DETAILS_REQUIRED') {
        // The API spends the code before it notices that the number is new, so a fresh code is needed for the signup.
        setIsNew(true);
        try { await sendCode(); } catch (again) { setError(again); }
      } else {
        setError(err);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-3">
      <div className="mb-6 flex items-center justify-between">
        <p className="flex items-center gap-2 text-2xl font-extrabold text-emerald-900"><SproutIcon size={34} />{t('app.name')}</p>
        <LanguageSwitcher />
      </div>
      <h1 className="mb-1 text-3xl font-bold text-slate-950">{t('login.title')}</h1>
      <p className="mb-6 text-lg text-slate-800">{t('login.subtitle')}</p>

      {notFarmer && <Notice tone="error" className="mb-4">{t('login.notFarmer')}</Notice>}
      <ErrorNotice error={error} className="mb-4" />

      {step === 'phone' ? (
        <form onSubmit={onPhone} className="space-y-5">
          <Field label={t('login.phone')} hint={t('login.phoneHint')}>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">+91</span>
              <TextInput type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="9000000000" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))} />
            </div>
          </Field>
          <BigButton type="submit" icon={PhoneIcon} disabled={!phoneValid || busy}>{busy ? t('common.wait') : t('login.sendCode')}</BigButton>
        </form>
      ) : (
        <form onSubmit={onCode} className="space-y-5">
          {isNew
            ? <Notice tone="info" title={t('login.newTitle')}>{t('login.newBody')}</Notice>
            : <Notice tone="success">{t('login.codeSent', { phone })}</Notice>}
          {devOtp && <Notice tone="warn" title={t('login.devHint')}><span className="text-2xl font-extrabold tracking-widest">{devOtp}</span></Notice>}
          {isNew && (
            <Field label={t('login.name')} hint={t('login.nameHint')}>
              <TextInput autoComplete="name" autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label={t('login.code')}>
            <TextInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <BigButton type="submit" icon={CheckIcon} disabled={code.length !== 6 || busy || (isNew && name.trim().length < 2)}>{busy ? t('common.wait') : isNew ? t('login.signup') : t('login.verify')}</BigButton>
          <BigButton variant="secondary" disabled={busy} onClick={() => { setStep('phone'); setIsNew(false); setError(null); setDevOtp(null); }}>{t('login.changeNumber')}</BigButton>
        </form>
      )}
    </div>
  );
}
