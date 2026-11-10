import { ApiError, type InspectorJob } from '@agrimate/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useCapture } from '../lib/camera';
import { useCached } from '../lib/data';
import { deleteKeptFile, keepFile, keptFileExists, keptFileUri, uploadLocalFile, type LocalFile } from '../lib/files';
import { errorMessage, istDate, istDateTime, kg, orderStateLabel, statusLabel } from '../lib/format';
import { isValidScale, missingForMark, outOfSpecLabels, readingsPayload, readingState, specText } from '../lib/grading';
import { currentFix, directionsUrl } from '../lib/location';
import { useNav } from '../lib/nav';
import { useNet } from '../lib/net';
import { Body, Button, Card, colors, Field, Heading, Muted, Notice, Row, Screen, styles } from '../lib/ui';

const PHOTO_FOLDER = 'inspection-photos';

/** A photo on the phone. It stays here, and in AsyncStorage, until the API has accepted the inspection. */
interface DraftPhoto { name: string; contentType: string; sizeBytes: number; sha256: string; fileId?: string }
interface Draft { values: Record<string, string>; scale: string; photos: DraftPhoto[] }

const draftKey = (id: string) => `agrimate.draft.${id}`;

function asLocalFile(p: DraftPhoto): LocalFile {
  return { uri: keptFileUri(p.name, PHOTO_FOLDER), contentType: p.contentType, sizeBytes: p.sizeBytes, sha256: p.sha256 };
}

interface OrderContact { farmer?: { name: string; phone: string; phoneUnlocked: boolean } }

