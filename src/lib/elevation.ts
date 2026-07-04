// Client-side elevation sampling from the AWS Open Data "Terrain Tiles"
// (Mapzen terrarium encoding). No API key, no rate-limited elevation API —
// profiles are computed instantly in the browser and cached per tile.
import type { LngLat, ProfilePoint } from '../types';
import { cumulativeDistances, interpolateAlong } from './geo';

const TILE_Z = 13;
const TILE_SIZE = 256;
const MAX_TILES = 300;

export const TERRARIUM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function tileUrl(z: number, x: number, y: number): string {
  return TERRARIUM_TILES.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

type TileData = ImageData | 'error';
const cache = new Map<string, TileData>();
const inflight = new Map<string, Promise<TileData>>();

function putTile(key: string, v: TileData) {
  if (cache.size >= MAX_TILES) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, v);
}

async function getTile(z: number, x: number, y: number): Promise<TileData> {
  const key = `${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let p = inflight.get(key);
  if (!p) {
    p = (async (): Promise<TileData> => {
      try {
        const res = await fetch(tileUrl(z, x, y));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = TILE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
        bmp.close();
        putTile(key, data);
        return data;
      } catch {
        putTile(key, 'error');
        return 'error';
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return p;
}

function decodePx(data: ImageData, x: number, y: number): number {
  const i = (y * TILE_SIZE + x) * 4;
  const d = data.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
}

function tileCoords(lngLat: LngLat, z: number) {
  const n = 2 ** z;
  const xf = ((lngLat[0] + 180) / 360) * n;
  const latRad = (lngLat[1] * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xf, yf, n };
}

/** Elevation in meters at a point (bilinear-interpolated), or null if unavailable. */
export async function elevationAt(lngLat: LngLat, z = TILE_Z): Promise<number | null> {
  const { xf, yf, n } = tileCoords(lngLat, z);
  if (yf < 0 || yf >= n) return null;
  const tx = Math.floor(xf);
  const ty = Math.floor(yf);
  const data = await getTile(z, ((tx % n) + n) % n, ty);
  if (data === 'error') return null;
  const pxf = Math.min(TILE_SIZE - 1, Math.max(0, (xf - tx) * TILE_SIZE - 0.5));
  const pyf = Math.min(TILE_SIZE - 1, Math.max(0, (yf - ty) * TILE_SIZE - 0.5));
  const x0 = Math.floor(pxf);
  const y0 = Math.floor(pyf);
  const x1 = Math.min(TILE_SIZE - 1, x0 + 1);
  const y1 = Math.min(TILE_SIZE - 1, y0 + 1);
  const fx = pxf - x0;
  const fy = pyf - y0;
  const e00 = decodePx(data, x0, y0);
  const e10 = decodePx(data, x1, y0);
  const e01 = decodePx(data, x0, y1);
  const e11 = decodePx(data, x1, y1);
  return (
    e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy
  );
}

/** Prefetch all tiles needed for a set of coordinates (bounded concurrency). */
async function prefetchTiles(coords: LngLat[], z: number): Promise<void> {
  const keys = new Set<string>();
  const jobs: [number, number, number][] = [];
  for (const c of coords) {
    const { xf, yf, n } = tileCoords(c, z);
    if (yf < 0 || yf >= n) continue;
    const tx = ((Math.floor(xf) % n) + n) % n;
    const ty = Math.floor(yf);
    const key = `${z}/${tx}/${ty}`;
    if (!keys.has(key) && !cache.has(key)) {
      keys.add(key);
      jobs.push([z, tx, ty]);
    }
  }
  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const j = jobs[idx++];
      await getTile(j[0], j[1], j[2]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
}

export async function elevationsFor(coords: LngLat[], z = TILE_Z): Promise<(number | null)[]> {
  await prefetchTiles(coords, z);
  return Promise.all(coords.map((c) => elevationAt(c, z)));
}

/** Sample a route geometry into an elevation profile with grade. */
export async function buildProfile(coords: LngLat[]): Promise<ProfilePoint[]> {
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const step = Math.max(8, total / 1200);
  const samples: LngLat[] = [];
  const dists: number[] = [];
  for (let d = 0; d < total; d += step) {
    samples.push(interpolateAlong(coords, cum, d));
    dists.push(d);
  }
  samples.push(coords[coords.length - 1]);
  dists.push(total);

  const raw = await elevationsFor(samples);
  // fill gaps from neighbors
  const eles = new Array<number>(raw.length);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] != null) last = raw[i]!;
    eles[i] = last;
  }
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] != null) last = raw[i]!;
    else eles[i] = eles[i] ?? last;
  }
  // light smoothing (moving average, window 5)
  const smooth = eles.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < eles.length) {
        sum += eles[j];
        n++;
      }
    }
    return sum / n;
  });

  const points: ProfilePoint[] = samples.map((s, i) => ({
    dist: dists[i],
    ele: smooth[i],
    grade: 0,
    lngLat: s,
  }));
  for (let i = 0; i < points.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(points.length - 1, i + 1);
    const dd = points[b].dist - points[a].dist;
    points[i].grade = dd > 0 ? (points[b].ele - points[a].ele) / dd : 0;
  }
  return points;
}
