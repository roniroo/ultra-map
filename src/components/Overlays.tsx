import { useEffect, useRef, useState } from 'react';
import {
  clearRoute,
  redo,
  requestFlyTo,
  setSnapMode,
  setTool,
  store,
  undo,
  useApp,
} from '../state/store';
import { fmtElevation } from '../lib/geo';

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  select: 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z',
  route:
    'M19 15.18V7c0-2.21-1.79-4-4-4s-4 1.79-4 4v10c0 1.1-.9 2-2 2s-2-.9-2-2V8.82C8.16 8.4 9 7.3 9 6c0-1.66-1.34-3-3-3S3 4.34 3 6c0 1.3.84 2.4 2 2.82V17c0 2.21 1.79 4 4 4s4-1.79 4-4V7c0-1.1.9-2 2-2s2 .9 2 2v8.18c-1.16.41-2 1.51-2 2.82 0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.3-.84-2.4-2-2.82z',
  pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  undo: 'M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62C8.77 11.26 10.54 10.5 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.97 7.22L3.9 16c1.05-3.19 4.06-5.5 7.6-5.5 1.96 0 3.73.76 5.12 1.88L13 16h9V7l-3.6 3.6z',
  trash:
    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
};

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const snapMode = useApp((s) => s.plan.snapMode);
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const hasRoute = useApp((s) => s.plan.anchors.length > 0);

  return (
    <div className="toolbar">
      <button
        className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
        onClick={() => setTool('select')}
        title="Select / pan (V)"
      >
        <Icon d={ICONS.select} />
      </button>
      <button
        className={`tool-btn ${tool === 'route' ? 'active' : ''}`}
        onClick={() => setTool('route')}
        title="Draw route — click map to add points (R)"
      >
        <Icon d={ICONS.route} />
      </button>
      <button
        className={`tool-btn ${tool === 'waypoint' ? 'active' : ''}`}
        onClick={() => setTool('waypoint')}
        title="Drop waypoint (W)"
      >
        <Icon d={ICONS.pin} />
      </button>
      <div className="toolbar-sep" />
      <button
        className={`snap-chip ${snapMode === 'snap' ? 'snap-on' : ''}`}
        onClick={() => setSnapMode(snapMode === 'snap' ? 'straight' : 'snap')}
        title="Toggle between snapping new legs to the trail network and straight lines"
      >
        {snapMode === 'snap' ? '🧲 Snap: trails' : '📐 Snap: off'}
      </button>
      <div className="toolbar-sep" />
      <button className="tool-btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        <Icon d={ICONS.undo} />
      </button>
      <button className="tool-btn" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        <Icon d={ICONS.redo} />
      </button>
      <button
        className="tool-btn tool-danger"
        onClick={() => {
          if (confirm('Clear the current route?')) clearRoute();
        }}
        disabled={!hasRoute}
        title="Clear route"
      >
        <Icon d={ICONS.trash} />
      </button>
    </div>
  );
}

interface SearchResult {
  name: string;
  detail: string;
  lngLat: [number, number];
}

export function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`
        );
        if (!res.ok) return;
        const j = await res.json();
        const out: SearchResult[] = (j.features ?? []).map((f: any) => {
          const p = f.properties ?? {};
          const detail = [p.city, p.state, p.country].filter(Boolean).join(', ');
          return {
            name: p.name ?? detail ?? 'Unknown',
            detail,
            lngLat: f.geometry.coordinates as [number, number],
          };
        });
        setResults(out);
        setOpen(true);
      } catch {
        /* search unavailable */
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query]);

  const choose = (r: SearchResult) => {
    requestFlyTo(r.lngLat, 13);
    setOpen(false);
    setQuery(r.name);
  };

  return (
    <div className="searchbox">
      <input
        value={query}
        placeholder="🔍  Search peaks, trailheads, towns…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results.length) choose(results[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={i} className="search-result" onMouseDown={() => choose(r)}>
              <span className="sr-name">{r.name}</span>
              {r.detail && <span className="sr-detail">{r.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TerrainButton() {
  const on = useApp((s) => s.terrain3d);
  return (
    <button
      className={`terrain-btn ${on ? 'active' : ''}`}
      title="Toggle 3D terrain"
      onClick={() => store.setState((s) => ({ terrain3d: !s.terrain3d }))}
    >
      3D
    </button>
  );
}

export function StatusBar() {
  const cursor = useApp((s) => s.cursor);
  const units = useApp((s) => s.units);
  if (!cursor) return null;
  return (
    <div className="statusbar">
      {cursor.lngLat[1].toFixed(5)}, {cursor.lngLat[0].toFixed(5)}
      {cursor.ele != null && <> · {fmtElevation(cursor.ele, units)}</>}
    </div>
  );
}

const TIP_KEY = 'ultramap.tip.dismissed';

export function HelpTip() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(TIP_KEY) === '1');
  if (dismissed) return null;
  return (
    <div className="help-tip">
      <b>Draw your route:</b> click the map to add points — legs snap to trails
      automatically. Right-click removes the last point, drag any dot to adjust.{' '}
      <b>R</b>/<b>W</b>/<b>V</b> switch tools.
      <button
        className="help-dismiss"
        onClick={() => {
          localStorage.setItem(TIP_KEY, '1');
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
