import { useSyncExternalStore } from 'react';
import type {
  Activity,
  HoverPoint,
  LngLat,
  Plan,
  ProfilePoint,
  RouteStats,
  SavedTrip,
  Segment,
  SegmentMode,
  SidebarTab,
  Toast,
  Tool,
  Units,
  Waypoint,
} from '../types';
import { computeStats, simplifyIndices, uid } from '../lib/geo';
import { buildProfile, elevationsFor } from '../lib/elevation';
import { fetchSnappedSegment } from '../lib/routing';
import { buildGpx, parseGpx } from '../lib/gpx';
import { createSharedPlan, fetchSharedPlan, supabaseConfigured } from '../lib/supabase';

export interface AppState {
  plan: Plan;
  tool: Tool;
  units: Units;
  baseLayer: string;
  overlays: { hillshade: boolean; hikingTrails: boolean; cyclingTrails: boolean };
  terrain3d: boolean;
  exaggeration: number;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  profile: ProfilePoint[] | null;
  stats: RouteStats | null;
  profileBusy: boolean;
  routingBusy: number;
  hoverPoint: HoverPoint | null;
  cursor: { lngLat: LngLat; ele: number | null } | null;
  selectedWaypointId: string | null;
  toasts: Toast[];
  trips: SavedTrip[];
  history: { past: Plan[]; future: Plan[] };
  viewCenter: LngLat;
  flyTo: { lngLat: LngLat; zoom?: number; token: number } | null;
  fitBounds: { bounds: [LngLat, LngLat]; token: number } | null;
}

export function emptyPlan(): Plan {
  return {
    name: '',
    anchors: [],
    segments: [],
    waypoints: [],
    activity: 'hike',
    snapMode: 'snap',
  };
}

const TRIPS_KEY = 'ultramap.trips.v1';

function loadTrips(): SavedTrip[] {
  try {
    const raw = localStorage.getItem(TRIPS_KEY);
    return raw ? (JSON.parse(raw) as SavedTrip[]) : [];
  } catch {
    return [];
  }
}

const initialState: AppState = {
  plan: emptyPlan(),
  tool: 'route',
  units: 'imperial',
  baseLayer: 'topo',
  overlays: { hillshade: false, hikingTrails: true, cyclingTrails: false },
  terrain3d: false,
  exaggeration: 1.4,
  sidebarTab: 'plan',
  sidebarOpen: true,
  profile: null,
  stats: null,
  profileBusy: false,
  routingBusy: 0,
  hoverPoint: null,
  cursor: null,
  selectedWaypointId: null,
  toasts: [],
  trips: loadTrips(),
  history: { past: [], future: [] },
  viewCenter: [-105.293, 39.998],
  flyTo: null,
  fitBounds: null,
};

type Listener = () => void;

class Store {
  private state: AppState = initialState;
  private listeners = new Set<Listener>();

  getState = (): AppState => this.state;

