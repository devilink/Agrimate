export interface LatLng { lat: number; lng: number }
const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
export const withinRadius = (a: LatLng, b: LatLng, metres: number) => haversineMetres(a, b) <= metres;
