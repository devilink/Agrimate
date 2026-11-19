import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Bypasses row-level security. Only call it AFTER checking the user may do the thing, and never send its
 * results to the browser without filtering them.
 */
export function adminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