  setState = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const store = new Store();

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// ---------------- helpers ----------------

export function fullRouteCoords(plan: Plan): LngLat[] {
  const out: LngLat[] = [];
  for (const seg of plan.segments) {
    for (const c of seg.coords) {
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
    }
  }
  return out;
}

function clonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

function pushHistory() {
  const s = store.getState();
  store.setState({
    history: {
      past: [...s.history.past.slice(-49), clonePlan(s.plan)],
      future: [],
    },
  });
}

function setPlan(plan: Plan) {
  store.setState({ plan });
  afterRouteChange();
}

let toastId = 0;
export function notify(text: string, kind: 'info' | 'error' = 'info') {
  const id = ++toastId;
  store.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => {
    store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, 5000);
}

// ---------------- profile pipeline ----------------

let profTimer: ReturnType<typeof setTimeout> | undefined;
let profToken = 0;

export function afterRouteChange() {
  clearTimeout(profTimer);
  profTimer = setTimeout(runProfile, 300);
}

async function runProfile() {
  const token = ++profToken;
  const coords = fullRouteCoords(store.getState().plan);
  if (coords.length < 2) {
    store.setState({ profile: null, stats: null, profileBusy: false });
    return;
  }
  store.setState({ profileBusy: true });
  try {
    const profile = await buildProfile(coords);
    if (token !== profToken) return;
    const stats = computeStats(profile, store.getState().plan.activity);
    store.setState({ profile, stats, profileBusy: false });
  } catch {
    if (token === profToken) store.setState({ profileBusy: false });
  }
}

// ---------------- segment routing ----------------

function straightSegment(a: LngLat, b: LngLat, mode: SegmentMode = 'straight'): Segment {
  return { id: uid(), coords: [a, b], mode, pending: false };
}

async function resolveSegment(segId: string, a: LngLat, b: LngLat) {
  const activity = store.getState().plan.activity;
  store.setState((s) => ({ routingBusy: s.routingBusy + 1 }));
  try {
    const coords = await fetchSnappedSegment(a, b, activity);
    patchSegment(segId, { coords, pending: false, mode: 'snap' });
  } catch {
    patchSegment(segId, { pending: false, mode: 'straight' });
    notify('Trail routing unavailable for that leg — drew a straight line.', 'error');
  } finally {
    store.setState((s) => ({ routingBusy: s.routingBusy - 1 }));
  }
}

function patchSegment(segId: string, patch: Partial<Segment>) {
  const s = store.getState();
  const idx = s.plan.segments.findIndex((sg) => sg.id === segId);
  if (idx === -1) return; // segment was removed meanwhile
  const segments = [...s.plan.segments];
  segments[idx] = { ...segments[idx], ...patch };
  store.setState({ plan: { ...s.plan, segments } });
  afterRouteChange();
}

function makeSegment(a: LngLat, b: LngLat, mode: SegmentMode): Segment {
  const seg: Segment = { id: uid(), coords: [a, b], mode, pending: mode === 'snap' };
  if (mode === 'snap') void resolveSegment(seg.id, a, b);
  return seg;
}

// ---------------- route actions ----------------

export function addAnchorAt(lngLat: LngLat) {
  pushHistory();
  const s = store.getState();
  const plan = s.plan;
  const anchors = [...plan.anchors, lngLat];
  let segments = plan.segments;
  if (anchors.length > 1) {
    const a = anchors[anchors.length - 2];
    segments = [...segments, makeSegment(a, lngLat, plan.snapMode)];
  }
  setPlan({ ...plan, anchors, segments });
}

export function moveAnchor(i: number, lngLat: LngLat) {
  pushHistory();
  const s = store.getState();
  const plan = s.plan;
  const anchors = [...plan.anchors];
  anchors[i] = lngLat;
  const segments = [...plan.segments];
  if (i - 1 >= 0 && segments[i - 1]) {
    segments[i - 1] = makeSegment(anchors[i - 1], lngLat, segments[i - 1].mode);
  }
  if (segments[i]) {
    segments[i] = makeSegment(lngLat, anchors[i + 1], segments[i].mode);
  }
  setPlan({ ...plan, anchors, segments });
}

export function deleteAnchor(i: number) {
  const s = store.getState();
  const plan = s.plan;
  if (i < 0 || i >= plan.anchors.length) return;
  pushHistory();
  const anchors = plan.anchors.filter((_, k) => k !== i);
  let segments = [...plan.segments];
  if (plan.anchors.length <= 1) {
    segments = [];
  } else if (i === 0) {
    segments = segments.slice(1);
  } else if (i === plan.anchors.length - 1) {
    segments = segments.slice(0, -1);
  } else {
    const mode = segments[i - 1]?.mode ?? plan.snapMode;
    const merged = makeSegment(anchors[i - 1], anchors[i], mode);
    segments = [...segments.slice(0, i - 1), merged, ...segments.slice(i + 1)];
  }
  setPlan({ ...plan, anchors, segments });
}

export function removeLastAnchor() {
  const s = store.getState();
  deleteAnchor(s.plan.anchors.length - 1);
}

export function clearRoute() {
  const s = store.getState();
  if (s.plan.anchors.length === 0) return;
  pushHistory();
  setPlan({ ...s.plan, anchors: [], segments: [] });
}

export function reverseRoute() {
  const s = store.getState();
  if (s.plan.anchors.length < 2) return;
  pushHistory();
  const anchors = [...s.plan.anchors].reverse();
  const segments = [...s.plan.segments]
    .reverse()
    .map((sg) => ({ ...sg, coords: [...sg.coords].reverse() }));
  setPlan({ ...s.plan, anchors, segments });
}

export function closeLoop() {
  const s = store.getState();
  if (s.plan.anchors.length < 2) return;
  addAnchorAt(s.plan.anchors[0]);
}

export function outAndBack() {
  const s = store.getState();
  if (s.plan.anchors.length < 2) return;
  pushHistory();
  const plan = s.plan;
  const backAnchors = [...plan.anchors].reverse().slice(1);
  const backSegments = [...plan.segments]
    .reverse()
    .map((sg) => ({ ...sg, id: uid(), coords: [...sg.coords].reverse() }));
  setPlan({
    ...plan,
    anchors: [...plan.anchors, ...backAnchors],
    segments: [...plan.segments, ...backSegments],
  });
}

export function undo() {
  const s = store.getState();
  const past = [...s.history.past];
  const prev = past.pop();
  if (!prev) return;
  store.setState({
    history: { past, future: [clonePlan(s.plan), ...s.history.future.slice(0, 49)] },
  });
  setPlan(prev);
}

export function redo() {
  const s = store.getState();
  const future = [...s.history.future];
  const next = future.shift();
  if (!next) return;
  store.setState({
    history: { past: [...s.history.past, clonePlan(s.plan)], future },
  });
  setPlan(next);
}

export function setActivity(activity: Activity) {
  const s = store.getState();
  store.setState({ plan: { ...s.plan, activity } });
  const { profile } = store.getState();
  if (profile) store.setState({ stats: computeStats(profile, activity) });
}

export function setSnapMode(mode: SegmentMode) {
  const s = store.getState();
  store.setState({ plan: { ...s.plan, snapMode: mode } });
}

export function setPlanName(name: string) {
  const s = store.getState();
  store.setState({ plan: { ...s.plan, name } });
}

// ---------------- waypoints ----------------

const WAYPOINT_ICONS = ['📍', '⛺', '💧', '🚗', '🏔️', '📷', '⚠️', '🍔'];
const WAYPOINT_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#a78bfa'];

export function addWaypointAt(lngLat: LngLat) {
  pushHistory();
  const s = store.getState();
  const n = s.plan.waypoints.length;
  const wp: Waypoint = {
    id: uid(),
    lngLat,
    name: `Waypoint ${n + 1}`,
    icon: WAYPOINT_ICONS[n % WAYPOINT_ICONS.length],
    color: WAYPOINT_COLORS[n % WAYPOINT_COLORS.length],
    note: '',
  };
  store.setState({
    plan: { ...s.plan, waypoints: [...s.plan.waypoints, wp] },
    selectedWaypointId: wp.id,
    sidebarTab: 'points',
  });
}

export function updateWaypoint(id: string, patch: Partial<Waypoint>) {
  const s = store.getState();
  store.setState({
    plan: {
      ...s.plan,
      waypoints: s.plan.waypoints.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    },
  });
}

export function deleteWaypoint(id: string) {
  pushHistory();
  const s = store.getState();
  store.setState({
    plan: { ...s.plan, waypoints: s.plan.waypoints.filter((w) => w.id !== id) },
    selectedWaypointId: s.selectedWaypointId === id ? null : s.selectedWaypointId,
  });
}

export const waypointIcons = WAYPOINT_ICONS;
export const waypointColors = WAYPOINT_COLORS;

// ---------------- trips ----------------

function persistTrips(trips: SavedTrip[]) {
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  store.setState({ trips });
}

export function saveTrip() {
  const s = store.getState();
  if (s.plan.anchors.length < 2 && s.plan.waypoints.length === 0) {
    notify('Nothing to save yet — draw a route or drop a waypoint first.', 'error');
    return;
  }
  const name = s.plan.name.trim() || 'Untitled adventure';
  const existing = s.trips.find((t) => t.name === name);
  const trip: SavedTrip = {
    id: existing?.id ?? uid(),
    name,
    savedAt: Date.now(),
    plan: clonePlan({ ...s.plan, name }),
    distance: s.stats?.distance,
    gain: s.stats?.gain,
  };
  const trips = existing
    ? s.trips.map((t) => (t.id === existing.id ? trip : t))
    : [trip, ...s.trips];
  persistTrips(trips);
  store.setState({ plan: { ...s.plan, name } });
  notify(existing ? `Updated “${name}”.` : `Saved “${name}”.`);
}

export function loadTrip(id: string) {
  const s = store.getState();
  const trip = s.trips.find((t) => t.id === id);
  if (!trip) return;
  pushHistory();
  const plan = clonePlan(trip.plan);
  setPlan(plan);
  const coords = fullRouteCoords(plan);
  const all = [...coords, ...plan.waypoints.map((w) => w.lngLat)];
  if (all.length) requestFitBounds(all);
  notify(`Loaded “${trip.name}”.`);
}

export function deleteTrip(id: string) {
  const s = store.getState();
  persistTrips(s.trips.filter((t) => t.id !== id));
}

export function newPlan() {
  pushHistory();
  setPlan(emptyPlan());
  store.setState({ selectedWaypointId: null });
}

// ---------------- share link ----------------

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface SharePayload {
  v: 1;
  n: string;
  act: Activity;
  a: [number, number][];
  m: number[]; // 1 = snap, 0 = straight per segment
  w: { p: [number, number]; n: string; i: string; c: string; t: string }[];
}

function buildSharePayload(): SharePayload {
  const p = store.getState().plan;
  return {
    v: 1,
    n: p.name,
    act: p.activity,
    a: p.anchors.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
    m: p.segments.map((sg) => (sg.mode === 'snap' ? 1 : 0)),
    w: p.waypoints.map((w) => ({
      p: [+w.lngLat[0].toFixed(5), +w.lngLat[1].toFixed(5)],
      n: w.name,
      i: w.icon,
      c: w.color,
      t: w.note,
    })),
  };
}

function applySharePayload(payload: SharePayload) {
  const plan = emptyPlan();
  plan.name = payload.n ?? '';
  plan.activity = payload.act ?? 'hike';
  plan.anchors = (payload.a ?? []).map(([x, y]) => [x, y] as LngLat);
  plan.waypoints = (payload.w ?? []).map((w) => ({
    id: uid(),
    lngLat: [w.p[0], w.p[1]] as LngLat,
    name: w.n,
    icon: w.i,
    color: w.c,
    note: w.t,
  }));
  for (let i = 0; i + 1 < plan.anchors.length; i++) {
    const mode: SegmentMode = payload.m?.[i] === 1 ? 'snap' : 'straight';
    plan.segments.push(makeSegment(plan.anchors[i], plan.anchors[i + 1], mode));
  }
  setPlan(plan);
  const pts = [...plan.anchors, ...plan.waypoints.map((w) => w.lngLat)];
  if (pts.length) requestFitBounds(pts);
}

export async function copyShareLink() {
  const s = store.getState();
  if (s.plan.anchors.length < 2 && s.plan.waypoints.length === 0) {
    notify('Draw a route or add waypoints before sharing.', 'error');
    return;
  }
  const payload = buildSharePayload();
  let url: string | null = null;
  if (supabaseConfigured) {
    try {
      const id = await createSharedPlan(payload);
      url = `${location.origin}${location.pathname}#t=${id}`;
    } catch {
      url = null; // fall through to the self-contained link
    }
  }
  if (!url) {
    url = `${location.origin}${location.pathname}#plan=${b64urlEncode(JSON.stringify(payload))}`;
  }
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    notify('Share link copied to clipboard.');
  } catch {
    notify('Share link placed in the address bar.');
  }
}

