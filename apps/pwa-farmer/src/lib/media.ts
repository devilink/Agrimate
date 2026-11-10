/** Device helpers: image compression, hashing, GPS. Everything here needs a browser. */

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

/** Shrinks a photo to at most 1280px on its long edge, as JPEG. A phone photo of 4 MB comes out near 200 KB. */
export async function compressImage(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('IMAGE_UNREADABLE'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('IMAGE_UNREADABLE');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!out) throw new Error('IMAGE_UNREADABLE');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Lowercase hex SHA-256, computed on the device. */
export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** crypto.subtle only exists on HTTPS or localhost. api.uploadFile needs it to hash, so uploads depend on it too. */
export const canHash = () => typeof window !== 'undefined' && window.isSecureContext && !!crypto?.subtle;

export type GpsFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export class GpsError extends Error { constructor(readonly reason: GpsFailure) { super(reason); } }

export function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new GpsError('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new GpsError(e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 },
    );
  });
}
