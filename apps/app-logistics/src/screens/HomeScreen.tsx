import type { AvailableTrip, EarningsView, MyTrip } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { useCached } from '../lib/data';
import { errorMessage, istDate, istDateTime, kg, statusLabel } from '../lib/format';
import { useIsFocused, useNav } from '../lib/nav';
import { useQueueDone, useQueueItems } from '../lib/queue';
import { Body, Button, Card, Heading, Muted, Notice, Row, Screen, Skeleton, styles, Tabs } from '../lib/ui';

function PendingNotice() {
  const me = useMe();
  const items = useQueueItems();
  const status = me.logistics?.status;
  if (items.some((i) => i.kind === 'PROFILE')) return <Notice tone="warn">Your documents are saved on this phone and will be sent as soon as there is a connection.</Notice>;
  if (status === 'REJECTED') return <Notice tone="error">Your documents were not approved.{me.logistics?.statusNote ? ` Reason: ${me.logistics.statusNote}.` : ''} Open Account to send them again.</Notice>;
  return <Notice tone="warn">Your documents are waiting for approval. Routes appear here once an admin approves them.</Notice>;
}

function SavedAt({ at, error }: { at: number | null; error: string | null }) {
  if (error) return <Notice tone="error">{error}{at ? ` Showing what was saved on ${istDateTime(new Date(at))}.` : ''}</Notice>;
  return at ? <Muted>Updated {istDateTime(new Date(at))}. Pull down to refresh.</Muted> : null;
}

function RoutesTab() {
  const me = useMe();
  const nav = useNav();
  const focused = useIsFocused();
  const approved = me.logistics?.status === 'VERIFIED';
  const routes = useCached<AvailableTrip[]>('trips-available', () => api.get('/trips/available'), { enabled: approved });

  // Accepting a route removes it from this list, so returning from that screen is worth one request.
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && approved) routes.reload();
    wasFocused.current = focused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  return (
    <Screen title="Available routes" back={false} onRefresh={approved ? routes.reload : undefined} refreshing={routes.loading}>
      {!approved ? <PendingNotice /> : <SavedAt at={routes.savedAt} error={routes.error} />}
      {approved && routes.loading && !routes.data ? <Skeleton label="Loading routes..." /> : null}
      {approved && routes.data && !routes.data.length ? <Body>No routes right now. Pull down to check again.</Body> : null}
      {(routes.data ?? []).map((t) => (
        <Card key={t.id} onPress={() => nav.push('AcceptTrip', { trip: t })}>
          <Text style={styles.heading}>{t.pickupPin} to {t.dropPin}</Text>
          <Row label="Load" value={`${t.commodity}, ${kg(t.quantityKg)}`} />
          <Row label="Distance" value={`${t.distanceKm} km`} />
          <Row label="You earn" value={formatINR(t.payoutPaise)} />
          <Row label="Deliver by" value={istDate(t.slaDeadlineAt)} />
          <Muted>Tap to accept.</Muted>
        </Card>
      ))}
    </Screen>
  );
}

function TripsTab() {
  const me = useMe();
  const nav = useNav();
  const focused = useIsFocused();
  const approved = me.logistics?.status === 'VERIFIED';
  const trips = useCached<MyTrip[]>('trips-mine', () => api.get('/trips/mine'), { enabled: approved });
  const queued = useQueueItems();

  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && approved) trips.reload();
    wasFocused.current = focused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  const reload = trips.reload;
  useQueueDone(useCallback(() => { if (approved) reload(); }, [approved, reload]));

  const list = trips.data ?? [];
  const active = list.filter((t) => t.status === 'ACCEPTED' || t.status === 'PICKED_UP');
  const past = list.filter((t) => t.status !== 'ACCEPTED' && t.status !== 'PICKED_UP');
  const row = (t: MyTrip) => {
    const waiting = queued.filter((i) => i.tripId === t.id).length;
    return (
      <Card key={t.id} onPress={() => nav.push('Trip', { trip: t })}>
        <Text style={styles.heading}>{t.pickupPin} to {t.dropPin}</Text>
        <Row label="Order" value={t.orderCode} />
        <Row label="Load" value={`${t.commodity}, ${kg(t.quantityKg)}`} />
        <Row label="Vehicle" value={t.vehicleRegNo ?? '-'} />
        <Row label="Status" value={statusLabel(t.status)} />
        {waiting ? <Notice tone="warn">{waiting} action{waiting > 1 ? 's' : ''} waiting to send.</Notice> : null}
      </Card>
    );
  };

  return (
    <Screen title="My trips" back={false} onRefresh={approved ? reload : undefined} refreshing={trips.loading}>
      {!approved ? <PendingNotice /> : <SavedAt at={trips.savedAt} error={trips.error} />}
      {approved && trips.loading && !trips.data ? <Skeleton label="Loading your trips..." /> : null}
      {approved && trips.data && !list.length ? <Body>No trips yet. Accept a route to start.</Body> : null}
      {active.map(row)}
      {past.length ? <Heading>Finished</Heading> : null}
      {past.map(row)}
    </Screen>
  );
}

