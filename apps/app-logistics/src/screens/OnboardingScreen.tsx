/** Partner documents. First-time onboarding, and later replacing documents from the Account tab. */
import { IFSC_RE, isValidGstin } from '@agrimate/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../lib/auth';
import { useCapture } from '../lib/camera';
import { PHOTO_OPTIONS } from '../lib/config';
import { pickDocument, type LocalFile } from '../lib/files';
import { errorMessage, fileSize } from '../lib/format';
import { useNav } from '../lib/nav';
import { queue, queueUpload } from '../lib/queue';
import { Body, Button, Card, Checkbox, Field, Heading, Muted, Notice, RadioGroup, Screen } from '../lib/ui';

type PartnerType = 'INDIVIDUAL' | 'AGENCY';

const DOCS = [
  { slot: 'rc', field: 'rcFileId', purpose: 'RC', label: 'Vehicle RC (registration certificate)' },
  { slot: 'dl', field: 'dlFileId', purpose: 'DRIVING_LICENCE', label: 'Driving licence' },
  { slot: 'fitness', field: 'fitnessFileId', purpose: 'FITNESS_CERT', label: 'Fitness certificate' },
] as const;

export function OnboardingScreen() {
  const { signOut, me } = useAuth();
  const nav = useNav();
  const capture = useCapture();
  const [partnerType, setPartnerType] = useState<PartnerType | null>((me?.logistics?.partnerType as PartnerType | undefined) ?? null);
  const [company, setCompany] = useState(me?.logistics?.companyName ?? '');
  const [gstin, setGstin] = useState('');
  const [files, setFiles] = useState<Record<string, LocalFile>>({});
  const [accepted, setAccepted] = useState(false);
  const [bank, setBank] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gstinNeeded = partnerType === 'AGENCY';
  const gstinOk = gstin ? isValidGstin(gstin) : !gstinNeeded;
  const ifscOk = !ifsc || IFSC_RE.test(ifsc);
  const bankOk = !bank === !ifsc;

  const missing: string[] = [];
  if (!partnerType) missing.push('Choose your partner type.');
  if (gstinNeeded && !company.trim()) missing.push('Enter the company name.');
  if (!gstinOk) missing.push(gstinNeeded && !gstin ? 'Enter the GSTIN.' : 'Check the GSTIN. It does not look right.');
  for (const d of DOCS) if (!files[d.slot]) missing.push(`Add the ${d.label.toLowerCase()}.`);
  if (!accepted) missing.push('Accept the no co-loading rule.');
  if (!ifscOk || !bankOk) missing.push('Enter a valid account number and IFSC, or leave both empty.');

  const setDoc = (slot: string, f: LocalFile | null) => { if (f) setFiles((all) => ({ ...all, [slot]: f })); };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const uploads: Record<string, ReturnType<typeof queueUpload>> = {};
      for (const d of DOCS) uploads[d.slot] = queueUpload(files[d.slot]!, d.purpose);
      const body: Record<string, unknown> = { partnerType, noCoLoadingAccepted: true };
      if (company.trim()) body.companyName = company.trim();
      if (gstin) body.gstin = gstin;
      if (bank && ifsc) { body.bankAccount = bank; body.ifsc = ifsc; }
      // Queued like everything else, so that three document photos survive a dropped connection.
      await queue.add({ kind: 'PROFILE', label: 'Your partner documents', uploads, fileFields: Object.fromEntries(DOCS.map((d) => [d.field, d.slot])), path: '/onboarding/logistics/profile', body });
      if (nav.depth > 1) nav.pop();
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Screen title="Partner documents">
      <Body>Agrimate checks these documents before you can see routes.</Body>
      <Heading>Who are you?</Heading>
      <RadioGroup value={partnerType} onChange={setPartnerType} options={[
        { value: 'INDIVIDUAL', label: 'Owner-driver', note: 'You drive your own vehicle.' },
        { value: 'AGENCY', label: 'Transport agency', note: 'A company with vehicles. A GSTIN is required.' },
      ]} />
      {partnerType === 'AGENCY' ? (
        <>
          <Field label="Company name" value={company} onChangeText={setCompany} autoCapitalize="words" />
          <Field label="GSTIN" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase())} autoCapitalize="characters" maxLength={15} error={gstin.length === 15 && !isValidGstin(gstin) ? 'That GSTIN does not look right.' : null} />
        </>
      ) : null}

      <Heading>Documents</Heading>
      <Muted>Photos are compressed on your phone to save data. You can also choose a PDF.</Muted>
      {DOCS.map((d) => (
        <Card key={d.slot}>
          <Body>{d.label}</Body>
          {files[d.slot] ? <Notice tone="ok">Ready to send ({fileSize(files[d.slot]!.sizeBytes)}).</Notice> : null}
          <View style={{ gap: 8 }}>
            <Button kind="secondary" label={files[d.slot] ? 'Retake photo' : 'Take photo'} onPress={async () => setDoc(d.slot, await capture(d.label))} />
            <Button kind="secondary" label="Choose a file" onPress={async () => { try { setDoc(d.slot, await pickDocument(PHOTO_OPTIONS)); } catch (e) { setError(errorMessage(e)); } }} />
          </View>
        </Card>
      ))}

      <Heading>No co-loading rule</Heading>
      <Body>Agrimate loads must travel alone. Fertiliser, pesticide, fuel, cement or other commercial goods on the same vehicle can contaminate food with chemicals, and the whole load can be refused.</Body>
      <Checkbox checked={accepted} onChange={setAccepted} label="I agree never to carry other commercial goods with an Agrimate load." />

      <Heading>Bank details for payouts (optional)</Heading>
      <Field label="Account number" value={bank} onChangeText={setBank} keyboardType="number-pad" />
      <Field label="IFSC" value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" maxLength={11} />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {missing.length ? <Notice>{`Before you can send:\n${missing.map((m) => `• ${m}`).join('\n')}`}</Notice> : null}
      <Button label="Send for approval" busy={busy} disabled={missing.length > 0} onPress={submit} />
      {nav.depth === 1 ? <Button kind="secondary" label="Sign out" onPress={signOut} /> : null}
    </Screen>
  );
}
