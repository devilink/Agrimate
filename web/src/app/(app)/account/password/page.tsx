import { updatePassword } from '@/app/actions/auth';
import { ActionForm, Submit } from '@/components/action-form';
import { Card, Field, Input, PageHeader } from '@/components/ui';

export const metadata = { title: 'Change password' };

export default function PasswordPage() {
  return (
    <>
      <PageHeader back={{ href: '/account', label: 'Account' }} title="Change password" />
      <Card className="max-w-md">
        <ActionForm action={updatePassword} resetOnSuccess>
          <Field label="New password" hint="At least 8 characters"><Input name="password" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></Field>
          <Field label="Repeat new password"><Input name="confirm" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></Field>
          <Submit>Update password</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
