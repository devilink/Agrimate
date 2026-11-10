'use client';
import type { FarmerOrder } from '@agrimate/api-client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, TruckIcon } from '@/components/icons';
import { useOnline } from '@/components/app-shell';
import { BigButton, ErrorNotice, ListSkeleton, Notice, PageTitle, Panel, ProgressBar } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { canHash, compressImage } from '@/lib/media';
import { useApi } from '@/lib/use-api';

interface LocalPhoto { url: string; bytes: number }

export function DispatchClient() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  const online = useOnline();
  const { data: order, loading, error: loadError, reload } = useApi<FarmerOrder>(id ? `/orders/${id}` : null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [fraction, setFraction] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [leaving, setLeaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  if (!id) return <Notice tone="warn">{t('error.notFound')}</Notice>;
  if (loading) return <ListSkeleton />;
  if (!order) return <div className="space-y-4"><PageTitle back="/orders">{t('dispatch.title')}</PageTitle><ErrorNotice error={loadError} /></div>;

  const count = order.dispatchPhotos.length;
  const canConfirmDeparture = count > 0 && order.logisticsMode === 'EXTERNAL' && ['INSPECTED', 'SELF_CERTIFIED'].includes(order.state);

  async function onFile(file: File | undefined) {
    if (!file || !order) return;
    setError(null); setFraction(0);
    try {
      setProgress(t('dispatch.compressing'));
      const small = await compressImage(file);
      setFraction(0.3);
      setProgress(t('common.uploading'));
      const fileId = await api.uploadFile({ purpose: 'DISPATCH_PHOTO', data: small, contentType: 'image/jpeg', orderId: order.id, onProgress: (f) => setFraction(0.3 + f * 0.6) });
      await api.post(`/orders/${order.id}/dispatch-photos`, { fileId });
      setFraction(1);
      const url = URL.createObjectURL(small);
      urls.current.push(url);
      setPhotos((p) => [...p, { url, bytes: small.size }]);
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  async function confirmDeparture() {
    if (!order) return;
    setLeaving(true); setError(null);
    try { await api.post(`/orders/${order.id}/depart`); await reload(); } catch (e) { setError(e); } finally { setLeaving(false); }
  }

  return (
    <div className="space-y-4">
      <PageTitle back={`/orders/detail?id=${order.id}`}>{t('dispatch.title')}</PageTitle>
      <p className="text-lg text-slate-800">{t('dispatch.intro')}</p>
      {!canHash() && <Notice tone="error">{t('secure.upload')}</Notice>}
      {!online && <Notice tone="warn">{t('dispatch.offline')}</Notice>}
      <Notice tone={count ? 'success' : 'info'}>{t('dispatch.count', { n: count })}</Notice>
      {progress && <ProgressBar fraction={fraction} label={progress} />}
      <ErrorNotice error={error} />

      {/* A label styled as the primary button: this is what opens the rear camera. */}
      <label className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-xl px-4 text-lg font-bold ${count ? 'border-2 border-slate-800 bg-white text-slate-950' : 'bg-emerald-800 text-white'} ${progress || !online || !canHash() ? 'pointer-events-none opacity-60' : ''}`}>
        <CameraIcon />{count ? t('dispatch.another') : t('dispatch.take')}
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" disabled={!!progress || !online || !canHash()} onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>

      {photos.length > 0 && (
        <Panel>
          <div className="grid grid-cols-2 gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos.map((p) => <figure key={p.url}><img src={p.url} alt={t('dispatch.photoAlt')} className="aspect-square w-full rounded-lg object-cover" /><figcaption className="text-slate-800">{t('dispatch.size', { kb: Math.round(p.bytes / 1024) })}</figcaption></figure>)}
          </div>
        </Panel>
      )}

      {canConfirmDeparture && (
        <Panel className="space-y-3">
          <p className="font-bold">{t('dispatch.departTitle')}</p>
          <p>{t('dispatch.departBody')}</p>
          <BigButton icon={TruckIcon} disabled={leaving} onClick={confirmDeparture}>{leaving ? t('common.wait') : t('next.confirmDepartedAction')}</BigButton>
        </Panel>
      )}
      {order.state === 'IN_TRANSIT' && <Notice tone="success">{t('next.inTransit')}</Notice>}
    </div>
  );
}
