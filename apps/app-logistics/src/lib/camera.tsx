/**
 * In-app camera as a promise: `const photo = await capture('Photo of the scale')`.
 * The camera is mounted only while open, and each photo is compressed on the phone before anything else sees it.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Linking, Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PHOTO_OPTIONS } from './config';
import { compressPhoto, type LocalFile } from './files';
import { errorMessage } from './format';
import { Button, Notice, styles } from './ui';

type Capture = (title: string) => Promise<LocalFile | null>;
const CameraContext = createContext<Capture | null>(null);

export function useCapture(): Capture {
  const capture = useContext(CameraContext);
  if (!capture) throw new Error('useCapture must be used inside CameraProvider');
  return capture;
}

export function CameraProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((f: LocalFile | null) => void) | null>(null);
  const camera = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();

  const capture = useCallback<Capture>((t) => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setError(null);
    setTitle(t);
  }), []);

  const finish = (file: LocalFile | null) => {
    resolver.current?.(file);
    resolver.current = null;
    setTitle(null);
    setBusy(false);
  };

  const shoot = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await camera.current.takePictureAsync({ quality: 0.7, shutterSound: false });
      finish(await compressPhoto(raw.uri, raw.width, raw.height, PHOTO_OPTIONS));
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  return (
    <CameraContext.Provider value={capture}>
      {children}
      <Modal visible={title !== null} animationType="slide" onRequestClose={() => finish(null)}>
        <View style={[styles.flex, { backgroundColor: '#000', paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', padding: 12 }}>{title}</Text>
          {permission?.granted ? (
            <CameraView ref={camera} style={styles.flex} facing="back" animateShutter={false} />
          ) : (
            <View style={[styles.flex, { justifyContent: 'center', padding: 16, gap: 12 }]}>
              <Notice tone="warn">The camera is needed to take this photo.</Notice>
              {permission && !permission.canAskAgain
                ? <Button label="Open phone settings" onPress={() => { Linking.openSettings().catch(() => undefined); }} />
                : <Button label="Allow camera" onPress={() => { requestPermission().catch(() => undefined); }} />}
            </View>
          )}
          <View style={{ padding: 12, gap: 8 }}>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {permission?.granted ? <Button label={busy ? 'Saving photo...' : 'Take photo'} busy={busy} onPress={shoot} /> : null}
            <Button kind="secondary" label="Cancel" disabled={busy} onPress={() => finish(null)} />
          </View>
        </View>
      </Modal>
    </CameraContext.Provider>
  );
}
