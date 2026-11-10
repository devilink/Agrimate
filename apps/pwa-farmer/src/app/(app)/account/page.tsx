'use client';
import type { MeView } from '@agrimate/api-client';
import { FileIcon, LogoutIcon, ShieldIcon } from '@/components/icons';
import { BigButton, BigLink, ListSkeleton, PageTitle, Panel, Row } from '@/components/ui';
import { signOut } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

export default function AccountPage() {
  const { t } = useI18n();
  const { data: me, loading } = useApi<MeView>('/auth/me');
  if (loading) return <ListSkeleton rows={2} />;
  return (
    <div className="space-y-4">
      <PageTitle>{t('account.title')}</PageTitle>
      {me && (
        <Panel>
          <Row label={t('account.name')}>{me.name}</Row>
          <Row label={t('account.phone')}>{me.phone}</Row>
          {me.farmer?.fpoName && <Row label={t('account.fpo')}>{me.farmer.fpoName}</Row>}
          {me.farmer?.pin && <Row label={t('account.pin')}>{me.farmer.pin}</Row>}
        </Panel>
      )}
      <BigLink href="/kyc" icon={ShieldIcon}>{t('account.kyc')}</BigLink>
      <BigLink href="/organic" variant="secondary" icon={FileIcon}>{t('account.organic')}</BigLink>
      <BigButton variant="secondary" icon={LogoutIcon} onClick={() => void signOut()}>{t('account.signOut')}</BigButton>
    </div>
  );
}
