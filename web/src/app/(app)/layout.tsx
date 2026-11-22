import { requireViewer } from '@/lib/auth';
import { AppNav, type NavGroup, type NavLink } from '@/components/app-nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const type = viewer.party?.type;
  const trader = viewer.isAdmin || type === 'buyer' || type === 'farmer';

  const links: NavLink[] = [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' }];
  if (trader) links.push({ href: '/market', label: 'Market', icon: 'market' });
  if (type === 'farmer') links.push({ href: '/listings', label: 'My listings', icon: 'listings' });
  if (type === 'buyer') links.push({ href: '/requirements', label: 'My requirements', icon: 'requirements' });
  links.push(trader ? { href: '/orders', label: 'Orders', icon: 'orders' } : { href: '/orders', label: 'My jobs', icon: 'jobs' });
  if (trader) links.push({ href: '/prices', label: 'Market prices', icon: 'prices' });
  const groups: NavGroup[] = [{ links }];
  if (viewer.isAdmin) {
    groups.push({
      label: 'Admin',
      links: [
        { href: '/admin', label: 'Overview', icon: 'overview' },
        { href: '/admin/parties', label: 'Parties', icon: 'parties' },
        { href: '/admin/offers', label: 'Offers', icon: 'offers' },
        { href: '/listings', label: 'Listings', icon: 'listings' },
        { href: '/requirements', label: 'Requirements', icon: 'requirements' },
        { href: '/admin/payments', label: 'Payments', icon: 'payments' },
        { href: '/admin/prices', label: 'Reference prices', icon: 'prices' },
        { href: '/admin/orders/new', label: 'New order', icon: 'new-order' },
        { href: '/admin/audit', label: 'Activity log', icon: 'activity' },
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
