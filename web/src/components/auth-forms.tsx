'use client';

// Sign-in, sign-up and reset run in the browser, straight to Supabase Auth, so its per-IP rate limits see each
// user's own IP. Run on the server, every user would share Vercel's IPs and one busy hour could lock everyone out.

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';
import { enterAdmin } from '@/app/actions/admin-login';
import { buttonClass, cx, FormMessage } from '@/components/ui';
import { Spinner } from '@/components/icons';

type Msg = { error?: string; ok?: string };

function useAuthForm(handler: (f: FormData) => Promise<Msg | void>) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>({});
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      setMsg((await handler(new FormData(e.currentTarget))) ?? {});
    } catch {
      setMsg({ error: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, onSubmit };
}

function Shell({ onSubmit, busy, msg, label, children }: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void; busy: boolean; msg: Msg; label: string; children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {children}
      <FormMessage error={msg.error} ok={msg.ok} />
      <button disabled={busy} className={cx(buttonClass('primary'), 'h-11 w-full text-[0.9375rem]')}>
        {busy && <Spinner />}{label}
      </button>
    </form>
  );
}

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export function LoginForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const form = useAuthForm(async (f) => {
    const { error } = await browserClient().auth.signInWithPassword({ email: s(f, 'email').toLowerCase(), password: String(f.get('password') ?? '') });
    if (error) {
      if (error.code === 'email_not_confirmed') return { error: 'Please confirm your email first. Check your inbox.' };
      if (error.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' };
      return { error: 'Wrong email or password.' };
    }
    router.replace('/dashboard');
    router.refresh();
  });
  return <Shell {...form} label="Sign in">{children}</Shell>;
}

export function AdminLoginForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const form = useAuthForm(async (f) => {
    const { error } = await browserClient().auth.signInWithPassword({ email: s(f, 'email').toLowerCase(), password: String(f.get('password') ?? '') });
    if (error) {
      if (error.code === 'email_not_confirmed') return { error: 'Please confirm your email first. Check your inbox.' };
      if (error.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' };
      return { error: 'Wrong email or password.' };
    }
    const { ok } = await enterAdmin();
    if (!ok) {
      await browserClient().auth.signOut().catch(() => {});
      return { error: 'This account does not have admin access.' };
    }
    router.replace('/admin/parties');
    router.refresh();
  });
  return <Shell {...form} label="Sign in to admin">{children}</Shell>;
}

export function SignupForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const form = useAuthForm(async (f) => {
    const type = s(f, 'party_type');
    if (!['buyer', 'farmer', 'transporter'].includes(type)) return { error: 'Choose how you will use Agrimate.' };
    const password = String(f.get('password') ?? '');
    if (password.length < 8 || password.length > 72) return { error: 'Password must be 8 to 72 characters.' };
    const { data, error } = await browserClient().auth.signUp({
      email: s(f, 'email').toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Read once by the database trigger, which whitelists the type and trims the text. Never used for permissions.
        data: { party_type: type, name: s(f, 'name').slice(0, 120), company: s(f, 'company').slice(0, 160), phone: s(f, 'phone').slice(0, 20) },
      },
    });
    if (error) {
      if (error.code === 'weak_password') return { error: 'Choose a stronger password.' };
      if (error.status === 429) return { error: 'Too many sign-ups right now. Please try again in a few minutes.' };
      return { error: 'Could not create the account. Please try again.' };
    }
    if (data.session) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }
    return { ok: 'Account created. Check your email for a confirmation link, then sign in.' };
  });
  return <Shell {...form} label="Create account">{children}</Shell>;
}

export function ForgotForm({ children }: { children: ReactNode }) {
  const form = useAuthForm(async (f) => {
    await browserClient().auth.resetPasswordForEmail(s(f, 'email').toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/password`,
    });
    // Same answer whether or not the account exists, so this can't be used to discover emails.
    return { ok: 'If that email has an account, a reset link is on its way.' };
  });
  return <Shell {...form} label="Send reset link">{children}</Shell>;
}
