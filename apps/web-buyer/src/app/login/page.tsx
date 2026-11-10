'use client';
/** Sign-in for buyers, farmers and transport partners. Buyers stay in this portal; the others are handed to their own app. */
import type { SessionUser } from '@agrimate/api-client';
import { ApiError } from '@agrimate/api-client';
import { isValidPhone, normalisePhone } from '@agrimate/shared';
import { Alert, Button, Card, Field, Input } from '@agrimate/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { FormError } from '@/components/common';
import { api, tokens } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { HandoffLogin } from './handoff-login';

const ROLE_ERROR = 'That is not a buyer account. Farmers and transport partners, choose your account type above.';

function BuyerLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const { busy, error, run, setError, clearError } = useAction();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [isNewNumber, setIsNewNumber] = useState(false);

  useEffect(() => {
    if (params.get('reason') === 'role') setError(ROLE_ERROR);
    else if (tokens.getAccess()) router.replace('/dashboard');
  }, [params, router, setError]);

  /** Non-buyer accounts get real tokens from the API, so they are discarded here before anything else can use them. */
  async function finish(user: SessionUser) {
    if (user.role !== 'BUYER') {
      await api.logout();
      throw new Error(ROLE_ERROR);
    }
    router.replace('/dashboard');
  }

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => finish(await api.login(email.trim(), password)));
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(phone.trim());
    if (!isValidPhone(p)) {
      setError('Enter a 10 digit Indian mobile number, with or without +91.');
      return;
    }
    void run(async () => {
      const r = await api.requestOtp(p);
      setDevOtp(r.devOtp ?? null);
      setExpiresIn(r.expiresInMinutes);
      setCode('');
      setCodeSent(true);
    });
  };

  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(phone.trim());
    const signup = name.trim().length >= 2 ? { role: 'BUYER', name: name.trim() } : {};
    void run(async () => {
      try {
        await finish(await api.verifyOtp({ phone: p, code: code.trim(), ...signup }));
      } catch (err) {
        // The API spends the code before it finds the number is new, so a fresh code is needed along with the name.
        if (err instanceof ApiError && err.code === 'SIGNUP_DETAILS_REQUIRED') {
          setIsNewNumber(true);
          setCodeSent(false);
          setDevOtp(null);
          throw new Error('This number is new to Agrimate. Enter your business name, then request a new code.');
        }
        throw err;
      }
    });
  };

  const switchMode = (m: 'phone' | 'email') => { setMode(m); clearError(); };
  const tabClass = (active: boolean) => `h-9 flex-1 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`;

  return (
    <>
      <div role="group" aria-label="Sign in method" className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1">
        <button type="button" aria-pressed={mode === 'phone'} className={tabClass(mode === 'phone')} onClick={() => switchMode('phone')}>Phone code</button>
        <button type="button" aria-pressed={mode === 'email'} className={tabClass(mode === 'email')} onClick={() => switchMode('email')}>Email</button>
      </div>

      {mode === 'email' && (
        <form onSubmit={submitEmail} className="space-y-3">
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</Button>
        </form>
      )}

      {mode === 'phone' && !codeSent && (
        <form onSubmit={requestCode} className="space-y-3">
          <Field label="Mobile number"><Input type="tel" autoComplete="tel" required placeholder="+91 90000 00101" value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label={isNewNumber ? 'Business name' : 'Business name (new accounts only)'}>
            <Input autoComplete="organization" required={isNewNumber} minLength={2} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending code' : 'Send code'}</Button>
        </form>
      )}

      {mode === 'phone' && codeSent && (
        <form onSubmit={verifyCode} className="space-y-3">
          <p className="text-sm text-slate-700">Code sent to {normalisePhone(phone.trim())}{expiresIn ? `. It expires in ${expiresIn} minutes.` : '.'}</p>
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
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Verifying' : 'Verify and sign in'}</Button>
          <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setCodeSent(false); clearError(); }}>Use a different number or resend</Button>
        </form>
      )}
    </>
  );
}

type Who = 'buyer' | 'farmer' | 'transport';

const ROLES: { key: Who; title: string; blurb: string; icon: string }[] = [
  { key: 'buyer', title: 'Buyer', blurb: 'Buy in bulk, pay into escrow', icon: 'M3 7h18l-2 11H5L3 7zm5 0V5a4 4 0 0 1 8 0v2' },
  { key: 'farmer', title: 'Farmer or FPO', blurb: 'Sell your crop direct', icon: 'M12 21v-9m0 0c0-4-3-7-8-7 0 5 3 7 8 7zm0 2c0-3 3-6 8-6 0 5-3 6-8 6zM6 21h12' },
  { key: 'transport', title: 'Transport', blurb: 'Haul paid loads', icon: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
];

const initialWho = (v: string | null): Who => (v === 'farmer' || v === 'transport' ? v : 'buyer');

const POINTS = ['Escrow on every order through an RBI-regulated bank', 'Stock graded on site by qualified quality verifiers', 'Tracked trucks with digital proof of delivery'];

function Chooser() {
  const params = useSearchParams();
  const [who, setWho] = useState<Who>(initialWho(params.get('as')));

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-emerald-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-emerald-500/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 h-[26rem] w-[26rem] rounded-full bg-lime-400/20 blur-3xl" />
        <Link href="/" className="relative flex items-center gap-2 text-xl font-bold"><span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-lime-400 text-emerald-950">A</span>Agrimate</Link>
        <div className="relative max-w-md">
          <p className="text-4xl font-semibold leading-tight">Fair prices, verified quality, and money held safe until delivery.</p>
          <ul className="mt-8 space-y-3 text-emerald-100">
            {POINTS.map((t) => <li key={t} className="flex gap-3"><span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-lime-400" />{t}</li>)}
          </ul>
        </div>
        <p className="relative text-sm text-emerald-200/70">© {new Date().getFullYear()} Agrimate</p>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-4 sm:p-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-lg font-bold text-emerald-900 lg:hidden"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-700 text-white">A</span>Agrimate</Link>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in or create an account</h1>
          <p className="mb-5 mt-1 text-sm text-slate-600">Choose how you use Agrimate.</p>

          <div role="radiogroup" aria-label="Account type" className="mb-5 grid grid-cols-3 gap-3">
            {ROLES.map((r) => {
              const on = who === r.key;
              return (
                <button key={r.key} type="button" role="radio" aria-checked={on} onClick={() => setWho(r.key)}
                  className={`rounded-xl border-2 p-3 text-left sm:p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${on ? 'border-emerald-600 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <svg aria-hidden viewBox="0 0 24 24" className={`mb-2 h-7 w-7 ${on ? 'text-emerald-700' : 'text-slate-500'}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={r.icon} /></svg>
                  <span className="block font-semibold text-slate-900">{r.title}</span>
                  <span className="block text-xs text-slate-600">{r.blurb}</span>
                </button>
              );
            })}
          </div>

          <Card>{who === 'buyer' ? <BuyerLogin /> : <HandoffLogin key={who} kind={who} />}</Card>
          <p className="mt-4 text-center text-sm text-slate-500"><Link href="/" className="underline underline-offset-2 hover:text-slate-800">Back to the home page</Link></p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><Chooser /></Suspense>;
}
