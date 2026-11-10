import type { VehicleView } from '@agrimate/api-client';
import { VEHICLE_NO_RE } from '@agrimate/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useCached } from '../lib/data';
import { errorMessage, kg } from '../lib/format';
import { useNet } from '../lib/net';
import { Button, Card, Field, Heading, Muted, Notice, Row, Screen, Skeleton } from '../lib/ui';

export function VehiclesScreen() {
  const { online } = useNet();
  const vehicles = useCached<VehicleView[]>('vehicles', () => api.get('/onboarding/logistics/vehicles'));
  const [regNo, setRegNo] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regOk = VEHICLE_NO_RE.test(regNo);
  const capacityKg = Number(capacity);
  const capacityOk = Number.isInteger(capacityKg) && capacityKg >= 100;

  const add = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/onboarding/logistics/vehicles', { regNo, capacityKg });
      setRegNo(''); setCapacity('');
      await vehicles.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="My vehicles" onRefresh={vehicles.reload} refreshing={vehicles.loading}>
      {vehicles.error ? <Notice tone="error">{vehicles.error}</Notice> : null}
      {vehicles.loading && !vehicles.data ? <Skeleton lines={2} label="Loading your vehicles..." /> : null}
      {vehicles.data && !vehicles.data.length ? <Muted>No vehicles yet. Add one below so that you can accept routes.</Muted> : null}
      {(vehicles.data ?? []).map((v) => (
        <Card key={v.id}>
          <Row label="Registration" value={v.regNo} />
          <Row label="Carries" value={kg(v.capacityKg)} />
          <Row label="Type" value={v.tier.name} />
        </Card>
      ))}
      <Heading>Add a vehicle</Heading>
      <Field label="Registration number" value={regNo} onChangeText={(t) => setRegNo(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" maxLength={11} placeholder="AS01AB1234" error={regNo.length >= 8 && !regOk ? 'Enter the registration like AS01AB1234.' : null} />
      <Field label="How much it carries" value={capacity} onChangeText={(t) => setCapacity(t.replace(/\D/g, ''))} keyboardType="number-pad" trailing="kg" error={capacity && !capacityOk ? 'Enter at least 100 kg.' : null} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!online ? <Muted>Adding a vehicle needs a connection.</Muted> : null}
      <Button label="Add vehicle" busy={busy} disabled={!regOk || !capacityOk || !online} onPress={add} />
    </Screen>
  );
}
