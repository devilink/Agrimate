'use client';
import type { FarmerOrder } from '@agrimate/api-client';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CameraIcon, CheckIcon, RefreshIcon, ScaleIcon, ShieldIcon, TruckIcon } from '@/components/icons';
import { useOnline } from '@/components/app-shell';
import { BigButton, BigLink, ErrorNotice, Field, ListSkeleton, Notice, PageTitle, Panel, TextInput, cn } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';
import { ClipRecorder, type ClipKind } from './recorder';

/** Everything the recorder depends on. Camera and crypto.subtle exist only on HTTPS or localhost, so check before asking. */
function deviceProblem(): 'insecure' | 'unsupported' | null {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !crypto?.subtle) return 'unsupported';
  return null;
}

export function SelfCertClient() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  const online = useOnline();
  const { data: order, loading, error: loadError, reload } = useApi<FarmerOrder>(id ? `/orders/${id}` : null);
  const [problem, setProblem] = useState<'insecure' | 'unsupported' | null>(null);
  const [retake, setRetake] = useState<ClipKind | null>(null);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { setProblem(deviceProblem()); }, []);
  useEffect(() => { if (order && !weight) setWeight(String(order.dispatchedWeightKg ?? order.quantityKg)); }, [order, weight]);

  const accepted = useCallback(() => { setRetake(null); void reload(); }, [reload]);

  if (!id) return <Notice tone="warn">{t('error.notFound')}</Notice>;
  if (loading) return <ListSkeleton />;
  if (!order) return <div className="space-y-4"><PageTitle back="/orders">{t('selfcert.title')}</PageTitle><ErrorNotice error={loadError} /></div>;

  const backHref = `/orders/detail?id=${order.id}`;
  const head = <PageTitle back={backHref}>{t('selfcert.title')}</PageTitle>;

  if (!order.selfCertRequired) return <div className="space-y-4">{head}<Notice tone="info">{t('selfcert.notRequired')}</Notice><BigLink href={backHref}>{t('selfcert.backToOrder')}</BigLink></div>;
  if (order.selfCert?.submittedAt) {
    return (
      <div className="space-y-4">
        {head}
        <Notice tone="success" title={t('selfcert.doneTitle')}>{t('selfcert.doneBody', { kg: order.selfCert.certifiedWeightKg ?? 0 })}</Notice>
        <BigLink href={`/orders/dispatch?id=${order.id}`} icon={CameraIcon}>{t('next.dispatchPhotosAction')}</BigLink>
      </div>
    );
  }
  if (problem === 'insecure') return <div className="space-y-4">{head}<Notice tone="error" title={t('selfcert.insecureTitle')}>{t('selfcert.insecureBody')}</Notice></div>;
  if (problem === 'unsupported') return <div className="space-y-4">{head}<Notice tone="error" title={t('selfcert.unsupportedTitle')}>{t('selfcert.unsupportedBody')}</Notice></div>;

  const scaleDone = !!order.selfCert?.scaleVideoFileId;
  const vehicleDone = !!order.selfCert?.vehicleVideoFileId;
  // Guided: scale first, then vehicle. A retake takes priority over the next clip.
  const current: ClipKind | null = retake ?? (!scaleDone ? 'SCALE' : !vehicleDone ? 'VEHICLE' : null);
  const funded = order.state === 'INSPECTION_SCHEDULED';
  const kg = Number(weight);
  const weightValid = /^\d+$/.test(weight) && kg >= 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!weightValid || busy || !order) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/self-cert/${order.id}/submit`, { certifiedWeightKg: kg });
      await reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const stepPill = (label: string, done: boolean, active: boolean, Icon: typeof ScaleIcon) => (
    <div className={cn('flex min-h-14 items-center gap-2 rounded-xl border-2 px-2 font-bold', done ? 'border-emerald-800 bg-emerald-50 text-emerald-950' : active ? 'border-slate-900 bg-amber-100 text-slate-950' : 'border-slate-400 text-slate-700')}>
      {done ? <CheckIcon size={24} className="shrink-0" /> : <Icon size={24} className="shrink-0" />}{label}
    </div>
  );

  return (
    <div className="space-y-4">
      {head}
      <p className="text-lg text-slate-800">{t('selfcert.intro')}</p>
      <div className="grid grid-cols-2 gap-2">
        {stepPill(t('selfcert.clipScale'), scaleDone, current === 'SCALE', ScaleIcon)}
        {stepPill(t('selfcert.clipVehicle'), vehicleDone, current === 'VEHICLE', TruckIcon)}
      </div>

      {!online && <Notice tone="error" title={t('selfcert.offlineTitle')}>{t('selfcert.offlineBody')}</Notice>}

      {current && online && <ClipRecorder key={current} orderId={order.id} kind={current} onAccepted={accepted} onCancel={retake ? () => setRetake(null) : undefined} />}

      {!current && (
        <>
          <Notice tone="success" title={t('selfcert.bothDoneTitle')}>{t('selfcert.bothDoneBody')}</Notice>
          {!funded && <Notice tone="wait" title={t('selfcert.notFundedTitle')}>{t('selfcert.notFundedBody')}</Notice>}
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('selfcert.weight')} hint={t('selfcert.weightHint', { kg: order.quantityKg })}>
              <TextInput inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Panel><p className="flex gap-2"><ShieldIcon className="shrink-0" />{t('selfcert.declaration')}</p></Panel>
            <ErrorNotice error={error} />
            <BigButton type="submit" icon={CheckIcon} disabled={!weightValid || busy || !funded}>{busy ? t('common.wait') : t('selfcert.submit')}</BigButton>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="secondary" icon={RefreshIcon} onClick={() => setRetake('SCALE')}>{t('selfcert.clipScale')}</BigButton>
            <BigButton variant="secondary" icon={RefreshIcon} onClick={() => setRetake('VEHICLE')}>{t('selfcert.clipVehicle')}</BigButton>
          </div>
        </>
      )}
    </div>
  );
}
