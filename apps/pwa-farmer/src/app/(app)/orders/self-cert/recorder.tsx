'use client';
/**
 * In-app evidence recorder. Capture is getUserMedia + MediaRecorder only. This file, and this whole flow, must never gain
 * a file input or any other path to the gallery: the buyer relies on these clips being recorded live at the farm.
 *
 * Steps for one clip:
 *   1. Check GPS permission before recording, so that nobody records only to be refused afterwards.
 *   2. POST /self-cert/:id/session on "Start": returns a single-use token and the server's clock.
 *   3. Record. 4. Read GPS. 5. Hash on the device. 6. Upload in parts. 7. POST /self-cert/:id/clips.
 * Steps 4 to 7 keep their results, so that a dropped connection repeats only what failed and never the recording.
 */
import { ApiError, type CaptureSession } from '@agrimate/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, LocationIcon, RefreshIcon, ScaleIcon, StopIcon, TruckIcon, VideoIcon } from '@/components/icons';
import { BigButton, ErrorNotice, Notice, Panel, ProgressBar } from '@/components/ui';
import { api } from '@/lib/api';
import { isNetworkError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { GpsError, getPosition, sha256Hex } from '@/lib/media';

export type ClipKind = 'SCALE' | 'VEHICLE';
const MIN_SECONDS = 5;
const MAX_SECONDS = 60;
const VIDEO_BITRATE = 1_000_000; // About 7.5 MB a minute: readable evidence that can still upload on a weak connection.
const CANDIDATE_TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

type Phase = 'ready' | 'checkingGps' | 'opening' | 'preview' | 'starting' | 'recording' | 'processing' | 'accepted' | 'failed';
type Stage = 'locating' | 'hashing' | 'uploading' | 'saving';
type Failure = 'gpsDenied' | 'gpsFailed' | 'cameraDenied' | 'cameraMissing' | 'cameraBusy' | 'interrupted' | 'empty';

/** What a finished recording has gathered so far. Survives failures so that "try again" resumes from the gap. */
interface Take {
  token: string;
  offsetMs: number;
  startedDeviceMs: number;
  durationSec: number;
  blob: Blob;
  contentType: string;
  position?: { lat: number; lng: number };
  sha256?: string;
  fileId?: string;
}

/** These refusals are about the recording itself (place, time, session), so it has to be recorded again. */
const NEEDS_RETAKE = ['OUTSIDE_RADIUS', 'TIMESTAMP_OUT_OF_WINDOW', 'CAPTURE_TOKEN_INVALID', 'CAPTURE_TOKEN_REQUIRED', 'NOT_IN_APP_CAPTURE', 'HASH_MISMATCH'];

export function ClipRecorder({ orderId, kind, onAccepted, onCancel }: { orderId: string; kind: ClipKind; onAccepted: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('ready');
  const [stage, setStage] = useState<Stage>('locating');
  const [uploadFraction, setUploadFraction] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [canResume, setCanResume] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const take = useRef<Take | null>(null);
  const interrupted = useRef(false);

  const releaseCamera = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach((tr) => { tr.onended = null; tr.stop(); });
    stream.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);

  // Leaving the screen must always switch the camera off.
  useEffect(() => () => {
    interrupted.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    releaseCamera();
  }, [releaseCamera]);

  const fail = useCallback((f: Failure) => { releaseCamera(); setFailure(f); setApiError(null); setCanResume(false); setPhase('failed'); }, [releaseCamera]);

  async function openCamera() {
    setFailure(null); setApiError(null); setCanResume(false); take.current = null;
    setPhase('checkingGps');
    try {
      await getPosition();
    } catch (e) {
      fail(e instanceof GpsError && e.reason === 'denied' ? 'gpsDenied' : 'gpsFailed');
      return;
    }
    setPhase('opening');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'cameraDenied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'cameraMissing' : 'cameraBusy');
      return;
    }
    setPhase('preview');
  }

  // The <video> only exists once the phase has changed, so the stream is attached afterwards.
  useEffect(() => {
    if ((phase === 'preview' || phase === 'starting' || phase === 'recording') && video.current && stream.current && video.current.srcObject !== stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => undefined);
    }
  }, [phase]);

  async function startRecording() {
    const live = stream.current;
    if (!live) return;
    setPhase('starting');
    let session: CaptureSession;
    let offsetMs: number;
    try {
      // The server's clock is what counts. Assume it read the time half way through the round trip.
      const before = Date.now();
      session = await api.post<CaptureSession>(`/self-cert/${orderId}/session`, { kind });
      const after = Date.now();
      offsetMs = new Date(session.serverTime).getTime() - (before + after) / 2;
    } catch (e) {
      setApiError(e); setFailure(null); setCanResume(false);
      releaseCamera();
      setPhase('failed');
      return;
    }

    const mimeType = CANDIDATE_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(live, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITRATE });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    interrupted.current = false;
    live.getVideoTracks().forEach((tr) => {
      // The camera was taken away mid-recording: another app, or the phone locked.
      tr.onended = () => { interrupted.current = true; if (rec.state === 'recording') rec.stop(); };
    });

    const startedDeviceMs = Date.now();
    rec.onstop = () => {
      const durationSec = Math.max(1, Math.round((Date.now() - startedDeviceMs) / 1000));
      const contentType = (rec.mimeType || mimeType || 'video/webm').split(';')[0]!;
      const blob = new Blob(chunks, { type: contentType });
      releaseCamera();
      if (interrupted.current) { fail('interrupted'); return; }
      if (!blob.size) { fail('empty'); return; }
      take.current = { token: session.captureToken, offsetMs, startedDeviceMs, durationSec, blob, contentType };
      void processTake();
    };
    rec.onerror = () => { interrupted.current = true; if (rec.state === 'recording') rec.stop(); };
    recorder.current = rec;
    rec.start(1000);
    void navigator.wakeLock?.request('screen').then((w) => { wakeLock.current = w; }).catch(() => undefined);

    setElapsed(0);
    setPhase('recording');
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedDeviceMs) / 1000);
      setElapsed(s);
      if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop();
    }, 250);
  }

  const processTake = useCallback(async () => {
    const c = take.current;
    if (!c) return;
    setPhase('processing'); setFailure(null); setApiError(null); setCanResume(false);
    try {
      if (!c.position) {
        setStage('locating');
        try {
          const p = await getPosition();
          c.position = { lat: p.lat, lng: p.lng };
        } catch (e) {
          setFailure(e instanceof GpsError && e.reason === 'denied' ? 'gpsDenied' : 'gpsFailed');
          setCanResume(true);
          setPhase('failed');
          return;
        }
      }
      if (!c.sha256) {
        setStage('hashing');
        c.sha256 = await sha256Hex(c.blob);
      }
      if (!c.fileId) {
        setStage('uploading');
        setUploadFraction(0);
        c.fileId = await api.uploadMultipart({ purpose: 'SELF_CERT_VIDEO', data: c.blob, contentType: c.contentType, sha256: c.sha256, orderId, captureToken: c.token, onProgress: setUploadFraction });
      }
      setStage('saving');
      await api.post(`/self-cert/${orderId}/clips`, {
        captureToken: c.token,
        fileId: c.fileId,
        lat: c.position.lat,
        lng: c.position.lng,
        capturedAt: new Date(Math.round(c.startedDeviceMs + c.offsetMs)).toISOString(),
        durationSec: c.durationSec,
        source: 'IN_APP_CAMERA',
      });
      take.current = null;
      setPhase('accepted');
      onAccepted();
    } catch (e) {
      setApiError(e);
      const retake = e instanceof ApiError && !!e.code && NEEDS_RETAKE.includes(e.code);
      setCanResume(!retake && (isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.code === 'UPLOAD_FAILED'))));
      setPhase('failed');
    }
  }, [onAccepted, orderId]);

  const heading = kind === 'SCALE' ? t('selfcert.scaleTitle') : t('selfcert.vehicleTitle');
  const steps = kind === 'SCALE' ? ['selfcert.scaleStep1', 'selfcert.scaleStep2', 'selfcert.scaleStep3'] : ['selfcert.vehicleStep1', 'selfcert.vehicleStep2', 'selfcert.vehicleStep3'];
  const Icon = kind === 'SCALE' ? ScaleIcon : TruckIcon;
  const showVideo = phase === 'preview' || phase === 'starting' || phase === 'recording';

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="mb-2 flex items-center gap-2 text-xl font-bold"><Icon size={32} className="shrink-0" />{heading}</h2>
        <ol className="list-decimal space-y-1 pl-6 text-lg">{steps.map((s) => <li key={s}>{t(s)}</li>)}</ol>
      </Panel>

      {showVideo && (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} muted playsInline autoPlay className="aspect-video w-full object-cover" />
          {phase === 'recording' && (
            <p className="absolute left-2 top-2 flex items-center gap-2 rounded-lg bg-red-700 px-3 py-1 text-lg font-bold tabular-nums text-white"><span className="h-3 w-3 animate-pulse rounded-full bg-white" />{t('selfcert.recording', { s: elapsed, max: MAX_SECONDS })}</p>
          )}
        </div>
      )}

      {(phase === 'ready' || phase === 'checkingGps' || phase === 'opening') && (
        <BigButton icon={VideoIcon} disabled={phase !== 'ready'} onClick={() => void openCamera()}>{phase === 'ready' ? t('selfcert.openCamera') : phase === 'checkingGps' ? t('selfcert.checkingGps') : t('common.wait')}</BigButton>
      )}
      {phase === 'preview' && <BigButton icon={VideoIcon} variant="danger" className="min-h-16" onClick={() => void startRecording()}>{t('selfcert.start')}</BigButton>}
      {phase === 'starting' && <BigButton disabled>{t('common.wait')}</BigButton>}
      {phase === 'recording' && (
        <BigButton icon={StopIcon} className="min-h-16" disabled={elapsed < MIN_SECONDS} onClick={() => recorder.current?.stop()}>
          {elapsed < MIN_SECONDS ? t('selfcert.keepRecording', { s: MIN_SECONDS - elapsed }) : t('selfcert.stop')}
        </BigButton>
      )}
      {phase === 'processing' && (
        <Panel className="space-y-2">
          {stage === 'locating' && <p className="flex items-center gap-2 font-bold"><LocationIcon />{t('selfcert.stageLocating')}</p>}
          {stage === 'hashing' && <p className="font-bold">{t('selfcert.stageHashing')}</p>}
          {stage === 'uploading' && <ProgressBar fraction={uploadFraction} label={t('selfcert.stageUploading')} />}
          {stage === 'saving' && <p className="font-bold">{t('selfcert.stageSaving')}</p>}
          <p>{t('selfcert.dontClose')}</p>
        </Panel>
      )}
      {phase === 'accepted' && <Notice tone="success" title={t('selfcert.accepted')} />}

      {phase === 'failed' && (
        <div className="space-y-3">
          {failure && <Notice tone="error" title={t(`selfcert.fail.${failure}.title`)}>{t(`selfcert.fail.${failure}.body`)}</Notice>}
          <ErrorNotice error={apiError} />
          {canResume && <BigButton icon={RefreshIcon} onClick={() => void processTake()}>{t('selfcert.resume')}</BigButton>}
          <BigButton icon={VideoIcon} variant={canResume ? 'secondary' : 'primary'} onClick={() => void openCamera()}>{t('selfcert.retake')}</BigButton>
        </div>
      )}
      {onCancel && (phase === 'ready' || phase === 'failed' || phase === 'preview') && <BigButton variant="secondary" icon={CheckIcon} onClick={() => { releaseCamera(); onCancel(); }}>{t('selfcert.keepExisting')}</BigButton>}
    </div>
  );
}
