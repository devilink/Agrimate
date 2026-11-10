import type { PhotoOptions } from './files';

export const APP_ROLE = 'LOGISTICS' as const;
export const APP_TITLE = 'Agrimate Logistics';
/** Slow networks need a longer window, but a request must still fail eventually so that the queue can retry it. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Low-bandwidth mode: every photo leaves the phone at 1024 px and JPEG 0.5, usually well under 200 KB. */
export const PHOTO_OPTIONS: PhotoOptions = { maxSide: 1024, quality: 0.5 };
