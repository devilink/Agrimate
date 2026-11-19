import { ButtonLink, Logo } from '@/components/ui';
import { IconArrowLeft, IconSearch } from '@/components/icons';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <Logo className="mb-10" />
      <span className="grid size-14 place-items-center rounded-2xl bg-white text-brand-700 shadow-card ring-1 ring-stone-200"><IconSearch className="size-6" /></span>
      <p className="mt-6 font-mono text-sm font-semibold text-harvest-600">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">We couldn’t find that page</h1>
      <p className="mt-3 text-stone-600">
        It may have moved, or you may not have access to it. If you followed a link to an order, check that you’re signed in
        with the right account.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/dashboard"><IconArrowLeft />Go to dashboard</ButtonLink>
        <ButtonLink href="/" variant="secondary">Home</ButtonLink>
      </div>
    </main>
  );
}
