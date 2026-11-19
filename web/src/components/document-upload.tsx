'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';
import { finishUpload, startUpload } from '@/app/actions/orders';
import { DOC_KIND_LABEL } from '@/lib/orders';
import { buttonClass, Field, FormMessage, Input, Select } from '@/components/ui';
import { IconUpload, Spinner } from '@/components/icons';

/** Uploads straight from the phone/browser to private storage, using a one-time URL the server issues. */
export function DocumentUpload({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('photo');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg({ error: 'Choose a file first.' }); return; }
    setBusy(true);
    setMsg({});
    try {
      const started = await startUpload({ orderId, kind, fileName: file.name, contentType: file.type, size: file.size });
      if ('error' in started) { setMsg({ error: started.error }); return; }
      const { error } = await browserClient().storage.from('documents').uploadToSignedUrl(started.path, started.token, file, {
        contentType: file.type,
      });
      if (error) { setMsg({ error: 'Upload failed. Check your connection and try again.' }); return; }
      const done = await finishUpload({ orderId, kind, fileName: file.name, path: started.path });
      setMsg(done ?? {});
      if (done?.ok && fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="grid gap-3 sm:grid-cols-[12rem_1fr]">
      <Field label="Type">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(DOC_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="File" hint="Photo or PDF, up to 10 MB. On a phone you can take a photo directly.">
        <Input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <div><button disabled={busy} className={buttonClass('secondary')}>{busy ? <Spinner /> : <IconUpload />}{busy ? 'Uploading…' : 'Upload document'}</button></div>
        <FormMessage error={msg.error} ok={msg.ok} />
      </div>
    </form>
  );
}
