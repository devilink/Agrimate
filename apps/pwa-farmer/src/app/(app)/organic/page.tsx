'use client';
import { formatIST, istDateString } from '@agrimate/shared';
import { useRef, useState } from 'react';
import { CheckIcon, FileIcon } from '@/components/icons';
import { BigButton, ErrorNotice, Field, ListSkeleton, Notice, PageTitle, Panel, Pill, Row, SelectInput, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { canHash, compressImage } from '@/lib/media';
import { CERTIFIERS, certIsUsable, type OrganicCert } from '@/lib/organic';
import { useApi } from '@/lib/use-api';

export default function OrganicPage() {
  const { t, has } = useI18n();
  const { data, loading, reload, error: loadError } = useApi<OrganicCert[]>('/onboarding/organic-certs');
  const [file, setFile] = useState<File | null>(null);
  const [certifier, setCertifier] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const today = istDateString(new Date());
  const expiryPast = !!expiry && expiry <= today;
  const complete = !!file && !!certifier && certNumber.trim().length >= 2 && !!expiry && !expiryPast;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete || !file || busy) return;
    setBusy(true); setError(null); setDone(false);
    try {
      const isImage = file.type.startsWith('image/');
      const data2 = isImage ? await compressImage(file) : file;
      const fileId = await api.uploadFile({ purpose: 'ORGANIC_CERT', data: data2, contentType: isImage ? 'image/jpeg' : file.type || 'application/pdf' });
      // The certificate is valid through the whole of its expiry date, India time.
      await api.post('/onboarding/organic-certs', { fileId, certifier, certNumber: certNumber.trim(), expiresAt: new Date(`${expiry}T23:59:59+05:30`).toISOString() });
      setDone(true);
      setFile(null); setCertifier(''); setCertNumber(''); setExpiry('');
      if (input.current) input.current.value = '';
      await reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageTitle back="/listings">{t('organic.title')}</PageTitle>
      <p className="text-lg text-slate-800">{t('organic.intro')}</p>
      {!canHash() && <Notice tone="error">{t('secure.upload')}</Notice>}
      {done && <Notice tone="success" title={t('organic.sentTitle')}>{t('organic.sentBody')}</Notice>}

      <form onSubmit={submit} className="space-y-5">
        <Field label={t('organic.file')} hint={file ? file.name : t('organic.fileHint')}>
          <input ref={input} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block min-h-14 w-full rounded-xl border-2 border-slate-700 bg-white p-3 text-base file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:font-bold file:text-white" />
        </Field>
        <Field label={t('organic.certifier')}>
          <SelectInput value={certifier} onChange={(e) => setCertifier(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {CERTIFIERS.map((c) => <option key={c} value={c}>{has(`organic.certifier.${c}`) ? t(`organic.certifier.${c}`) : c}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('organic.number')} hint={t('organic.numberHint')}>
          <TextInput autoCapitalize="characters" autoComplete="off" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
        </Field>
        <Field label={t('organic.expiry')} error={expiryPast ? t('organic.expiryPast') : null}>
          <TextInput type="date" min={today} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <ErrorNotice error={error} />
        <BigButton type="submit" icon={FileIcon} disabled={!complete || busy || !canHash()}>{busy ? t('common.uploading') : t('organic.submit')}</BigButton>
      </form>

      <h2 className="pt-2 text-lg font-bold">{t('organic.mine')}</h2>
      <ErrorNotice error={!data ? loadError : null} />
      {loading ? <ListSkeleton rows={1} /> : data?.length === 0 ? <Notice tone="info">{t('organic.none')}</Notice> : data?.map((c) => {
        const expired = new Date(c.expiresAt) <= new Date();
        return (
          <Panel key={c.id}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-bold">{certIsUsable(c) && <CheckIcon className="text-emerald-800" />}{has(`organic.certifier.${c.certifier}`) ? t(`organic.certifier.${c.certifier}`) : c.certifier}</p>
              <Pill tone={expired || c.status === 'REJECTED' ? 'red' : c.status === 'VERIFIED' ? 'green' : 'amber'}>{t(`organic.state.${expired ? 'EXPIRED' : c.status}`)}</Pill>
            </div>
            <Row label={t('organic.number')}>{c.certNumber}</Row>
            <Row label={t('organic.expiry')}>{formatIST(c.expiresAt)}</Row>
          </Panel>
        );
      })}
    </div>
  );
}