export function loadFromHash(): boolean {
  const t = location.hash.match(/#t=([A-Za-z0-9_-]+)/);
  if (t) {
    void (async () => {
      try {
        applySharePayload((await fetchSharedPlan(t[1])) as SharePayload);
      } catch {
        notify('Could not load the shared plan.', 'error');
      }
    })();
    return true;
  }
  const m = location.hash.match(/#plan=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    applySharePayload(JSON.parse(b64urlDecode(m[1])) as SharePayload);
    return true;
  } catch {
    notify('Could not read the shared plan link.', 'error');
    return false;
  }
}

// ---------------- GPX ----------------

export async function importGpxText(text: string, fileName: string) {
  try {
    const parsed = parseGpx(text);
    pushHistory();
    const s = store.getState();
    const plan: Plan = {
      ...s.plan,
      name: s.plan.name || parsed.name || fileName.replace(/\.gpx$/i, ''),
      anchors: [],
      segments: [],
      waypoints: [
        ...s.plan.waypoints,
        ...parsed.waypoints.map((w, i) => ({
          id: uid(),
          lngLat: w.lngLat,
          name: w.name,
          icon: '📍',
          color: waypointColors[i % waypointColors.length],
          note: w.note,
        })),
      ],
    };
    if (parsed.track.length >= 2) {
      // keep imported geometry intact: anchors at simplified keypoints,
      // frozen "straight" segments holding the original track between them
      let tol = 0.0004;
      let idxs = simplifyIndices(parsed.track, tol);
      while (idxs.length > 40) {
        tol *= 2;
        idxs = simplifyIndices(parsed.track, tol);
      }
      plan.anchors = idxs.map((i) => parsed.track[i]);
      for (let k = 0; k + 1 < idxs.length; k++) {
        plan.segments.push({
          id: uid(),
          coords: parsed.track.slice(idxs[k], idxs[k + 1] + 1),
          mode: 'straight',
          pending: false,
        });
      }
    }
    setPlan(plan);
    const pts = [...fullRouteCoords(plan), ...plan.waypoints.map((w) => w.lngLat)];
    if (pts.length) requestFitBounds(pts);
    notify(
      parsed.track.length >= 2
        ? `Imported track from ${fileName} (${plan.anchors.length} editable points).`
        : `Imported ${parsed.waypoints.length} waypoints from ${fileName}.`
    );
  } catch (e) {
    notify(`GPX import failed: ${(e as Error).message}`, 'error');
  }
}

export async function exportGpx() {
  const s = store.getState();
  const coords = fullRouteCoords(s.plan);
  if (coords.length < 2 && s.plan.waypoints.length === 0) {
    notify('Nothing to export yet.', 'error');
    return;
  }
  const name = s.plan.name.trim() || 'UltraMap route';
  let eles: (number | null)[] | null = null;
  try {
    if (coords.length >= 2) eles = await elevationsFor(coords);
  } catch {
    eles = null;
  }
  const gpx = buildGpx(name, coords, eles, s.plan.waypoints);
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'route'}.gpx`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify('GPX downloaded.');
}

// ---------------- view / misc ----------------

let flyToken = 0;

export function requestFlyTo(lngLat: LngLat, zoom?: number) {
  store.setState({ flyTo: { lngLat, zoom, token: ++flyToken } });
}

export function requestFitBounds(pts: LngLat[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  store.setState({
    fitBounds: {
      bounds: [
        [minX, minY],
        [maxX, maxY],
      ],
      token: ++flyToken,
    },
  });
}

export function setTool(tool: Tool) {
  store.setState({ tool });
}

export function setUnits(units: Units) {
  store.setState({ units });
}

export function setHoverPoint(hp: HoverPoint | null) {
  store.setState({ hoverPoint: hp });
}
