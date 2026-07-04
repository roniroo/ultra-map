// Trail-snapping routing via the public Valhalla instance run by FOSSGIS
// (OpenStreetMap Germany). Free, no API key. Falls back to straight lines.
import type { Activity, LngLat } from '../types';
import { decodePolyline } from './geo';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export async function fetchSnappedSegment(
  a: LngLat,
  b: LngLat,
  activity: Activity
): Promise<LngLat[]> {
  const costing = activity === 'bike' ? 'bicycle' : 'pedestrian';
  const body = {
    locations: [
      { lat: a[1], lon: a[0], type: 'break' },
      { lat: b[1], lon: b[0], type: 'break' },
    ],
    costing,
    directions_options: { units: 'kilometers' },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`routing failed (${res.status})`);
    const json = await res.json();
    const coords: LngLat[] = [];
    for (const leg of json.trip?.legs ?? []) {
      coords.push(...decodePolyline(leg.shape, 6));
    }
    if (coords.length < 2) throw new Error('empty route');
    // connect the user's exact click points to the snapped network route
    return [a, ...coords, b];
  } finally {
    clearTimeout(timer);
  }
}
