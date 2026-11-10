/** Degree submission. Also reached from Profile, to send a corrected certificate after a rejection. */
import { ApiError } from '@agrimate/api-client';
import { ALLOWED_DEGREES, IFSC_RE, isValidPin, type DegreeType } from '@agrimate/shared';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCapture } from '../lib/camera';
import { PHOTO_OPTIONS } from '../lib/config';
import { pickDocument, uploadLocalFile, type LocalFile } from '../lib/files';
import { errorMessage, fileSize } from '../lib/format';
import { currentFix } from '../lib/location';
import { Body, Button, Field, Heading, Muted, Notice, Screen, Select, styles } from '../lib/ui';

export const DEGREES: { value: DegreeType; label: string }[] = [
  { value: 'BSC_AGRICULTURE', label: 'B.Sc Agriculture' },
  { value: 'MSC_AGRICULTURE', label: 'M.Sc Agriculture' },
  { value: 'BSC_ANIMAL_HUSBANDRY', label: 'B.Sc Animal Husbandry' },
  { value: 'MSC_ANIMAL_HUSBANDRY', label: 'M.Sc Animal Husbandry' },
  { value: 'VETERINARY', label: 'Veterinary degree' },
];
export const degreeLabel = (d: string | null | undefined) => DEGREES.find((x) => x.value === d)?.label ?? '-';

export function OnboardingForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { refreshMe, signOut, me } = useAuth();
  const capture = useCapture();
  const [degree, setDegree] = useState<DegreeType | null>((me?.inspector?.degreeType as DegreeType | null) ?? null);
  const [file, setFile] = useState<LocalFile | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [pin, setPin] = useState(me?.inspector?.pin ?? '');
  const [radius, setRadius] = useState(String(me?.inspector?.serviceRadiusKm ?? 50));
  const [bank, setBank] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [needsLocation, setNeedsLocation] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ineligible = !!degree && !ALLOWED_DEGREES.includes(degree);
  const radiusKm = Number(radius);
  const radiusOk = Number.isInteger(radiusKm) && radiusKm >= 1 && radiusKm <= 500;
  const ifscOk = !ifsc || IFSC_RE.test(ifsc);
  const bankOk = !bank === !ifsc;
  const ready = !!degree && !ineligible && !!file && isValidPin(pin) && radiusOk && ifscOk && bankOk;

  const choose = (f: LocalFile | null) => { if (f) { setFile(f); setFileId(null); setError(null); } };

  const submit = async () => {
    if (!degree || !file) return;
    setError(null);
    try {
      // Kept between attempts, so that a failed submit does not spend data uploading the certificate twice.
      let id = fileId;
      if (!id) {
        setBusy('Uploading certificate...');
        id = await uploadLocalFile({ purpose: 'DEGREE_CERT', file });
        setFileId(id);
      }
      setBusy('Sending your details...');
      const body: Record<string, unknown> = { degreeType: degree, degreeFileId: id, pin, serviceRadiusKm: radiusKm };
      if (bank && ifsc) { body.bankAccount = bank; body.ifsc = ifsc; }
      if (needsLocation) { const fix = await currentFix(); body.lat = fix.lat; body.lng = fix.lng; }
      await api.post('/onboarding/inspector/degree', body);
      await refreshMe();
      onSubmitted?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PIN_UNKNOWN') {
        setNeedsLocation(true);
        setError('We do not have this PIN on file yet. Stand at your base location and tap the button again, and we will use your GPS position instead.');
      } else {
        setError(errorMessage(e));
      }
    } finally { setBusy(null); }
  };

  return (
    <>
      <Body>Inspectors grade produce at the farm. An admin reviews your degree before jobs can reach you.</Body>
      <Select label="Your degree" value={degree} options={DEGREES} onChange={(d) => { setDegree(d); setError(null); }} />
      {ineligible ? <Notice tone="error">Only B.Sc or M.Sc Agriculture degrees are accepted. Animal Husbandry and Veterinary degrees cannot be used to become an Agrimate inspector.</Notice> : null}
      {ineligible ? null : (
        <>
          <Heading>Degree certificate</Heading>
          {file
            ? <Notice tone="ok">Certificate ready to send ({fileSize(file.sizeBytes)}).</Notice>
            : <Muted>Take a clear photo of the certificate, or choose a PDF or image from your phone.</Muted>}
          <View style={{ gap: 8 }}>
            <Button kind="secondary" label={file ? 'Retake photo' : 'Take photo'} onPress={async () => choose(await capture('Degree certificate'))} />
            <Button kind="secondary" label="Choose a file" onPress={async () => { try { choose(await pickDocument(PHOTO_OPTIONS)); } catch (e) { setError(errorMessage(e)); } }} />
          </View>
          <Field label="PIN code of your base" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} error={pin.length === 6 && !isValidPin(pin) ? 'That is not a valid PIN code.' : null} />
          <Field label="How far can you travel?" value={radius} onChangeText={(t) => setRadius(t.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" trailing="km" hint="Between 1 and 500 km." error={radius && !radiusOk ? 'Enter a distance between 1 and 500 km.' : null} />
          <Heading>Bank details for payouts (optional)</Heading>
          <Field label="Account number" value={bank} onChangeText={setBank} keyboardType="number-pad" />
          <Field label="IFSC" value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" maxLength={11} error={!ifscOk && ifsc.length === 11 ? 'That IFSC does not look right.' : !bankOk ? 'Enter both the account number and the IFSC, or leave both empty.' : null} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          {busy ? <Text style={styles.muted}>{busy}</Text> : null}
          <Button label={needsLocation ? 'Send using my GPS position' : 'Send for approval'} busy={!!busy} disabled={!ready} onPress={submit} />
          {!ready && !busy ? <Muted>To continue, choose your degree, add the certificate and enter a valid PIN code.</Muted> : null}
        </>
      )}
      {!onSubmitted ? <Button kind="secondary" label="Sign out" onPress={signOut} /> : null}
    </>
  );
}

export function OnboardingScreen() {
  return <Screen title="Become an inspector" back={false}><OnboardingForm /></Screen>;
}
