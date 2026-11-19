import Link from 'next/link';
import { Field, Input } from '@/components/ui';
import { ForgotForm } from '@/components/auth-forms';
import { AuthHeading } from '@/components/auth-heading';

export const metadata = { title: 'Reset password' };

export default function ForgotPage() {
  return (
    <>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we’ll send you a link to choose a new one." />
      <ForgotForm>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></Field>
      </ForgotForm>
      <p className="mt-8 text-center text-sm text-stone-600">
        <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-900">← Back to sign in</Link>
      </p>
    </>
  );
}
