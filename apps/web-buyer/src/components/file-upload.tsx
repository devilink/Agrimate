'use client';
/** Uploads through the signed-URL + SHA-256 flow as soon as files are picked, then hands the file ids to the parent form. */
import { Button } from '@agrimate/ui';
import { useId, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export interface UploadedFile { id: string; name: string }

export function FileUpload({ label, hint, purpose, orderId, accept, files, onChange, disabled, single }: {
  label: string; hint?: string; purpose: 'DISPUTE_EVIDENCE' | 'SPOT_TEST_REPORT' | 'POD_PHOTO'; orderId: string; accept?: string;
  files: UploadedFile[]; onChange: (f: UploadedFile[]) => void; disabled?: boolean; single?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const picked = [...list];
    setUploading(picked.length);
    const done: UploadedFile[] = [];
    try {
      for (const file of picked) {
        const fileId = await api.uploadFile({ purpose, data: file, contentType: file.type || 'application/octet-stream', orderId });
        done.push({ id: fileId, name: file.name });
        setUploading((n) => n - 1);
      }
    } catch (e) {
      setError(`${picked[done.length]?.name ?? 'File'}: ${errorMessage(e)}`);
    } finally {
      setUploading(0);
      if (input.current) input.current.value = '';
      if (done.length) onChange(single ? done.slice(-1) : [...files, ...done]);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        id={id}
        ref={input}
        type="file"
        accept={accept}
        multiple={!single}
        disabled={disabled || uploading > 0}
        onChange={(e) => void pick(e.target.files)}
        className="block w-full text-sm text-slate-700 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-50 disabled:opacity-60"
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {uploading > 0 && <p role="status" className="text-xs text-slate-600">Uploading and verifying {uploading === 1 ? 'file' : `${uploading} files`}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {files.length > 0 && (
        <ul className="space-y-1 pt-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-xs text-slate-800">
              <span className="min-w-0 truncate">{f.name}</span>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled} onClick={() => onChange(files.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
