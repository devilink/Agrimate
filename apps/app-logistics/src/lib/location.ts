import * as Location from 'expo-location';

export interface Fix { lat: number; lng: number; accuracyMetres: number | null }

const FIX_TIMEOUT_MS = 30_000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60_000;

/** A GPS fix needs no data connection. Falls back to a recent last-known fix when the sky view is poor. */
export async function currentFix(): Promise<Fix> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is off. Allow location for this app in your phone settings.');
  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
  ]);
  const position = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null));
  if (!position) throw new Error('Could not get a GPS fix. Check that location is on, move to open sky and try again.');
  return { lat: position.coords.latitude, lng: position.coords.longitude, accuracyMetres: position.coords.accuracy === null ? null : Math.round(position.coords.accuracy) };
}

/** Works with no map SDK: this opens whichever maps app the phone already has. */
export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const directionsToPinUrl = (pin: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${pin}, India`)}`;