export function JobDetailScreen({ params }: { params: { job: InspectorJob } }) {
  const nav = useNav();
  const { online } = useNet();
  const capture = useCapture();
  const [job, setJob] = useState(params.job);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(params.job.readings ?? {}).map(([k, v]) => [k, String(v)])));
  const [scale, setScale] = useState(params.job.scaleWeightKg ? String(params.job.scaleWeightKg) : '');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const draftLoaded = useRef(false);

  // The phone can die mid-inspection, so the form is saved locally as it is typed.
  useEffect(() => {
    AsyncStorage.getItem(draftKey(job.id)).then((raw) => {
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        setValues((v) => ({ ...v, ...d.values }));
        if (d.scale) setScale(d.scale);
        setPhotos(d.photos.filter((p) => keptFileExists(p.name, PHOTO_FOLDER)));
      }
    }).catch(() => undefined).finally(() => { draftLoaded.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (draftLoaded.current) AsyncStorage.setItem(draftKey(job.id), JSON.stringify({ values, scale, photos } satisfies Draft)).catch(() => undefined);
  }, [job.id, values, scale, photos]);

  const contact = useCached<OrderContact>(`order-contact-${job.orderId}`, () => api.get(`/orders/${job.orderId}`));

  const reloadJob = useCallback(async () => {
    const list = await api.get<InspectorJob[]>('/inspector/jobs');
    const fresh = list.find((j) => j.id === job.id);
    if (fresh) setJob(fresh);
    return fresh;
  }, [job.id]);

  const canWork = job.status === 'ASSIGNED' || job.status === 'CHECKED_IN';
  const checkedIn = !!job.checkInAt && job.status === 'CHECKED_IN';
  const spec = job.parameters;
  const photoCount = photos.length + (photos.length ? 0 : job.photoFileIds.length);
  const missing = missingForMark({ checkedIn, spec, values, scale, photoCount, online });
  const outOfSpec = outOfSpecLabels(spec, values);

  const checkIn = async () => {
    setBusy('Getting your GPS position...'); setMessage(null);
    try {
      const fix = await currentFix();
      setBusy('Checking you in...');
      const r = await api.post<{ checkInMetres: number | null; checkInAt: string; status: string }>(`/inspections/${job.id}/check-in`, { lat: fix.lat, lng: fix.lng });
      setJob((j) => ({ ...j, status: r.status, checkInAt: r.checkInAt }));
      setMessage({ tone: 'ok', text: `Checked in, ${r.checkInMetres ?? 0} m from the pickup point.` });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OUTSIDE_RADIUS') {
        const b = e.body as { metres?: number; radius?: number };
        setMessage({ tone: 'error', text: `You are ${b.metres} m from the pickup point. You must be within ${b.radius} m to check in. Use directions to get closer, then try again.` });
      } else setMessage({ tone: 'error', text: errorMessage(e) });
    } finally { setBusy(null); }
  };

  const addPhoto = async () => {
    setMessage(null);
    const shot = await capture('Photo of the produce or scale');
    if (!shot) return;
    try {
      const name = keepFile(shot.uri, PHOTO_FOLDER);
      setPhotos((p) => [...p, { name, contentType: shot.contentType, sizeBytes: shot.sizeBytes, sha256: shot.sha256 }]);
    } catch (e) { setMessage({ tone: 'error', text: errorMessage(e) }); }
  };

  const removePhoto = (name: string) => {
    setPhotos((list) => list.filter((p) => p.name !== name));
    try { deleteKeptFile(name, PHOTO_FOLDER); } catch { /* A leftover file is harmless. */ }
  };

  const clearDraft = (kept: DraftPhoto[]) => {
    AsyncStorage.removeItem(draftKey(job.id)).catch(() => undefined);
    for (const p of kept) { try { deleteKeptFile(p.name, PHOTO_FOLDER); } catch { /* A leftover file is harmless. */ } }
    setPhotos([]);
  };

  const send = async () => {
    setMessage(null);
    try {
      // Upload what is still only on the phone. Each finished id is saved, so a retry never uploads a photo twice.
      const uploaded: DraftPhoto[] = [];
      for (const [i, p] of photos.entries()) {
        setBusy(`Uploading photo ${i + 1} of ${photos.length}...`);
        if (p.fileId) { uploaded.push(p); continue; }
        const fileId = await uploadLocalFile({ purpose: 'INSPECTION_PHOTO', file: asLocalFile(p), orderId: job.orderId });
        const done = { ...p, fileId };
        uploaded.push(done);
        setPhotos((list) => list.map((x) => (x.name === p.name ? done : x)));
      }
      setBusy('Saving the grading form...');
      const photoFileIds = uploaded.length ? uploaded.map((p) => p.fileId as string) : job.photoFileIds;
      await api.post(`/inspections/${job.id}/grading`, { readings: readingsPayload(spec, values), scaleWeightKg: Number(scale), photoFileIds });
      setBusy('Marking as inspected...');
      const r = await api.post<{ result: 'INSPECTED' | 'FAILED_GRADE'; outOfSpec?: string[] }>(`/inspections/${job.id}/mark-inspected`);
      clearDraft(uploaded);
      await reloadJob().catch(() => undefined);
      if (r.result === 'FAILED_GRADE') {
        const labels = (r.outOfSpec ?? []).map((k) => spec.find((p) => p.key === k)?.label ?? k).join(', ');
        setMessage({ tone: 'warn', text: `Failed grade: ${labels} out of spec. The buyer and Agrimate have been told. The buyer may accept the produce anyway, or an admin will decide. You have nothing more to do on this job.` });
      } else {
        setMessage({ tone: 'ok', text: 'Inspection complete. Your fee will be paid when the order settles.' });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // A dropped connection can hide a success: the server finished, but the reply never arrived. Ask before reporting failure.
        const fresh = await reloadJob().catch(() => undefined);
        if (fresh && !['ASSIGNED', 'CHECKED_IN'].includes(fresh.status)) {
          clearDraft(photos);
          setMessage({ tone: 'ok', text: 'This inspection had already reached Agrimate. Nothing more to do.' });
        } else if (e.code === 'GUARD_FAILED') {
          // The buyer has not finished paying. The form is saved on the server, so the inspector can simply try again later.
          setMessage({ tone: 'warn', text: `${e.message}. Your readings and photos are saved. Try again after the buyer has paid.` });
        } else setMessage({ tone: 'error', text: e.message });
      } else setMessage({ tone: 'error', text: errorMessage(e) });
    } finally { setBusy(null); }
  };

  const confirmSend = () => {
    if (!outOfSpec.length) { send(); return; }
    Alert.alert('Out of spec', `${outOfSpec.join(', ')} ${outOfSpec.length > 1 ? 'are' : 'is'} outside the grade limits. Sending this will fail the inspection. Are the readings right?`, [
      { text: 'Check again', style: 'cancel' },
      { text: 'Send anyway', style: 'destructive', onPress: send },
    ]);
  };

  const cancel = () => {
    Alert.alert('Cancel this job?', 'Agrimate will try to give it to another inspector. If nobody can take it, the farmer will self-certify.', [
      { text: 'Keep the job', style: 'cancel' },
      { text: 'Cancel job', style: 'destructive', onPress: async () => {
        setBusy('Cancelling...'); setMessage(null);
        try {
          await api.post(`/inspections/${job.id}/cancel`);
          clearDraft(photos);
          nav.pop();
        } catch (e) { setMessage({ tone: 'error', text: errorMessage(e) }); setBusy(null); }
      } },
    ]);
  };

  const farmer = contact.data?.farmer;
  const notFunded = canWork && job.orderState !== 'INSPECTION_SCHEDULED';

  return (
    <Screen title={`${job.commodity}, ${job.grade}`} onRefresh={() => { reloadJob().catch((e) => setMessage({ tone: 'error', text: errorMessage(e) })); contact.reload(); }} refreshing={false}>
      <Card>
        <Row label="Order" value={job.orderCode} />
        <Row label="Quantity" value={kg(job.quantityKg)} />
        <Row label="Inspection day" value={istDate(job.scheduledFor)} />
        <Row label="Pickup PIN" value={job.pickupPin} />
        <Row label="Job status" value={statusLabel(job.status)} />
        <Row label="Payment" value={orderStateLabel(job.orderState)} />
        {farmer ? <Row label="Farmer" value={farmer.name} /> : null}
        {farmer?.phoneUnlocked ? <Button kind="secondary" label={`Call ${farmer.phone}`} onPress={() => { Linking.openURL(`tel:${farmer.phone}`).catch(() => undefined); }} /> : null}
        <Button kind="secondary" label="Get directions" onPress={() => { Linking.openURL(directionsUrl(job.pickupLat, job.pickupLng)).catch(() => undefined); }} />
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {job.status === 'INSPECTED' ? <Notice tone="ok">This inspection is complete.</Notice> : null}
      {job.status === 'FAILED_GRADE' ? <Notice tone="warn">This job failed the grade. The buyer or an admin decides what happens next.</Notice> : null}

      {canWork ? (
        <>
          {notFunded ? <Notice tone="warn">The buyer has not finished paying. You can do the inspection now, but a passing inspection can only be closed once the order is fully paid.</Notice> : null}

          <Heading>1. Check in</Heading>
          {checkedIn
            ? <Notice tone="ok">Checked in at {istDateTime(job.checkInAt)}.</Notice>
            : <Body>Stand within 500 m of the pickup point and check in. Grading opens after that.</Body>}
          {!checkedIn ? <Button label="Check in with GPS" busy={busy?.includes('GPS') || busy === 'Checking you in...'} disabled={!!busy || !online} onPress={checkIn} /> : null}
          {!online && !checkedIn ? <Muted>Check-in needs an internet connection.</Muted> : null}

          <Heading>2. Grading</Heading>
          {spec.map((p) => {
            const state = readingState(p, values[p.key]);
            return (
              <View key={p.key} style={{ gap: 4 }}>
                <Field label={`${p.label}${p.required ? '' : ' (optional)'}`} value={values[p.key] ?? ''} onChangeText={(t) => setValues((v) => ({ ...v, [p.key]: t }))} keyboardType="decimal-pad" trailing={p.unit} hint={specText(p)} error={state === 'invalid' ? 'Enter a number.' : null} />
                {state === 'out-of-spec' ? <Text style={styles.errorText}>Out of spec. {specText(p)}.</Text> : null}
                {state === 'in-spec' ? <Text style={{ fontSize: 15, color: colors.ok }}>Within spec.</Text> : null}
              </View>
            );
          })}
          <Field label="Weighing-scale reading" value={scale} onChangeText={(t) => setScale(t.replace(/\D/g, ''))} keyboardType="number-pad" trailing="kg" hint={`Whole kg. The order is for ${kg(job.quantityKg)}.`} error={scale && !isValidScale(scale) ? 'Enter a whole number of kg, at least 1.' : null} />

          <Heading>3. Photos</Heading>
          <Muted>Photograph the produce and the scale display.</Muted>
          {photos.map((p, i) => (
            <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Image source={{ uri: keptFileUri(p.name, PHOTO_FOLDER) }} accessibilityLabel={`Photo ${i + 1}`} style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: colors.skeleton }} />
              <Text style={[styles.body, { flex: 1 }]}>Photo {i + 1}{p.fileId ? ', uploaded' : ''}</Text>
              <View style={{ width: 110 }}><Button kind="danger" label="Remove" disabled={!!busy} onPress={() => removePhoto(p.name)} /></View>
            </View>
          ))}
          {!photos.length && job.photoFileIds.length ? <Notice tone="ok">{job.photoFileIds.length} photo(s) already saved for this job. New photos would replace them.</Notice> : null}
          <Button kind="secondary" label="Take a photo" disabled={!!busy} onPress={addPhoto} />

          <Heading>4. Finish</Heading>
          {outOfSpec.length ? <Notice tone="warn">Out of spec: {outOfSpec.join(', ')}. Sending will fail this inspection.</Notice> : null}
          {missing.length ? <Notice>{`Before you can mark this as inspected:\n${missing.map((m) => `• ${m}`).join('\n')}`}</Notice> : null}
          {busy ? <Muted>{busy}</Muted> : null}
          <Button label="Mark as Inspected" busy={!!busy} disabled={missing.length > 0} onPress={confirmSend} />
          <Button kind="danger" label="Cancel job" disabled={!!busy || !online} onPress={cancel} />
        </>
      ) : null}
    </Screen>
  );
}
