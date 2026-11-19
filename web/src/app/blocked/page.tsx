import { signOut } from '@/app/actions/auth';
import { buttonClass, Logo } from '@/components/ui';
import { IconLock } from '@/components/icons';

export const metadata = { title: 'Account not active' };

export default function BlockedPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <Logo className="mb-8 self-center" />
      <div className="rounded-3xl border border-stone-200/80 bg-white p-8 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-harvest-50 text-harvest-600 ring-1 ring-harvest-200"><IconLock /></span>
        <h1 className="mt-5 font-display text-2xl font-semibold">This account is not active</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          It has been disabled, or its setup didn&apos;t finish. Please contact the Agrimate team.
        </p>
        <form action={signOut} className="mt-6">
          <button className={buttonClass('secondary')}>Sign out</button>
        </form>
      </div>
    </main>
  );
}
