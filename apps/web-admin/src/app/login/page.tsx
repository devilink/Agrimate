import { redirect } from 'next/navigation';

/** The console signs in at /adminagri. Old bookmarks to /login still work. */
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  redirect(reason === 'expired' || reason === 'role' ? `/adminagri?reason=${reason}` : '/adminagri');
}
