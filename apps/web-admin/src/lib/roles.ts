/** Who may use the console, where each role lands, and which pages each role may open. */
export type ConsoleRole = 'ADMIN' | 'INSPECTOR' | 'LOGISTICS';

export const CONSOLE_ROLES: readonly string[] = ['ADMIN', 'INSPECTOR', 'LOGISTICS'];
export const isConsoleRole = (r: string): r is ConsoleRole => CONSOLE_ROLES.includes(r);

export const ROLE_LABEL: Record<ConsoleRole, string> = { ADMIN: 'Ops console', INSPECTOR: 'Quality verifier', LOGISTICS: 'Transport manager' };

export const HOME: Record<ConsoleRole, string> = { ADMIN: '/', INSPECTOR: '/verifier', LOGISTICS: '/transport' };

export const NAV: Record<ConsoleRole, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/', label: 'Overview' },
    { href: '/queues', label: 'Verification queues' },
    { href: '/orders', label: 'Orders' },
    { href: '/quality', label: 'Quality checks' },
    { href: '/transport-requests', label: 'Transport requests' },
    { href: '/disputes', label: 'Disputes' },
    { href: '/payouts', label: 'Payouts' },
    { href: '/ledger', label: 'Ledger and escrow' },
    { href: '/reconciliation', label: 'Reconciliation' },
    { href: '/sla', label: 'SLA breach board' },
    { href: '/masters', label: 'Masters' },
    { href: '/audit', label: 'Audit log' },
  ],
  INSPECTOR: [{ href: '/verifier', label: 'Quality check desk' }],
  LOGISTICS: [{ href: '/transport', label: 'Transport desk' }],
};

/** Staff pages call staff-only endpoints, and admin pages call /admin/*, so each role is kept to its own pages. */
const STAFF_PAGES = ['/verifier', '/transport'];
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function canOpen(role: ConsoleRole, path: string): boolean {
  if (role === 'ADMIN') return !STAFF_PAGES.some((p) => under(path, p));
  return under(path, HOME[role]);
}
