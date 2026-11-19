import Link from 'next/link';
import { Field, Input, Select } from '@/components/ui';
import { SignupForm } from '@/components/auth-forms';
import { AuthHeading } from '@/components/auth-heading';

export const metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <>
      <AuthHeading title="Create your account" subtitle="Free to join. Our team verifies every account before it can trade." />
      <SignupForm>
        <Field label="I am a">
          <Select name="party_type" required defaultValue="">
            <option value="" disabled>Choose one</option>
            <option value="buyer">Buyer (trader, processor, retailer)</option>
            <option value="farmer">Farmer or FPO</option>
            <option value="transporter">Transporter</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input name="name" required maxLength={120} autoComplete="name" /></Field>
          <Field label="Company / FPO" hint="Optional"><Input name="company" maxLength={160} autoComplete="organization" /></Field>
        </div>
        <Field label="Mobile number"><Input name="phone" type="tel" maxLength={20} autoComplete="tel" placeholder="+91" /></Field>
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input name="password" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></Field>
      </SignupForm>
      <p className="mt-8 text-center text-sm text-stone-600">
        Already have an account? <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-900">Sign in</Link>
      </p>
    </>
  );
}