function EarningsTab() {
  const earnings = useCached<EarningsView>('earnings', () => api.get('/payouts/me'));
  const reload = earnings.reload;
  useQueueDone(useCallback((i) => { if (i.kind === 'DELIVER') reload(); }, [reload]));
  const payouts = earnings.data?.payouts ?? [];
  const waiting = payouts.filter((p) => p.status === 'PENDING' || p.status === 'BLOCKED').reduce((sum, p) => sum + BigInt(p.amountPaise), BigInt(0));
  return (
    <Screen title="Earnings" back={false} onRefresh={reload} refreshing={earnings.loading}>
      {earnings.error ? <Notice tone="error">{earnings.error}</Notice> : null}
      {earnings.loading && !earnings.data ? <Skeleton label="Loading your earnings..." /> : null}
      {earnings.data ? (
        <Card>
          <Row label="Total paid" value={formatINR(earnings.data.totalPaidPaise)} />
          <Row label="Waiting to be paid" value={formatINR(waiting)} />
        </Card>
      ) : null}
      <Muted>Freight is released when proof of delivery is recorded.</Muted>
      {earnings.data && !payouts.length ? <Body>No payouts yet.</Body> : null}
      {payouts.map((p) => (
        <Card key={p.id}>
          <Row label={p.orderCode} value={formatINR(p.amountPaise)} />
          <Row label={statusLabel(p.status)} value={istDate(p.createdAt)} />
          {p.statusNote ? <Muted>{p.statusNote}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}

function AccountTab() {
  const me = useMe();
  const { signOut, refreshMe } = useAuth();
  const nav = useNav();
  const items = useQueueItems();
  const profile = me.logistics;
  const [error, setError] = useState<string | null>(null);

  // Queued items stay on the phone and resume after signing back in, but a driver should know before leaving.
  const confirmSignOut = () => {
    if (!items.length) { signOut(); return; }
    Alert.alert('Items are still waiting', `${items.length} item(s) have not reached Agrimate yet. They stay on this phone and will send after you sign in again with this number.`, [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { signOut(); } },
    ]);
  };

  return (
    <Screen title="Account" back={false}>
      <Card>
        <Row label="Name" value={me.name} />
        <Row label="Mobile" value={me.phone} />
        <Row label="Type" value={profile?.partnerType === 'AGENCY' ? 'Transport agency' : 'Owner-driver'} />
        {profile?.companyName ? <Row label="Company" value={profile.companyName} /> : null}
      </Card>
      <Heading>Documents</Heading>
      <Card>
        <Row label="RC, licence and fitness" value={statusLabel(profile?.status ?? 'NOT_SUBMITTED')} />
        <Row label="No co-loading agreed" value={istDate(profile?.noCoLoadingAcceptedAt)} />
        {profile?.statusNote ? <Muted>{profile.statusNote}</Muted> : null}
      </Card>
      {profile?.status !== 'VERIFIED' ? <PendingNotice /> : null}
      <Button kind="secondary" label="Send new documents" onPress={() => nav.push('Documents')} />
      {profile?.status !== 'VERIFIED' ? <Button kind="secondary" label="Check approval status" onPress={() => { setError(null); refreshMe().catch((e) => setError(errorMessage(e))); }} /> : null}
      <Muted>Trip documents, such as E-Way bills and delivery photos, are on each trip.</Muted>
      <Heading>Vehicles</Heading>
      <Button kind="secondary" label="My vehicles" onPress={() => nav.push('Vehicles')} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button kind="secondary" label="Sign out" onPress={confirmSignOut} />
    </Screen>
  );
}

const TABS = [{ key: 'routes', label: 'Routes' }, { key: 'trips', label: 'Trips' }, { key: 'earnings', label: 'Earnings' }, { key: 'account', label: 'Account' }];

export function HomeScreen() {
  const [tab, setTab] = useState('routes');
  // Tabs load only when first opened, so that starting the app costs one request instead of four.
  const [opened, setOpened] = useState<Record<string, boolean>>({ routes: true });
  const change = (k: string) => { setTab(k); setOpened((o) => ({ ...o, [k]: true })); };
  const pane = (key: string, node: ReactNode) => opened[key] ? <View key={key} style={tab === key ? styles.flex : { display: 'none' }}>{node}</View> : null;
  return (
    <View style={styles.flex}>
      <View style={styles.flex}>
        {pane('routes', <RoutesTab />)}
        {pane('trips', <TripsTab />)}
        {pane('earnings', <EarningsTab />)}
        {pane('account', <AccountTab />)}
      </View>
      <Tabs tabs={TABS} active={tab} onChange={change} />
    </View>
  );
}
