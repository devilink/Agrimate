import type { EarningsView, InspectorJob } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { useCached } from '../lib/data';
import { errorMessage, istDate, istDateTime, kg, orderStateLabel, statusLabel } from '../lib/format';
import { directionsUrl } from '../lib/location';
import { useIsFocused, useNav } from '../lib/nav';
import { Body, Button, Card, colors, Field, Heading, Muted, Notice, Row, Screen, Skeleton, styles, Tabs } from '../lib/ui';
import { degreeLabel } from './OnboardingScreen';

const OPEN_STATUSES = ['ASSIGNED', 'CHECKED_IN'];

function JobsTab() {
  const me = useMe();
  const nav = useNav();
  const focused = useIsFocused();
  const approved = me.inspector?.status === 'VERIFIED';
  const jobs = useCached<InspectorJob[]>('inspector-jobs', () => api.get('/inspector/jobs'), { enabled: approved });

  // Coming back from a job may have changed its status, so the list refreshes then. This is the only automatic refetch.
  const [seenFocus, setSeenFocus] = useState(focused);
  useEffect(() => {
    if (focused && !seenFocus && approved) jobs.reload();
    setSeenFocus(focused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const open = (jobs.data ?? []).filter((j) => OPEN_STATUSES.includes(j.status));
  const done = (jobs.data ?? []).filter((j) => !OPEN_STATUSES.includes(j.status));

  const row = (j: InspectorJob) => (
    <Card key={j.id} onPress={() => nav.push('JobDetail', { job: j })}>
      <Text style={styles.heading}>{j.commodity}, {j.grade}</Text>
      <Row label="Order" value={j.orderCode} />
      <Row label="Quantity" value={kg(j.quantityKg)} />
      <Row label="Inspection day" value={istDate(j.scheduledFor)} />
      <Row label="Pickup PIN" value={j.pickupPin} />
      <Row label="Status" value={statusLabel(j.status)} />
      <Row label="Order" value={orderStateLabel(j.orderState)} />
      {OPEN_STATUSES.includes(j.status) ? <Button kind="secondary" label="Get directions" onPress={() => { Linking.openURL(directionsUrl(j.pickupLat, j.pickupLng)).catch(() => undefined); }} /> : null}
    </Card>
  );

  return (
    <Screen title="Jobs" back={false} onRefresh={approved ? jobs.reload : undefined} refreshing={jobs.loading}>
      {!approved ? <PendingNotice /> : null}
      {jobs.error ? <Notice tone="error">{jobs.error}{jobs.data && jobs.savedAt ? ` Showing the list from ${istDateTime(new Date(jobs.savedAt))}.` : ''}</Notice> : null}
      {approved && jobs.loading && !jobs.data ? <Skeleton label="Loading your jobs..." /> : null}
      {approved && jobs.data && !open.length ? <Muted>No open jobs right now. New jobs appear here when you are available and a farm is within your service radius.</Muted> : null}
      {open.map(row)}
      {done.length ? <Heading>Finished</Heading> : null}
      {done.map(row)}
    </Screen>
  );
}

function PendingNotice() {
  const me = useMe();
  const status = me.inspector?.status;
  if (status === 'REJECTED') return <Notice tone="error">Your degree was not approved.{me.inspector?.statusNote ? ` Reason: ${me.inspector.statusNote}.` : ''} Open Profile to send it again.</Notice>;
  return <Notice tone="warn">Your degree is waiting for approval. You will start getting jobs once an admin approves it and you turn on availability.</Notice>;
}

function EarningsTab() {
  const earnings = useCached<EarningsView>('inspector-earnings', () => api.get('/payouts/me'));
  const payouts = earnings.data?.payouts ?? [];
  const pending = payouts.filter((p) => p.status === 'PENDING' || p.status === 'BLOCKED').reduce((sum, p) => sum + BigInt(p.amountPaise), BigInt(0));
  return (
    <Screen title="Earnings" back={false} onRefresh={earnings.reload} refreshing={earnings.loading}>
      {earnings.error ? <Notice tone="error">{earnings.error}</Notice> : null}
      {earnings.loading && !earnings.data ? <Skeleton label="Loading your earnings..." /> : null}
      {earnings.data ? (
        <Card>
          <Row label="Total paid" value={formatINR(earnings.data.totalPaidPaise)} />
          <Row label="Waiting to be paid" value={formatINR(pending)} />
        </Card>
      ) : null}
      <Muted>Inspection fees are earned when you mark a job as inspected. They are paid when the order settles.</Muted>
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

function ProfileTab() {
  const me = useMe();
  const { refreshMe, signOut } = useAuth();
  const nav = useNav();
  const profile = me.inspector;
  const approved = profile?.status === 'VERIFIED';
  const [available, setAvailable] = useState(!!profile?.available);
  const [radius, setRadius] = useState(String(profile?.serviceRadiusKm ?? 50));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const radiusKm = Number(radius);
  const radiusOk = Number.isInteger(radiusKm) && radiusKm >= 1 && radiusKm <= 500;

  useEffect(() => { setAvailable(!!profile?.available); }, [profile?.available]);

  const save = async (nextAvailable: boolean) => {
    setBusy(true); setMessage(null);
    const before = available;
    setAvailable(nextAvailable);
    try {
      await api.post('/onboarding/inspector/availability', { available: nextAvailable, serviceRadiusKm: radiusKm });
      await refreshMe();
      setMessage({ tone: 'ok', text: nextAvailable ? `You are available for jobs within ${radiusKm} km.` : 'You will not get new jobs for now.' });
    } catch (e) {
      setAvailable(before);
      setMessage({ tone: 'error', text: errorMessage(e) });
    } finally { setBusy(false); }
  };

  return (
    <Screen title="Profile" back={false}>
      <Card>
        <Row label="Name" value={me.name} />
        <Row label="Mobile" value={me.phone} />
        <Row label="Degree" value={degreeLabel(profile?.degreeType)} />
        <Row label="Base PIN" value={profile?.pin ?? '-'} />
        <Row label="Approval" value={statusLabel(profile?.status ?? 'NOT_SUBMITTED')} />
      </Card>
      {!approved ? <PendingNotice /> : null}
      {profile?.status === 'REJECTED' ? <Button label="Send my degree again" onPress={() => nav.push('DegreeEdit')} /> : null}
      {!approved ? <Button kind="secondary" label="Check approval status" onPress={() => { refreshMe().catch((e) => setMessage({ tone: 'error', text: errorMessage(e) })); }} /> : null}

      <Heading>Availability</Heading>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
        <Text style={[styles.body, { flex: 1 }]}>Available for jobs</Text>
        <Switch accessibilityLabel="Available for jobs" value={available} disabled={!approved || busy || !radiusOk} onValueChange={save} trackColor={{ true: colors.primary }} />
      </View>
      {!approved ? <Muted>You can turn this on after your degree is approved.</Muted> : null}
      <Field label="Service radius" value={radius} onChangeText={(t) => setRadius(t.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" trailing="km" hint="Jobs come from farms within this distance of your base." error={radius && !radiusOk ? 'Enter a distance between 1 and 500 km.' : null} />
      <Button kind="secondary" label="Save radius" busy={busy} disabled={!approved || !radiusOk} onPress={() => save(available)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button kind="secondary" label="Sign out" onPress={signOut} />
    </Screen>
  );
}

const TABS = [{ key: 'jobs', label: 'Jobs' }, { key: 'earnings', label: 'Earnings' }, { key: 'profile', label: 'Profile' }];

export function HomeScreen() {
  const [tab, setTab] = useState('jobs');
  const [opened, setOpened] = useState<Record<string, boolean>>({ jobs: true });
  const change = (k: string) => { setTab(k); setOpened((o) => ({ ...o, [k]: true })); };
  const pane = (key: string, node: ReactNode) => opened[key] ? <View key={key} style={tab === key ? styles.flex : { display: 'none' }}>{node}</View> : null;
  return (
    <View style={styles.flex}>
      <View style={styles.flex}>
        {pane('jobs', <JobsTab />)}
        {pane('earnings', <EarningsTab />)}
        {pane('profile', <ProfileTab />)}
      </View>
      <Tabs tabs={TABS} active={tab} onChange={change} />
    </View>
  );
}
