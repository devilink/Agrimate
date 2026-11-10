'use client';
/** Browser stand-ins for what the field apps do with the camera and GPS: file uploads through the signed-URL flow, and a one-shot location fix. */
import { useId, useRef, useState } from 'react';
import { Button } from '@agrimate/ui';
import { api, errorMessage } from '@/lib/api';

export interface UploadedFile { id: string; name: string }

export function FilePick({ label, hint, purpose, orderId, accept = 'image/*', files, onChange, disabled, single }: {
  label: string; hint?: string; purpose: 'INSPECTION_PHOTO' | 'EWAY_BILL' | 'POD_PHOTO' | 'POD_SIGNATURE'; orderId?: string; accept?: string;
  files: UploadedFile[]; onChange: (f: UploadedFile[]) => void; disabled?: boolean; single?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const picked = single ? [list[0]!] : [...list];
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
      <input id={id} ref={input} type="file" accept={accept} multiple={!single} disabled={disabled || uploading > 0} onChange={(e) => void pick(e.target.files)}
        className="block w-full text-sm text-slate-700 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-50 disabled:opacity-60" />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {uploading > 0 && <p role="status" className="text-xs text-slate-600">Uploading and verifying {uploading === 1 ? 'file' : `${uploading} files`}…</p>}
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

/** One high-accuracy fix. The API checks the distance to the pickup point, so this only reports where the device is. */
export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('This browser cannot share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission was refused. Allow location for this site and try again.' : 'Could not get your location. Move to open sky or check location services, then try again.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export const kg = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('en-IN')} kg`);

/** Stat tile shared by the staff desks and the admin boards. */
export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'emerald' | 'amber' | 'red' | 'sky' | 'slate' }) {
  const t = { emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900', sky: 'border-sky-200 bg-sky-50 text-sky-900', slate: 'border-slate-200 bg-white text-slate-900' }[tone ?? 'slate'];
  return (
    <div className={`rounded-lg border p-3 ${t}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
