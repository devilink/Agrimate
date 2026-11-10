import type { MyTrip, TripView } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { api } from '../lib/api';
import { useCapture } from '../lib/camera';
import { PHOTO_OPTIONS } from '../lib/config';
import { useCached } from '../lib/data';
import { pickDocument, type LocalFile } from '../lib/files';
import { errorMessage, fileSize, istDateTime, kg, statusLabel } from '../lib/format';
import { directionsToPinUrl, directionsUrl } from '../lib/location';
import { useNav } from '../lib/nav';
import { useNet } from '../lib/net';
import { queue, queueUpload, useQueueDone, useQueueItems } from '../lib/queue';
import { Body, Button, Card, Field, Heading, Muted, Notice, Row, Screen } from '../lib/ui';

interface OrderForTrip {
  farmer?: { name: string; phone: string; phoneUnlocked: boolean };
  buyer?: { name: string; phone: string; phoneUnlocked: boolean };
  trip?: TripView | null;
}

const ORDER_READY_FOR_PICKUP = ['INSPECTED', 'SELF_CERTIFIED'];

export function TripScreen({ params }: { params: { trip: MyTrip } }) {
  const nav = useNav();
  const { online } = useNet();
  const capture = useCapture();
  const [trip, setTrip] = useState(params.trip);
  const items = useQueueItems().filter((i) => i.tripId === trip.id);
  const queuedEway = items.find((i) => i.kind === 'EWAY');
  const queuedPickup = items.find((i) => i.kind === 'PICKUP');
  const queuedDeliver = items.find((i) => i.kind === 'DELIVER');

  const [ewayNumber, setEwayNumber] = useState('');
  const [ewayFile, setEwayFile] = useState<LocalFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const order = useCached<OrderForTrip>(`order-${trip.orderId}`, () => api.get(`/orders/${trip.orderId}`));

  const refresh = useCallback(async () => {
    try {
      const mine = await api.get<MyTrip[]>('/trips/mine');
      const fresh = mine.find((t) => t.id === params.trip.id);
      if (fresh) setTrip(fresh);
      setError(null);
    } catch (e) { setError(errorMessage(e)); }
  }, [params.trip.id]);
  const reloadOrder = order.reload;
  useQueueDone(useCallback((i) => { if (i.tripId === params.trip.id) { refresh(); reloadOrder(); } }, [params.trip.id, refresh, reloadOrder]));

  const sendEway = async () => {
    if (!ewayFile) return;
    setError(null);
    try {
      await queue.add({
        kind: 'EWAY', tripId: trip.id, label: `E-Way bill for ${trip.orderCode}`, path: `/trips/${trip.id}/eway-bill`, body: { ewayBillNumber: ewayNumber.trim() },
        uploads: { bill: queueUpload(ewayFile, 'EWAY_BILL', trip.orderId) }, fileFields: { fileId: 'bill' }, doneWhenTripStatus: ['PICKED_UP', 'DELIVERED'],
      });
      setEwayFile(null);
      setNotice('E-Way bill saved. It sends as soon as there is a connection.');
    } catch (e) { setError(errorMessage(e)); }
  };

  const confirmPickup = async () => {
    setError(null);
    try {
      await queue.add({ kind: 'PICKUP', tripId: trip.id, label: `Pickup for ${trip.orderCode}`, path: `/trips/${trip.id}/pickup`, body: {}, uploads: {}, fileFields: {}, doneWhenTripStatus: ['PICKED_UP', 'DELIVERED'] });
      setNotice('Pickup saved. It sends as soon as there is a connection.');
    } catch (e) { setError(errorMessage(e)); }
  };

  /** Asked for only when the driver taps, so that browsing a trip uses no extra data. */
  const openFile = async (fileId: string) => {
    setError(null);
    try {
      const r = await api.get<{ url: string }>(`/files/${fileId}/download-url`);
      await Linking.openURL(r.url);
    } catch (e) { setError(errorMessage(e)); }
  };

  const ewayValid = ewayNumber.trim().length >= 6 && !!ewayFile;
  const hasEway = !!trip.ewayBillNumber || !!queuedEway;
  const ready = ORDER_READY_FOR_PICKUP.includes(trip.orderState);
  const tripDocs = order.data?.trip;
  const { farmer, buyer } = order.data ?? {};

  return (
    <Screen title={`${trip.pickupPin} to ${trip.dropPin}`} onRefresh={() => { refresh(); reloadOrder(); }} refreshing={false}>
      <Card>
        <Row label="Order" value={trip.orderCode} />
        <Row label="Load" value={`${trip.commodity}, ${kg(trip.quantityKg)}`} />
        <Row label="Vehicle" value={trip.vehicleRegNo ?? '-'} />
        <Row label="Distance" value={`${trip.distanceKm} km`} />
        <Row label="You earn" value={formatINR(trip.payoutPaise)} />
        <Row label="Status" value={statusLabel(trip.status)} />
        {trip.pickedUpAt ? <Row label="Picked up" value={istDateTime(trip.pickedUpAt)} /> : null}
        {trip.deliveredAt ? <Row label="Delivered" value={istDateTime(trip.deliveredAt)} /> : null}
      </Card>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice && items.length ? <Notice>{notice}</Notice> : null}
      {items.filter((i) => i.attention).map((i) => (
        <Notice key={i.id} tone="error">{i.label}: {i.attention?.message}</Notice>
      ))}
      {items.some((i) => i.attention) ? <Button label="See what needs attention" onPress={() => nav.push('Queue')} /> : null}

      {trip.status === 'ACCEPTED' ? (
        <>
          <Heading>Pickup point</Heading>
          {farmer ? <Body>{farmer.name}</Body> : null}
          {farmer?.phoneUnlocked ? <Button kind="secondary" label={`Call ${farmer.phone}`} onPress={() => { Linking.openURL(`tel:${farmer.phone}`).catch(() => undefined); }} /> : null}
          <Button kind="secondary" label="Directions to pickup" onPress={() => { Linking.openURL(directionsUrl(trip.pickupLat, trip.pickupLng)).catch(() => undefined); }} />

          <Heading>1. E-Way bill</Heading>
          {trip.ewayBillNumber ? <Notice tone="ok">E-Way bill {trip.ewayBillNumber} is on file.</Notice> : null}
          {queuedEway ? <Notice tone="warn">E-Way bill is saved on this phone and waiting to send.</Notice> : null}
          {!hasEway ? (
            <>
              <Field label="E-Way bill number" value={ewayNumber} onChangeText={setEwayNumber} keyboardType="number-pad" hint="At least 6 digits." />
              {ewayFile ? <Notice tone="ok">Photo ready ({fileSize(ewayFile.sizeBytes)}).</Notice> : null}
              <View style={{ gap: 8 }}>
                <Button kind="secondary" label={ewayFile ? 'Retake photo' : 'Photograph the bill'} onPress={async () => { const f = await capture('E-Way bill'); if (f) setEwayFile(f); }} />
                <Button kind="secondary" label="Choose a file" onPress={async () => { try { const f = await pickDocument(PHOTO_OPTIONS); if (f) setEwayFile(f); } catch (e) { setError(errorMessage(e)); } }} />
              </View>
              <Button label="Save E-Way bill" disabled={!ewayValid} onPress={sendEway} />
            </>
          ) : null}

          <Heading>2. Confirm pickup</Heading>
          {queuedPickup && !queuedPickup.attention ? <Notice tone="warn">Pickup is saved on this phone and waiting to send.</Notice> : null}
          {!ready ? <Notice tone="warn">This order is not ready to leave yet. The buyer must pay in full and the inspection must be done. If you confirm too early, Agrimate will say what is missing.</Notice> : null}
          {!hasEway ? <Muted>Add the E-Way bill first.</Muted> : null}
          {!queuedPickup ? <Button label="Confirm pickup" disabled={!hasEway} onPress={confirmPickup} /> : null}
        </>
      ) : null}

      {trip.status === 'PICKED_UP' ? (
        <>
          <Heading>Drop point</Heading>
          {buyer ? <Body>{buyer.name}</Body> : null}
          {buyer?.phoneUnlocked ? <Button kind="secondary" label={`Call ${buyer.phone}`} onPress={() => { Linking.openURL(`tel:${buyer.phone}`).catch(() => undefined); }} /> : null}
          <Button kind="secondary" label="Directions to drop" onPress={() => { Linking.openURL(directionsToPinUrl(trip.dropPin)).catch(() => undefined); }} />
          {queuedDeliver && !queuedDeliver.attention ? <Notice tone="ok">Proof of delivery is saved on this phone and waiting to send. You do not need to do anything.</Notice> : null}
          {!queuedDeliver || queuedDeliver.attention ? <Button label="Mark as Delivered" onPress={() => nav.push('Deliver', { trip })} /> : null}
        </>
      ) : null}

      {trip.status === 'DELIVERED' ? <Notice tone="ok">Delivered. Freight is released to you from proof of delivery.</Notice> : null}

      <Heading>Trip documents</Heading>
      {trip.ewayBillNumber ? <Row label="E-Way bill" value={trip.ewayBillNumber} /> : null}
      {tripDocs?.ewayBillFileId ? <Button kind="secondary" label="Open E-Way bill" disabled={!online} onPress={() => openFile(tripDocs.ewayBillFileId as string)} /> : null}
      {tripDocs?.podPhotoFileId ? <Button kind="secondary" label="Open delivery photo" disabled={!online} onPress={() => openFile(tripDocs.podPhotoFileId as string)} /> : null}
      {!tripDocs?.ewayBillFileId && !tripDocs?.podPhotoFileId ? <Muted>Nothing on file yet.</Muted> : null}
    </Screen>
  );
}
