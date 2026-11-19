import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Field, Input } from '@/components/ui';
import { AdminLoginForm } from '@/components/auth-forms';
import { AuthHeading } from '@/components/auth-heading';
import { getViewer } from '@/lib/auth';

export const metadata = { title: 'Admin sign in', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const viewer = await getViewer();
  if (viewer?.isAdmin) redirect('/admin/parties');

  return (
    <>
      <AuthHeading title="Admin sign in" subtitle="For the Agrimate team. Manage parties, orders and settings." />
      <AdminLoginForm>
        <Field label="Admin email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-[0.8125rem] font-medium text-stone-700">Password</label>
            <Link href="/forgot" className="text-[0.8125rem] font-medium text-brand-700 hover:text-brand-900">Forgot password?</Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </AdminLoginForm>
      <p className="mt-8 text-center text-sm text-stone-600">
        Not on the team? <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-900">Go to the regular sign in</Link>
      </p>
    </>
  );
}
