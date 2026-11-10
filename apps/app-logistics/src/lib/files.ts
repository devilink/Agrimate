/**
 * Local file handling and the upload flow.
 *
 * api.uploadFile from the shared client is deliberately not used here: it needs the whole file as an ArrayBuffer and
 * sends it through fetch. Using File.upload streams from disk natively, which is kinder to low-memory phones and
 * slow links. The flow matches the client's: POST /files/upload-url, PUT to the signed URL, POST /files/:id/complete.
 */
import { ApiError } from '@agrimate/api-client';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { API_URL, api } from './api';

export interface PhotoOptions { maxSide: number; quality: number }
export interface LocalFile { uri: string; contentType: string; sizeBytes: number; sha256: string }

const UPLOAD_TIMEOUT_MS = 120_000;

const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

/** expo-crypto hashes the raw bytes, which is what the server re-hashes after upload. digestStringAsync would hash a string form instead. */
export async function describeFile(uri: string, contentType: string): Promise<LocalFile> {
  const bytes = await new File(uri).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return { uri, contentType, sizeBytes: bytes.byteLength, sha256: toHex(digest) };
}

export async function compressPhoto(uri: string, width: number, height: number, options: PhotoOptions): Promise<LocalFile> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > options.maxSide || !width || !height) context.resize(width >= height ? { width: options.maxSide } : { height: options.maxSide });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: options.quality });
  image.release();
  context.release();
  return describeFile(saved.uri, 'image/jpeg');
}

/** Pick a PDF or an image from the phone. Images are compressed like camera photos. Returns null if the person backs out. */
export async function pickDocument(options: PhotoOptions): Promise<LocalFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  const type = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  // Dimensions are unknown here, so 0 x 0 forces a resize to the maximum side.
  if (type.startsWith('image/')) return compressPhoto(asset.uri, 0, 0, options);
  return describeFile(asset.uri, type);
}

/** Copies a file somewhere the OS will not clean up, since cache files can vanish while they wait to upload. */
export function keepFile(uri: string, folder: string): string {
  const dir = new Directory(Paths.document, folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${uri.toLowerCase().endsWith('.pdf') ? '.pdf' : '.jpg'}`;
  new File(uri).copy(new File(dir, name));
  return name;
}
export const keptFileUri = (name: string, folder: string) => new File(new Directory(Paths.document, folder), name).uri;
export const keptFileExists = (name: string, folder: string) => new File(new Directory(Paths.document, folder), name).exists;
export function deleteKeptFile(name: string, folder: string) {
  const f = new File(new Directory(Paths.document, folder), name);
  if (f.exists) f.delete();
}

export const hostOf = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url;

/** PUT the bytes to the signed URL. A timeout aborts the request so that a stalled link fails instead of hanging. */
export async function putToSignedUrl(uploadUrl: string, file: Pick<LocalFile, 'uri' | 'contentType'>, onProgress?: (fraction: number) => void) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await new File(file.uri).upload(uploadUrl, {
      httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers: { 'Content-Type': file.contentType }, signal: controller.signal,
      onProgress: onProgress ? ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0) : undefined,
    });
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload to storage failed', null);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // The signed URL's host comes from the API's S3_PUBLIC_ENDPOINT. Pointing at localhost is the classic device setup mistake.
    const host = hostOf(uploadUrl);
    if (/^(localhost|127\.0\.0\.1)/.test(host) && hostOf(API_URL) !== host) throw new Error(`Storage at ${host} cannot be reached from this phone. Set S3_PUBLIC_ENDPOINT on the API to this computer's LAN address.`);
    const failure = new Error('Upload stopped before it finished.');
    failure.name = 'TypeError'; // Classed as a network failure, so that callers offer a retry.
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

/** The whole three-step upload. Returns the file id. */
export async function uploadLocalFile(i: { purpose: string; file: LocalFile; orderId?: string; onProgress?: (fraction: number) => void }): Promise<string> {
  const init = await api.post<{ fileId: string; uploadUrl: string }>('/files/upload-url', { purpose: i.purpose, sha256: i.file.sha256, contentType: i.file.contentType, sizeBytes: i.file.sizeBytes, ...(i.orderId ? { orderId: i.orderId } : {}) });
  await putToSignedUrl(init.uploadUrl, i.file, i.onProgress);
  await api.post(`/files/${init.fileId}/complete`);
  return init.fileId;
}
