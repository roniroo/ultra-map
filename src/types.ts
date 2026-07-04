export type LngLat = [number, number]; // [lng, lat]

export type SegmentMode = 'snap' | 'straight';

export interface Segment {
  id: string;
  coords: LngLat[];
  mode: SegmentMode;
  pending?: boolean;
}

export interface Waypoint {
  id: string;
  lngLat: LngLat;
  name: string;
  icon: string;
  color: string;
  note: string;
}

export type Activity = 'hike' | 'run' | 'bike';
export type Tool = 'select' | 'route' | 'waypoint';
export type Units = 'imperial' | 'metric';

export interface Plan {
  name: string;
  anchors: LngLat[];
  segments: Segment[];
  waypoints: Waypoint[];
  activity: Activity;
  snapMode: SegmentMode;
}

export interface ProfilePoint {
  dist: number; // meters from start
  ele: number; // meters
  grade: number; // rise/run, e.g. 0.08 = 8%
  lngLat: LngLat;
}

export interface RouteStats {
  distance: number; // meters
  gain: number; // meters
  loss: number; // meters
  minEle: number;
  maxEle: number;
  movingTimeSec: number;
}

export interface Split {
  index: number; // 1-based split number
  dist: number; // meters in this split (may be partial for last)
  gain: number;
  loss: number;
  timeSec: number;
}

export interface SavedTrip {
  id: string;
  name: string;
  savedAt: number;
  plan: Plan;
  distance?: number;
  gain?: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface HoverPoint {
  lngLat: LngLat;
  dist: number;
  ele: number;
  grade: number;
}

export type SidebarTab = 'plan' | 'points' | 'layers' | 'weather' | 'trips';
