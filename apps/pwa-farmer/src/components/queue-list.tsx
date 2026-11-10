'use client';
import { errorText } from '@/lib/errors';
import { ApiError } from '@agrimate/api-client';
import { currentUserId } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { discard, useQueue, type QueueKind } from '@/lib/queue';
import { TrashIcon } from './icons';
import { BigButton, Notice } from './ui';

/** Writes that are waiting for a connection, plus those the server refused, with the reason in plain words. */
export function QueueList({ kinds }: { kinds: QueueKind[] }) {
  const { t, has } = useI18n();
  const owner = currentUserId();
  const items = useQueue().filter((q) => kinds.includes(q.kind) && q.ownerId === owner);
  if (!items.length) return null;
  return (
    <div className="mb-4 space-y-3">
      {items.map((q) => q.status === 'PENDING'
        ? <Notice key={q.id} tone="wait" title={t('queue.waitingTitle')}>{q.label}</Notice>
        : (
          <Notice key={q.id} tone="error" title={t('queue.failedTitle')}>
            <p className="mb-1 font-semibold">{q.label}</p>
            <p className="mb-2">{errorText(new ApiError(q.error?.status ?? 0, q.error?.code, '', q.error?.body), t, has)}</p>
            <BigButton variant="secondary" icon={TrashIcon} onClick={() => discard(q.id)}>{t('queue.discard')}</BigButton>
          </Notice>
        ))}
    </div>
  );
}
