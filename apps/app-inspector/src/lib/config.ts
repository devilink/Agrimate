import type { PhotoOptions } from './files';

export const APP_ROLE = 'INSPECTOR' as const;
export const APP_TITLE = 'Agrimate Inspector';
export const REQUEST_TIMEOUT_MS = 25_000;
/** Grading evidence: small enough for rural data, sharp enough to read a scale display. */
export const PHOTO_OPTIONS: PhotoOptions = { maxSide: 1600, quality: 0.6 };
