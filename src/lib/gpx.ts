import type { LngLat, Waypoint } from '../types';

export interface ParsedGpx {
  name: string | null;
  track: LngLat[];
  waypoints: { lngLat: LngLat; name: string; note: string }[];
}

export function parseGpx(text: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file');

  const name =
    doc.querySelector('trk > name')?.textContent ??
    doc.querySelector('metadata > name')?.textContent ??
    null;

  const readPts = (selector: string): LngLat[] => {
    const pts: LngLat[] = [];
    doc.querySelectorAll(selector).forEach((el) => {
      const lat = parseFloat(el.getAttribute('lat') ?? '');
      const lon = parseFloat(el.getAttribute('lon') ?? '');
      if (isFinite(lat) && isFinite(lon)) pts.push([lon, lat]);
    });
    return pts;
  };

  let track = readPts('trkpt');
  if (track.length === 0) track = readPts('rtept');

  const waypoints: ParsedGpx['waypoints'] = [];
  doc.querySelectorAll('wpt').forEach((el) => {
    const lat = parseFloat(el.getAttribute('lat') ?? '');
    const lon = parseFloat(el.getAttribute('lon') ?? '');
    if (!isFinite(lat) || !isFinite(lon)) return;
    waypoints.push({
      lngLat: [lon, lat],
      name: el.querySelector('name')?.textContent ?? 'Waypoint',
      note: el.querySelector('desc')?.textContent ?? '',
    });
  });

  return { name, track, waypoints };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildGpx(
  name: string,
  coords: LngLat[],
  eles: (number | null)[] | null,
  waypoints: Waypoint[]
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="UltraMap" xmlns="http://www.topografix.com/GPX/1/1">'
  );
  lines.push(`  <metadata><name>${esc(name)}</name></metadata>`);
  for (const w of waypoints) {
    lines.push(
      `  <wpt lat="${w.lngLat[1].toFixed(6)}" lon="${w.lngLat[0].toFixed(6)}">` +
        `<name>${esc(w.name)}</name>` +
        (w.note ? `<desc>${esc(w.note)}</desc>` : '') +
        `</wpt>`
    );
  }
  if (coords.length > 1) {
    lines.push(`  <trk><name>${esc(name)}</name><trkseg>`);
    coords.forEach((c, i) => {
      const ele = eles?.[i];
      lines.push(
        `    <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">` +
          (ele != null ? `<ele>${ele.toFixed(1)}</ele>` : '') +
          `</trkpt>`
      );
    });
    lines.push('  </trkseg></trk>');
  }
  lines.push('</gpx>');
  return lines.join('\n');
}
