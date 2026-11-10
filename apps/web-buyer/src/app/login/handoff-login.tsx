'use client';
/**
 * Phone sign-in on the main site for accounts that work in another Agrimate app: farmers (farmer app) and transport
 * managers (transport desk in the console). Those apps are separate origins with their own storage, so this signs in
 * with a throwaway in-memory client and passes the tokens to the target app's /handoff page in the URL fragment. The
 * tokens are never stored or logged out here, since logging out would revoke the session being handed over.
 */
import { ApiError, createApi, type SessionUser, type TokenStore } from '@agrimate/api-client';
import { isValidPhone, normalisePhone } from '@agrimate/shared';
import { Alert, Button, Field, Input, Select } from '@agrimate/ui';
import { type FormEvent, useMemo, useState } from 'react';
import { FormError } from '@/components/common';
import { API_URL } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ADMIN_URL, FARMER_URL } from '@/lib/portals';

const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी' }, { code: 'as', label: 'অসমীয়া' }, { code: 'bn', label: 'বাংলা' }];

function memoryTokens(): TokenStore & { access: string | null; refresh: string | null } {
  const s = { access: null as string | null, refresh: null as string | null };
  return Object.assign(s, {
    getAccess: () => s.access,
    getRefresh: () => s.refresh,
    set: (a: string, r: string) => { s.access = a; s.refresh = r; },
    clear: () => { s.access = null; s.refresh = null; },
  });
}

export type HandoffKind = 'farmer' | 'transport';

const KINDS: Record<HandoffKind, { role: string; target: () => string; placeholder: string; wrongRole: string; signup: boolean; note: string }> = {
  farmer: {
    role: 'FARMER', target: () => `${FARMER_URL}/handoff`, placeholder: '+91 90000 00201', signup: true,
    wrongRole: 'This number belongs to an account that is not a farmer. Choose the right account type above.',
    note: 'You will continue in the Agrimate farmer app, in English, Hindi, Assamese or Bengali.',
  },
  transport: {
    role: 'LOGISTICS', target: () => `${ADMIN_URL}/handoff`, placeholder: '+91 90000 00401', signup: false,
    wrongRole: 'This number does not belong to a transport partner. Choose the right account type above.',
    note: 'For registered transport partners. New partners register in the Agrimate logistics app with their RC, licence and fitness documents.',
  },
};

export function HandoffLogin({ kind }: { kind: HandoffKind }) {
  const cfg = KINDS[kind];
  const store = useMemo(memoryTokens, []);
  const farmerApi = useMemo(() => createApi({ baseUrl: API_URL, tokens: store }), [store]);
  const { busy, error, run, setError, clearError } = useAction();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [codeSent, setCodeSent] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const handOff = async (user: SessionUser) => {
    if (user.role !== cfg.role || !store.access || !store.refresh) {
      // A session for some other kind of account was never meant to exist, so it is revoked rather than handed on.
      await farmerApi.logout();
      throw new Error(cfg.wrongRole);
    }
    const hash = new URLSearchParams({ at: store.access, rt: store.refresh }).toString();
    store.clear();
    window.location.replace(`${cfg.target()}#${hash}`);
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(phone.trim());
    if (!isValidPhone(p)) { setError('Enter a 10 digit Indian mobile number, with or without +91.'); return; }
    void run(async () => {
      const r = await farmerApi.requestOtp(p);
      setDevOtp(r.devOtp ?? null);
      setCode('');
      setCodeSent(true);
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(phone.trim());
    void run(async () => {
      try {
        const signup = isNew && name.trim().length >= 2 ? { role: 'FARMER', name: name.trim(), language } : {};
        await handOff(await farmerApi.verifyOtp({ phone: p, code: code.trim(), ...signup }));
      } catch (err) {
        // The API spends the code before it finds the number is new, so a fresh code is needed along with the name.
        if (err instanceof ApiError && err.code === 'SIGNUP_DETAILS_REQUIRED') {
          if (!cfg.signup) {
            setCodeSent(false);
            setDevOtp(null);
            throw new Error('There is no transport partner account for this number. Register in the Agrimate logistics app first.');
          }
          setIsNew(true);
          setCodeSent(false);
          setDevOtp(null);
          throw new Error('Welcome! This number is new to Agrimate. Enter your name, then request a new code.');
        }
        throw err;
      }
    });
  };

  if (!codeSent) {
    return (
      <form onSubmit={requestCode} className="space-y-3">
        <Field label="Mobile number"><Input type="tel" autoComplete="tel" required placeholder={cfg.placeholder} value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} /></Field>
        {isNew && (
          <>
            <Field label="Your name"><Input autoComplete="name" required minLength={2} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Language for the app">
              <Select value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Select>
            </Field>
          </>
        )}
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending code' : 'Send code'}</Button>
        <p className="text-center text-xs text-slate-500">{cfg.note}</p>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      <p className="text-sm text-slate-700">Code sent to {normalisePhone(phone.trim())}.</p>
      {devOtp && (
        <Alert tone="blue" className="flex items-center justify-between gap-2">
          <span>Development code: <strong className="tabular-nums">{devOtp}</strong></span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setCode(devOtp)}>Fill</Button>
        </Alert>
      )}
      <Field label="6 digit code">
        <Input inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" autoFocus value={code} disabled={busy} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Verifying' : 'Verify and continue'}</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setCodeSent(false); clearError(); }}>Use a different number or resend</Button>
    </form>
  );
}
