'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fail, run, type ActionState } from '@/lib/action';

function password(form: FormData, name = 'password'): string {
  const v = form.get(name);
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) fail('Password must be 8 to 72 characters.');
  return v;
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const next = password(form);
    if (form.get('confirm') !== next) fail('The two passwords do not match.');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) fail('Your session expired. Request a new reset link.');
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) fail(error.code === 'same_password' ? 'Choose a different password from your current one.' : 'Could not update the password.');
    return 'Password updated.';
  });
}
