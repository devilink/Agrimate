import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Party } from '@/lib/types';

export interface Viewer {
  userId: string;
  email: string;
  isAdmin: boolean;
  party: Party | null;
}

type ViewerState = { status: 'none' } | { status: 'blocked' } | { status: 'ok'; viewer: Viewer };

/** The signed-in user, validated with Supabase Auth on every request (not just decoded from the cookie). */
const loadViewer = cache(async (): Promise<ViewerState> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'none' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, party:parties(*)')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile) return { status: 'blocked' };

  const party = (profile.party as unknown as Party | null) ?? null;
  // A deactivated party is locked out. Admins have no party.
  if (!profile.is_admin && (!party || !party.active)) return { status: 'blocked' };

  return { status: 'ok', viewer: { userId: user.id, email: user.email ?? '', isAdmin: profile.is_admin, party } };
});

export async function getViewer(): Promise<Viewer | null> {
  const s = await loadViewer();
  return s.status === 'ok' ? s.viewer : null;
}

/** Signed out goes to /login; signed in but deactivated goes to /blocked (not /login, which would loop). */
export async function requireViewer(): Promise<Viewer> {
  const s = await loadViewer();
  if (s.status === 'none') redirect('/login');
  if (s.status === 'blocked') redirect('/blocked');
  return s.viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect('/dashboard');
  return viewer;
}

/** How the person appears in order timelines. */
export function actorLabel(viewer: Viewer): string {
  if (viewer.isAdmin) return 'Agrimate team';
  const p = viewer.party!;
  return `${p.name} (${p.type})`;
}

/** Only verified parties can trade; admins verify new sign-ups after checking them. */
export function canTrade(viewer: Viewer): boolean {
  return viewer.isAdmin || Boolean(viewer.party?.verified);
}
