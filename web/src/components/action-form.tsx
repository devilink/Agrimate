'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass, cx, FormMessage, type ButtonVariant } from '@/components/ui';
import { Spinner } from '@/components/icons';

type State = { error?: string; ok?: string } | undefined;
type Action = (prev: State, form: FormData) => Promise<State>;

/** A form bound to a server action, showing its error or success message underneath. */
export function ActionForm({
  action, children, className, resetOnSuccess = false, hidden,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={cx('space-y-4', className)}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <FormMessage error={state?.error} ok={state?.ok} />
    </form>
  );
}

export function Submit({ children, variant = 'primary', small, name, value }: {
  children: ReactNode; variant?: ButtonVariant; small?: boolean; name?: string; value?: string;
}) {
  const { pending, data } = useFormStatus();
  // With several submit buttons in one form, only the one that was pressed shows the spinner.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={mine || undefined} className={buttonClass(variant, small)}>
      {mine && <Spinner />}
      {children}
    </button>
  );
}
