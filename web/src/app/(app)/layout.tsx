import { requireViewer } from '@/lib/auth';
import { AppNav, type NavGroup } from '@/components/app-nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const type = viewer.party?.type;
  const trader = viewer.isAdmin || type === 'buyer' || type === 'farmer';

  const groups: NavGroup[] = [{
    links: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      ...(trader ? [{ href: '/market', label: 'Market', icon: 'market' as const }] : []),
      trader ? { href: '/orders', label: 'Orders', icon: 'orders' } : { href: '/orders', label: 'My jobs', icon: 'jobs' },
    ],
  }];
  if (viewer.isAdmin) {
    groups.push({
      label: 'Admin',
      links: [
        { href: '/admin/parties', label: 'Parties', icon: 'parties' },
        { href: '/admin/orders/new', label: 'New order', icon: 'new-order' },
        { href: '/admin/settings', label: 'Settings', icon: 'settings' },
      ],
    });
  }
  groups.push({ label: 'You', links: [{ href: '/account', label: 'Account', icon: 'account' }] });

  return (
    <div className="min-h-screen lg:pl-64">
      <AppNav
        groups={groups}
        name={viewer.party?.name ?? 'Agrimate team'}
        email={viewer.email}
        role={viewer.isAdmin ? 'admin' : (type ?? 'member')}
      />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
