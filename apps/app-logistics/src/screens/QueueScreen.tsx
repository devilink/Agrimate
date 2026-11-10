import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { fileSize, istDateTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { useNet } from '../lib/net';
import { describeWaiting, queue, useQueueItems } from '../lib/queue';
import { Body, Button, Card, colors, Muted, Notice, Screen, styles } from '../lib/ui';

export function QueueScreen() {
  const items = useQueueItems();
  const { online } = useNet();
  const nav = useNav();
  const [now, setNow] = useState(Date.now());

  // Keeps the "trying again in..." wording roughly honest while this screen is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const confirmRemove = (id: string, label: string) => {
    Alert.alert('Delete this item?', `${label} has not reached Agrimate. Deleting it removes it from this phone for good.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { queue.remove(id); } },
    ]);
  };

  return (
    <Screen title="Waiting to send">
      {!items.length ? <Notice tone="ok">Everything has reached Agrimate.</Notice> : <Muted>These are saved on this phone and are safe if the app closes. They send by themselves while the app is open and there is a connection.</Muted>}
      {items.map((item) => {
        const sizes = Object.values(item.uploads).reduce((sum, u) => sum + u.sizeBytes, 0);
        return (
          <Card key={item.id}>
            <Text style={styles.heading}>{item.label}</Text>
            <Muted>Saved {istDateTime(new Date(item.createdAt))}{sizes ? `, ${fileSize(sizes)} to send` : ''}</Muted>
            <Text style={item.attention ? styles.errorText : { fontSize: 16, color: colors.warn }}>{describeWaiting(item, online, now)}</Text>
            {item.lastError && !item.attention ? <Muted>Last problem: {item.lastError}</Muted> : null}
            {item.attention && item.kind === 'DELIVER' && item.attention.code !== 'ILLEGAL_TRANSITION' ? <Body>Open the trip from My trips and tap Mark as Delivered to fix this. Your photo is kept.</Body> : null}
            {!item.progress ? <Button kind="secondary" label="Try again now" disabled={!online} onPress={() => { queue.retry(item.id); }} /> : null}
            {item.attention ? <Button kind="danger" label="Delete" onPress={() => confirmRemove(item.id, item.label)} /> : null}
          </Card>
        );
      })}
      <Button kind="secondary" label="Back" onPress={nav.pop} />
    </Screen>
  );
}
