/**
 * Accepting a route is the one action that is never queued. Two drivers can race for a route, so the driver must know
 * the outcome before setting off. A queued acceptance could easily fail hours later.
 */
import { ApiError, type AvailableTrip, type VehicleView } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../lib/api';
import { useCached } from '../lib/data';
import { errorMessage, istDate, kg } from '../lib/format';
import { useNav } from '../lib/nav';
import { useNet } from '../lib/net';
import { Body, Button, Card, Checkbox, Heading, Muted, Notice, RadioGroup, Row, Screen, Skeleton } from '../lib/ui';

export function AcceptTripScreen({ params }: { params: { trip: AvailableTrip } }) {
  const { trip } = params;
  const nav = useNav();
  const { online } = useNet();
  const vehicles = useCached<VehicleView[]>('vehicles', () => api.get('/onboarding/logistics/vehicles'));
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  // Never pre-ticked or remembered: the promise is made fresh for each trip.
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  const list = vehicles.data ?? [];
  const usable = list.some((v) => v.capacityKg >= trip.quantityKg);

  const accept = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/trips/${trip.id}/accept`, { vehicleId, noCoLoadingAttested: true });
      Alert.alert('Route accepted', 'It is now in your Trips tab. Next, add the E-Way bill.');
      nav.pop();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TRIP_TAKEN') setTaken(true);
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Screen title={`${trip.pickupPin} to ${trip.dropPin}`}>
      <Card>
        <Row label="Order" value={trip.orderCode} />
        <Row label="Load" value={`${trip.commodity}, ${kg(trip.quantityKg)}`} />
        <Row label="Distance" value={`${trip.distanceKm} km`} />
        <Row label="You earn" value={formatINR(trip.payoutPaise)} />
        <Row label="Deliver by" value={istDate(trip.slaDeadlineAt)} />
      </Card>

      <Heading>Choose a vehicle</Heading>
      {vehicles.error ? <Notice tone="error">{vehicles.error}</Notice> : null}
      {vehicles.loading && !vehicles.data ? <Skeleton lines={2} label="Loading your vehicles..." /> : null}
      {vehicles.data && !usable ? <Notice tone="warn">None of your vehicles can carry {kg(trip.quantityKg)}. Add a bigger vehicle first.</Notice> : null}
      {vehicles.data && !usable ? <Button kind="secondary" label="My vehicles" onPress={() => nav.push('Vehicles')} /> : null}
      <RadioGroup value={vehicleId} onChange={setVehicleId} options={list.map((v) => ({
        value: v.id, label: v.regNo, disabled: v.capacityKg < trip.quantityKg,
        note: v.capacityKg < trip.quantityKg ? `Carries ${kg(v.capacityKg)}, too small for this load.` : `Carries ${kg(v.capacityKg)}.`,
      }))} />

      <Heading>No co-loading on this trip</Heading>
      <Body>Food absorbs what travels next to it. Fertiliser, pesticide, fuel, cement or any other goods on the same vehicle can contaminate this load with chemicals, make it unsafe to eat, and get the whole load refused.</Body>
      <Checkbox checked={attested} onChange={setAttested} label="I confirm this vehicle will carry only this load for the whole trip." />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!online ? <Notice tone="warn">Accepting a route needs a connection, since another driver may take it first.</Notice> : null}
      {!vehicleId || !attested ? <Muted>{!vehicleId ? 'Choose a vehicle' : 'Tick the confirmation'} to accept this route.</Muted> : null}
      {taken
        ? <Button kind="secondary" label="Back to routes" onPress={nav.pop} />
        : <Button label="Accept route" busy={busy} disabled={!vehicleId || !attested || !online} onPress={accept} />}
    </Screen>
  );
}
