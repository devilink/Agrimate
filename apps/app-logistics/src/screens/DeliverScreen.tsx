/**
 * Proof of delivery. Nothing here needs a connection: the photo, GPS fix, weight and receiver proof go into the
 * persistent queue, and the driver can leave. If the API later refuses something, such as a mistyped delivery code,
 * the item stops in the queue and this screen reopens filled in, without sending the photo again.
 */
import type { MyTrip } from '@agrimate/api-client';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useCapture } from '../lib/camera';
import { keptFileUri, type LocalFile } from '../lib/files';
import { errorMessage, fileSize, kg } from '../lib/format';
import { currentFix, type Fix } from '../lib/location';
import { useNav } from '../lib/nav';
import { QUEUE_FOLDER, queue, queueUpload, useQueueItems } from '../lib/queue';
import type { QueueUpload } from '../lib/queueEngine';
import { Body, Button, colors, Field, Heading, Muted, Notice, RadioGroup, Screen, styles } from '../lib/ui';

type Proof = 'otp' | 'signature';

const asFile = (u: QueueUpload): LocalFile => ({ uri: keptFileUri(u.localName, QUEUE_FOLDER), contentType: u.contentType, sizeBytes: u.sizeBytes, sha256: u.sha256 });

export function DeliverScreen({ params }: { params: { trip: MyTrip } }) {
  const { trip } = params;
  const nav = useNav();
  const capture = useCapture();
  const previous = useQueueItems().find((i) => i.kind === 'DELIVER' && i.tripId === trip.id);

  const [photo, setPhoto] = useState<LocalFile | null>(previous?.uploads.pod ? asFile(previous.uploads.pod) : null);
  const [signature, setSignature] = useState<LocalFile | null>(previous?.uploads.signature ? asFile(previous.uploads.signature) : null);
  const [fix, setFix] = useState<Fix | null>(previous ? { lat: previous.body.lat as number, lng: previous.body.lng as number, accuracyMetres: null } : null);
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [weight, setWeight] = useState(previous ? String(previous.body.receivedWeightKg) : '');
  const [proof, setProof] = useState<Proof>(previous?.uploads.signature ? 'signature' : 'otp');
  const [otp, setOtp] = useState((previous?.body.receiverOtp as string | undefined) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setFixing(true); setFixError(null);
    try { setFix(await currentFix()); } catch (e) { setFixError(errorMessage(e)); } finally { setFixing(false); }
  };
  // GPS works with no signal, so the fix is taken on arrival without waiting to be asked.
  useEffect(() => {
    if (!previous) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weightOk = /^\d+$/.test(weight.trim());
  const proofOk = proof === 'otp' ? /^\d{6}$/.test(otp) : !!signature;
  const missing: string[] = [];
  if (!photo) missing.push('Take a photo of the delivered load.');
  if (!fix) missing.push('Get a GPS position.');
  if (!weightOk) missing.push('Enter the received weight in whole kg.');
  if (!proofOk) missing.push(proof === 'otp' ? 'Enter the 6-digit code from the receiver.' : 'Photograph the receiver\'s signature.');

  /** A file the queue already holds is passed by name, so that it is not copied again. */
  const toUpload = (file: LocalFile, purpose: string, slot: string): QueueUpload => {
    const held = previous?.uploads[slot];
    return held && held.sha256 === file.sha256 ? held : queueUpload(file, purpose, trip.orderId);
  };

  const submit = async () => {
    if (!photo || !fix) return;
    setBusy(true); setError(null);
    try {
      const useSignature = proof === 'signature' && signature;
      await queue.add({
        kind: 'DELIVER', tripId: trip.id, label: `Proof of delivery for ${trip.orderCode}`, path: `/trips/${trip.id}/deliver`,
        body: { lat: fix.lat, lng: fix.lng, receivedWeightKg: Number(weight), ...(proof === 'otp' ? { receiverOtp: otp } : {}) },
        uploads: { pod: toUpload(photo, 'POD_PHOTO', 'pod'), ...(useSignature ? { signature: toUpload(signature, 'POD_SIGNATURE', 'signature') } : {}) },
        fileFields: { podPhotoFileId: 'pod', ...(useSignature ? { signatureFileId: 'signature' } : {}) },
        doneWhenTripStatus: ['DELIVERED'],
      });
      nav.pop();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Screen title="Mark as Delivered">
      <Body>Order {trip.orderCode}: {kg(trip.quantityKg)} of {trip.commodity}, drop PIN {trip.dropPin}.</Body>
      <Notice>This works without a connection. Your proof of delivery is saved on the phone first and sent when there is a signal.</Notice>
      {previous?.attention ? <Notice tone="error">Not accepted: {previous.attention.message}. Fix it below and save again.</Notice> : null}

      <Heading>1. Photo of the delivered load</Heading>
      {photo ? <Image source={{ uri: photo.uri }} accessibilityLabel="Delivery photo" style={{ width: '100%', height: 180, borderRadius: 8, backgroundColor: colors.skeleton }} resizeMode="cover" /> : null}
      {photo ? <Muted>{fileSize(photo.sizeBytes)} after compression.</Muted> : null}
      <Button kind="secondary" label={photo ? 'Retake photo' : 'Take photo'} onPress={async () => { const f = await capture('Delivered load'); if (f) setPhoto(f); }} />

      <Heading>2. Your location</Heading>
      {fix ? <Notice tone="ok">Location recorded{fix.accuracyMetres !== null ? `, within about ${fix.accuracyMetres} m` : ''}.</Notice> : null}
      {fixing ? <Text style={styles.muted}>Getting your GPS position...</Text> : null}
      {fixError ? <Notice tone="error">{fixError}</Notice> : null}
      <Button kind="secondary" label={fix ? 'Get position again' : 'Get GPS position'} busy={fixing} onPress={locate} />

      <Heading>3. Received weight</Heading>
      <Field label="Weight received" value={weight} onChangeText={(t) => setWeight(t.replace(/\D/g, ''))} keyboardType="number-pad" trailing="kg" hint="Whole kg, as weighed by the receiver." />

      <Heading>4. Receiver proof</Heading>
      <RadioGroup value={proof} onChange={setProof} options={[
        { value: 'otp', label: 'Delivery code', note: 'The buyer received a 6-digit code by SMS at pickup.' },
        { value: 'signature', label: 'Signature on paper', note: 'If the receiver has no code, photograph their signature.' },
      ]} />
      {proof === 'otp' ? (
        <Field label="6-digit delivery code" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
      ) : (
        <View style={{ gap: 8 }}>
          {signature ? <Notice tone="ok">Signature photo ready ({fileSize(signature.sizeBytes)}).</Notice> : null}
          <Button kind="secondary" label={signature ? 'Retake signature photo' : 'Photograph signature'} onPress={async () => { const f = await capture('Receiver signature'); if (f) setSignature(f); }} />
        </View>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {missing.length ? <Notice>{`Before you can save:\n${missing.map((m) => `• ${m}`).join('\n')}`}</Notice> : null}
      <Button label="Save proof of delivery" busy={busy} disabled={missing.length > 0} onPress={submit} />
    </Screen>
  );
}
