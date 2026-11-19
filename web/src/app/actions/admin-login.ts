'use server';

import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

/** Emails allowed to become admin by signing in at /adminagri. Comma-separated in ADMIN_EMAILS, server-only. */
function bootstrapEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Runs right after a sign-in on /adminagri. Lets the person in if they are already an admin. If their confirmed
 * email is listed in ADMIN_EMAILS, makes them an admin first (once). Anyone else is signed straight back out.
 */
export async function enterAdmin(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('user_id', user.id).maybeSingle();
  if (profile?.is_admin) return { ok: true };

  const email = user.email?.toLowerCase();
  // Only a confirmed address counts, so nobody can claim admin by signing up with the email before its owner.
  if (email && user.email_confirmed_at && bootstrapEmails().includes(email)) {
    const db = adminClient();
    // Same call Settings uses for new admins: drops the party made at signup and sets the admin flag.
    const { error } = await db.rpc('link_login', { p_user: user.id, p_party: null, p_admin: true });
    if (!error) {
      await db.from('audit_log').insert({ actor_id: user.id, action: 'admin.bootstrap', entity: 'user', entity_id: user.id });
      return { ok: true };
    }
  }

  await supabase.auth.signOut();
  return { ok: false };
}
