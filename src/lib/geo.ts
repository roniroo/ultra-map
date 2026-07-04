import type { Activity, LngLat, ProfilePoint, RouteStats, Split, Units } from '../types';

const R = 6371000;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cumulativeDistances(coords: LngLat[]): number[] {
  const cum = new Array<number>(coords.length);
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  }
  return cum;
}

export function pathLength(coords: LngLat[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/** Point at distance `dist` along the path. `cum` must be cumulativeDistances(coords). */
export function interpolateAlong(coords: LngLat[], cum: number[], dist: number): LngLat {
  const total = cum[cum.length - 1];
  if (dist <= 0) return coords[0];
  if (dist >= total) return coords[coords.length - 1];
  // binary search for segment
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? (dist - cum[lo]) / segLen : 0;
  const a = coords[lo];
  const b = coords[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Decode a Google-encoded polyline. Valhalla uses precision 6. Returns [lng, lat]. */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: LngLat[] = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

/** Douglas–Peucker simplification returning kept indices (always includes ends). */
export function simplifyIndices(coords: LngLat[], toleranceDeg: number): number[] {
  if (coords.length <= 2) return coords.map((_, i) => i);
  const keep = new Set<number>([0, coords.length - 1]);
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistDeg(coords[i], coords[s], coords[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceDeg && idx > 0) {
      keep.add(idx);
      stack.push([s, idx], [idx, e]);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

function perpDistDeg(p: LngLat, a: LngLat, b: LngLat): number {
  const cosLat = Math.cos((a[1] * Math.PI) / 180);
  const px = (p[0] - a[0]) * cosLat;
  const py = p[1] - a[1];
  const bx = (b[0] - a[0]) * cosLat;
  const by = b[1] - a[1];
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Tobler's hiking function: walking speed in m/s given slope (rise/run). */
export function toblerSpeed(slope: number): number {
  return (6 * Math.exp(-3.5 * Math.abs(slope + 0.05))) / 3.6;
}

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  hike: 1.0,
  run: 1.85,
  bike: 2.6,
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  hike: 'Hike',
  run: 'Run',
  bike: 'Bike',
};

export function estimateMovingTime(profile: ProfilePoint[], activity: Activity): number {
  const factor = ACTIVITY_FACTOR[activity];
  let t = 0;
  for (let i = 1; i < profile.length; i++) {
    const dd = profile[i].dist - profile[i - 1].dist;
    if (dd <= 0) continue;
    const de = profile[i].ele - profile[i - 1].ele;
    const v = Math.max(0.3, toblerSpeed(de / dd) * factor);
    t += dd / v;
  }
  return t;
}

export function computeStats(profile: ProfilePoint[], activity: Activity): RouteStats {
  let gain = 0;
  let loss = 0;
  let acc = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    const e = profile[i].ele;
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
    if (i > 0) {
      acc += e - profile[i - 1].ele;
      if (acc >= 2) {
        gain += acc;
        acc = 0;
      } else if (acc <= -2) {
        loss -= acc;
        acc = 0;
      }
    }
  }
  const distance = profile.length ? profile[profile.length - 1].dist : 0;
  return {
    distance,
    gain,
    loss,
    minEle: isFinite(minEle) ? minEle : 0,
    maxEle: isFinite(maxEle) ? maxEle : 0,
    movingTimeSec: estimateMovingTime(profile, activity),
  };
}

export function computeSplits(
  profile: ProfilePoint[],
  activity: Activity,
  unitMeters: number
): Split[] {
  const splits: Split[] = [];
  if (profile.length < 2) return splits;
  const factor = ACTIVITY_FACTOR[activity];
  let cur: Split = { index: 1, dist: 0, gain: 0, loss: 0, timeSec: 0 };
  for (let i = 1; i < profile.length; i++) {
    const dd = profile[i].dist - profile[i - 1].dist;
    if (dd <= 0) continue;
    const de = profile[i].ele - profile[i - 1].ele;
    const v = Math.max(0.3, toblerSpeed(de / dd) * factor);
    cur.dist += dd;
    cur.timeSec += dd / v;
    if (de > 0) cur.gain += de;
    else cur.loss -= de;
    if (profile[i].dist >= cur.index * unitMeters) {
      splits.push(cur);
      cur = { index: cur.index + 1, dist: 0, gain: 0, loss: 0, timeSec: 0 };
    }
  }
  if (cur.dist > unitMeters * 0.02) splits.push(cur);
  return splits;
}

// ---------- formatting ----------

const MI = 1609.344;
const FT = 0.3048;

export function fmtDistance(meters: number, units: Units): string {
  if (units === 'imperial') {
    const mi = meters / MI;
    if (mi < 0.1) return `${Math.round(meters / FT)} ft`;
    return `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
}

export function fmtElevation(meters: number, units: Units): string {
  if (units === 'imperial') return `${Math.round(meters / FT).toLocaleString()} ft`;
  return `${Math.round(meters).toLocaleString()} m`;
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtGrade(grade: number): string {
  return `${(grade * 100).toFixed(1)}%`;
}

export function splitUnitMeters(units: Units): number {
  return units === 'imperial' ? MI : 1000;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
