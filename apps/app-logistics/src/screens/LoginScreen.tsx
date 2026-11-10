import { ApiError } from '@agrimate/api-client';
import { isValidPhone } from '@agrimate/shared';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { APP_TITLE } from '../lib/config';
import { errorMessage } from '../lib/format';
import { Body, Button, Field, Notice, Screen } from '../lib/ui';

export function LoginScreen() {
  const { requestOtp, signIn } = useAuth();
  const [digits, setDigits] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [askName, setAskName] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const phone = `+91${digits}`;

  const send = async () => {
    setBusy(true); setError(null); setInfo(null); setCode('');
    try {
      const r = await requestOtp(phone);
      setDevOtp(r.devOtp ?? null);
      setStep('code');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (askName && name.trim().length < 2) { setError('Enter your full name.'); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      await signIn({ phone, code, name: askName ? name.trim() : undefined });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SIGNUP_DETAILS_REQUIRED') {
        // The API has already used up the code by this point, so a new one is needed to finish signing up.
        setAskName(true);
        setInfo('This is a new number. Enter your name, then use the new code we are sending.');
        try {
          const r = await requestOtp(phone);
          setDevOtp(r.devOtp ?? null);
          setCode('');
        } catch (again) { setError(errorMessage(again)); }
      } else {
        setError(errorMessage(e));
      }
    } finally { setBusy(false); }
  };

  return (
    <Screen title={APP_TITLE} back={false}>
      {step === 'phone' ? (
        <>
          <Body>Sign in with your mobile number. We will send you a 6-digit code.</Body>
          <Field label="Mobile number" value={digits} onChangeText={(t) => setDigits(t.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={10} placeholder="10-digit number" hint="+91 is added for you." />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Send code" busy={busy} disabled={!isValidPhone(phone)} onPress={send} />
        </>
      ) : (
        <>
          <Body>Enter the code sent to {phone}.</Body>
          {devOtp ? <Notice tone="warn">Development only, SMS is mocked. Your code is {devOtp}.</Notice> : null}
          {devOtp ? <Button kind="secondary" label="Use this code" onPress={() => setCode(devOtp)} /> : null}
          {info ? <Notice>{info}</Notice> : null}
          {askName ? <Field label="Your full name" value={name} onChangeText={setName} autoCapitalize="words" /> : null}
          <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Sign in" busy={busy} disabled={code.length !== 6} onPress={verify} />
          <Button kind="secondary" label="Send a new code" disabled={busy} onPress={send} />
          <Button kind="secondary" label="Change number" disabled={busy} onPress={() => { setStep('phone'); setError(null); setInfo(null); setAskName(false); setDevOtp(null); }} />
        </>
      )}
    </Screen>
  );
}
