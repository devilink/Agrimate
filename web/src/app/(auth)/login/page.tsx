import Link from 'next/link';
import { Field, Input, Notice } from '@/components/ui';
import { LoginForm } from '@/components/auth-forms';
import { AuthHeading } from '@/components/auth-heading';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to see your market, orders and payments." />
      {error === 'link' && <Notice>That link has expired or was already used. Sign in, or request a new one.</Notice>}
      <LoginForm>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-[0.8125rem] font-medium text-stone-700">Password</label>
            <Link href="/forgot" className="text-[0.8125rem] font-medium text-brand-700 hover:text-brand-900">Forgot password?</Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </LoginForm>
      <p className="mt-8 text-center text-sm text-stone-600">
        New to Agrimate? <Link href="/signup" className="font-semibold text-brand-700 hover:text-brand-900">Create an account</Link>
      </p>
    </>
  );
}

