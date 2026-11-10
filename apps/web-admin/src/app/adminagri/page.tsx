'use client';
/**
 * Console sign-in at an unlisted path. Admins use email and password; quality verifiers use a phone code. Transport
 * managers sign in on the main site's sign-in page instead. The staff tab never sends signup details, so this page cannot be used to create an account.
 */
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, type SessionUser } from '@agrimate/api-client';
import { isValidPhone, normalisePhone } from '@agrimate/shared';
import { Alert, Button, Field, Input, cn } from '@agrimate/ui';
import { api, errorMessage, setEntry, tokens } from '@/lib/api';
import { HOME, isConsoleRole } from '@/lib/roles';

type Tab = 'admin' | 'staff';
const NOT_ADMIN = 'That account is not an admin account, so you have not been signed in.';
const NOT_STAFF = 'That number does not belong to a quality verifier, so you have not been signed in. Transport partners sign in on the main Agrimate sign-in page.';
const NO_ACCOUNT = 'There is no staff account for this number. Verifiers and transport partners register in the Agrimate inspector or logistics app, then an admin approves them.';

function LoginForm() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const [tab, setTab] = useState<Tab>('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(reason === 'role' ? 'That account cannot use the console, so you have not been signed in.' : null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => { document.title = 'Sign in · Agrimate console'; }, []);

  async function finish(user: SessionUser, accept: (role: string) => boolean, refusal: string) {
    if (!accept(user.role) || !isConsoleRole(user.role)) {
      await api.logout();
      throw new Error(refusal);
    }
    setEntry(null);
    window.location.assign(HOME[user.role]);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  const submitAdmin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // A leftover token would make a wrong password look like an expired session.
      await tokens.clear();
      await finish(await api.login(email.trim(), password), (r) => r === 'ADMIN', NOT_ADMIN);
    });
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(phone.trim());
    if (!isValidPhone(p)) { setError('Enter a 10 digit Indian mobile number, with or without +91.'); return; }
    void run(async () => {
      const r = await api.requestOtp(p);
      setDevOtp(r.devOtp ?? null);
      setCode('');
      setCodeSent(true);
      setBusy(false);
    });
  };

  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await tokens.clear();
      try {
        const user = await api.verifyOtp({ phone: normalisePhone(phone.trim()), code: code.trim() });
        await finish(user, (r) => r === 'INSPECTOR', NOT_STAFF);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'SIGNUP_DETAILS_REQUIRED') {
          setCodeSent(false); setDevOtp(null);
          throw new Error(NO_ACCOUNT);
        }
        throw err;
      }
    });
  };

  const switchTab = (t: Tab) => { setTab(t); setError(null); };
  const tabClass = (active: boolean) => cn('h-9 flex-1 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700', active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white');

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-600/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-lime-500/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-600 text-lg font-bold text-white">A</span>
          <div>
            <h1 className="text-lg font-semibold text-white">Agrimate console</h1>
            <p className="text-sm text-slate-400">Restricted. Authorised staff only.</p>
          </div>
        </div>

        <div role="group" aria-label="Account type" className="mb-4 flex gap-1 rounded-lg bg-white/10 p-1">
          <button type="button" aria-pressed={tab === 'admin'} className={tabClass(tab === 'admin')} onClick={() => switchTab('admin')}>Admin</button>
          <button type="button" aria-pressed={tab === 'staff'} className={tabClass(tab === 'staff')} onClick={() => switchTab('staff')}>Quality verifier</button>
        </div>

        <div className="rounded-xl border border-white/10 bg-white p-6 shadow-2xl">
          {reason === 'expired' && !error && <Alert className="mb-4">Your session ended. Sign in again to continue.</Alert>}

          {tab === 'admin' && (
            <form onSubmit={submitAdmin} className="space-y-3">
              <Field label="Email"><Input type="email" required autoFocus autoComplete="username" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></Field>
              {error && <Alert tone="red" role="alert">{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            </form>
          )}

          {tab === 'staff' && !codeSent && (
            <form onSubmit={requestCode} className="space-y-3">
              <p className="text-sm text-slate-600">For quality verifiers. We send a code to your registered mobile.</p>
              <Field label="Mobile number"><Input type="tel" autoComplete="tel" required placeholder="+91 90000 00301" value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} /></Field>
              {error && <Alert tone="red" role="alert">{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending code…' : 'Send code'}</Button>
            </form>
          )}

          {tab === 'staff' && codeSent && (
            <form onSubmit={verifyCode} className="space-y-3">
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
              {error && <Alert tone="red" role="alert">{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</Button>
              <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setCodeSent(false); setError(null); }}>Use a different number or resend</Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function AdminAgriPage() {
  return <Suspense><LoginForm /></Suspense>;
}
