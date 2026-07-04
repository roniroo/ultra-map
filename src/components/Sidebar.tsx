import { useEffect, useMemo, useState } from 'react';
import type { Activity, SidebarTab } from '../types';
import {
  closeLoop,
  deleteTrip,
  deleteWaypoint,
  loadTrip,
  newPlan,
  outAndBack,
  requestFlyTo,
  reverseRoute,
  saveTrip,
  setActivity,
  store,
  updateWaypoint,
  useApp,
  waypointColors,
  waypointIcons,
} from '../state/store';
import {
  ACTIVITY_LABEL,
  computeSplits,
  fmtDistance,
  fmtDuration,
  fmtElevation,
  splitUnitMeters,
} from '../lib/geo';
import { BASE_LAYERS } from '../map/layers';
import { fetchForecast, weatherIcon, weatherLabel, type Forecast } from '../lib/weather';

const TABS: { id: SidebarTab; label: string; icon: string }[] = [
  { id: 'plan', label: 'Plan', icon: '🧭' },
  { id: 'points', label: 'Points', icon: '📍' },
  { id: 'layers', label: 'Layers', icon: '🗺️' },
  { id: 'weather', label: 'Weather', icon: '🌤️' },
  { id: 'trips', label: 'Trips', icon: '💾' },
];

export default function Sidebar() {
  const tab = useApp((s) => s.sidebarTab);
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => store.setState({ sidebarTab: t.id })}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="panel">
        {tab === 'plan' && <PlanPanel />}
        {tab === 'points' && <PointsPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'weather' && <WeatherPanel />}
        {tab === 'trips' && <TripsPanel />}
      </div>
    </aside>
  );
}

// ---------------- Plan ----------------

function PlanPanel() {
  const plan = useApp((s) => s.plan);
  const stats = useApp((s) => s.stats);
  const profile = useApp((s) => s.profile);
  const units = useApp((s) => s.units);

  const splits = useMemo(
    () =>
      profile ? computeSplits(profile, plan.activity, splitUnitMeters(units)) : [],
    [profile, plan.activity, units]
  );

  const hasRoute = plan.anchors.length >= 2;

  return (
    <div className="panel-inner">
      <h3>Activity</h3>
      <div className="segmented">
        {(['hike', 'run', 'bike'] as Activity[]).map((a) => (
          <button
            key={a}
            className={plan.activity === a ? 'active' : ''}
            onClick={() => setActivity(a)}
          >
            {a === 'hike' ? '🥾' : a === 'run' ? '🏃' : '🚴'} {ACTIVITY_LABEL[a]}
          </button>
        ))}
      </div>

      <h3>Route tools</h3>
      <div className="btn-grid">
        <button className="btn" onClick={reverseRoute} disabled={!hasRoute}>
          ⇄ Reverse
        </button>
        <button className="btn" onClick={closeLoop} disabled={!hasRoute}>
          ↻ Close loop
        </button>
        <button className="btn" onClick={outAndBack} disabled={!hasRoute}>
          ⇤⇥ Out & back
        </button>
        <button className="btn" onClick={saveTrip} disabled={!hasRoute && plan.waypoints.length === 0}>
          💾 Save trip
        </button>
      </div>

      {!hasRoute && (
        <div className="empty-hint">
          <p>
            <b>Start planning:</b> with the route tool active, click anywhere on the map.
            Each new point routes along trails and paths automatically (toggle{' '}
            <i>Snap</i> in the toolbar for straight lines — handy off-trail).
          </p>
          <p>
            Import a GPX from the header, or search for a trailhead to get somewhere fast.
          </p>
        </div>
      )}

      {stats && (
        <>
          <h3>Stats</h3>
          <div className="stats-grid">
            <Stat label="Distance" value={fmtDistance(stats.distance, units)} />
            <Stat label="Est. time" value={fmtDuration(stats.movingTimeSec)} />
            <Stat label="Gain" value={`↑ ${fmtElevation(stats.gain, units)}`} />
            <Stat label="Loss" value={`↓ ${fmtElevation(stats.loss, units)}`} />
            <Stat label="High" value={fmtElevation(stats.maxEle, units)} />
            <Stat label="Low" value={fmtElevation(stats.minEle, units)} />
          </div>
          <p className="fine-print">
            Time uses Tobler's hiking function (slope-aware), scaled for{' '}
            {ACTIVITY_LABEL[plan.activity].toLowerCase()} pace.
          </p>
        </>
      )}

      {splits.length > 0 && (
        <>
          <h3>Splits ({units === 'imperial' ? 'miles' : 'km'})</h3>
          <table className="splits">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>↑</th>
                <th>↓</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((sp) => (
                <tr key={sp.index}>
                  <td>{sp.index}</td>
                  <td>{fmtDuration(sp.timeSec)}</td>
                  <td>{fmtElevation(sp.gain, units)}</td>
                  <td>{fmtElevation(sp.loss, units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ---------------- Points ----------------

function PointsPanel() {
  const waypoints = useApp((s) => s.plan.waypoints);
  const selId = useApp((s) => s.selectedWaypointId);
  const selected = waypoints.find((w) => w.id === selId) ?? null;

  return (
    <div className="panel-inner">
      <h3>Waypoints</h3>
      {waypoints.length === 0 && (
        <div className="empty-hint">
          <p>
            Drop waypoints for trailheads, water sources, camps, bail-out points… Pick the
            waypoint tool (<b>W</b>) and click the map.
          </p>
        </div>
      )}
      <div className="wp-list">
        {waypoints.map((w) => (
          <button
            key={w.id}
            className={`wp-item ${selId === w.id ? 'active' : ''}`}
            onClick={() => {
              store.setState({ selectedWaypointId: w.id });
              requestFlyTo(w.lngLat);
            }}
          >
            <span className="wp-icon" style={{ borderColor: w.color }}>
              {w.icon}
            </span>
            <span className="wp-name">{w.name}</span>
            <span className="wp-coords">
              {w.lngLat[1].toFixed(4)}, {w.lngLat[0].toFixed(4)}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="wp-editor">
          <h3>Edit waypoint</h3>
          <input
            className="input"
            value={selected.name}
            onChange={(e) => updateWaypoint(selected.id, { name: e.target.value })}
          />
          <div className="icon-row">
            {waypointIcons.map((ic) => (
              <button
                key={ic}
                className={`icon-choice ${selected.icon === ic ? 'active' : ''}`}
                onClick={() => updateWaypoint(selected.id, { icon: ic })}
              >
                {ic}
              </button>
            ))}
          </div>
          <div className="icon-row">
            {waypointColors.map((c) => (
              <button
                key={c}
                className={`color-choice ${selected.color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => updateWaypoint(selected.id, { color: c })}
              />
            ))}
          </div>
          <textarea
            className="input"
            rows={3}
            placeholder="Notes (water report, permit info, hazards…)"
            value={selected.note}
            onChange={(e) => updateWaypoint(selected.id, { note: e.target.value })}
          />
          <div className="btn-grid">
            <button className="btn" onClick={() => requestFlyTo(selected.lngLat, 14.5)}>
              ✈ Fly to
            </button>
            <button className="btn btn-danger" onClick={() => deleteWaypoint(selected.id)}>
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Layers ----------------

function LayersPanel() {
  const baseLayer = useApp((s) => s.baseLayer);
  const overlays = useApp((s) => s.overlays);
  const terrain3d = useApp((s) => s.terrain3d);
  const exaggeration = useApp((s) => s.exaggeration);

  return (
    <div className="panel-inner">
      <h3>Base map</h3>
      <div className="layer-list">
        {BASE_LAYERS.map((b) => (
          <label key={b.id} className={`layer-item ${baseLayer === b.id ? 'active' : ''}`}>
            <input
              type="radio"
              name="base"
              checked={baseLayer === b.id}
              onChange={() => store.setState({ baseLayer: b.id })}
            />
            <span>
              <span className="layer-name">{b.name}</span>
              <span className="layer-desc">{b.description}</span>
            </span>
          </label>
        ))}
      </div>

      <h3>Overlays</h3>
      <label className="check-item">
        <input
          type="checkbox"
          checked={overlays.hikingTrails}
          onChange={(e) =>
            store.setState((s) => ({
              overlays: { ...s.overlays, hikingTrails: e.target.checked },
            }))
          }
        />
        <span>
          <span className="layer-name">Hiking trails</span>
          <span className="layer-desc">Marked routes from Waymarked Trails</span>
        </span>
      </label>
      <label className="check-item">
        <input
          type="checkbox"
          checked={overlays.cyclingTrails}
          onChange={(e) =>
            store.setState((s) => ({
              overlays: { ...s.overlays, cyclingTrails: e.target.checked },
            }))
          }
        />
        <span>
          <span className="layer-name">Cycling routes</span>
          <span className="layer-desc">Marked routes from Waymarked Trails</span>
        </span>
      </label>
      <label className="check-item">
        <input
          type="checkbox"
          checked={overlays.hillshade}
          onChange={(e) =>
            store.setState((s) => ({
              overlays: { ...s.overlays, hillshade: e.target.checked },
            }))
          }
        />
        <span>
          <span className="layer-name">Hillshade</span>
          <span className="layer-desc">Terrain relief shading (great on Streets/Satellite)</span>
        </span>
      </label>

      <h3>3D terrain</h3>
      <label className="check-item">
        <input
          type="checkbox"
          checked={terrain3d}
          onChange={(e) => store.setState({ terrain3d: e.target.checked })}
        />
        <span>
          <span className="layer-name">Enable 3D</span>
          <span className="layer-desc">Tilt the map over real elevation data</span>
        </span>
      </label>
      {terrain3d && (
        <div className="slider-row">
          <span className="layer-desc">Exaggeration {exaggeration.toFixed(1)}×</span>
          <input
            type="range"
            min={1}
            max={2.5}
            step={0.1}
            value={exaggeration}
            onChange={(e) => store.setState({ exaggeration: parseFloat(e.target.value) })}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- Weather ----------------

function WeatherPanel() {
  const units = useApp((s) => s.units);
  const anchors = useApp((s) => s.plan.anchors);
  const viewCenter = useApp((s) => s.viewCenter);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const point = anchors[0] ?? viewCenter;
  const key = `${point[0].toFixed(2)},${point[1].toFixed(2)},${units}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const [lng, lat] = key.split(',').map(Number);
    fetchForecast([lng, lat], units)
      .then((f) => {
        if (!cancelled) setForecast(f);
      })
      .catch(() => {
        if (!cancelled) setError('Weather is unavailable right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tempUnit = units === 'imperial' ? '°F' : '°C';
  const windUnit = units === 'imperial' ? 'mph' : 'km/h';
  const precipUnit = units === 'imperial' ? 'in' : 'mm';

  return (
    <div className="panel-inner">
      <h3>Forecast {anchors.length ? 'at route start' : 'at map center'}</h3>
      {forecast && (
        <p className="fine-print">
          Point forecast adjusted for terrain elevation ({fmtElevation(forecast.elevation, units)}).
          Data: Open-Meteo.
        </p>
      )}
      {loading && <p className="fine-print">Loading forecast…</p>}
      {error && <p className="fine-print">{error}</p>}
      {forecast && (
        <div className="wx-list">
          {forecast.daily.map((d) => (
            <div key={d.date} className="wx-day">
              <div className="wx-head">
                <span className="wx-icon">{weatherIcon(d.code)}</span>
                <span className="wx-date">
                  {new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="wx-label">{weatherLabel(d.code)}</span>
              </div>
              <div className="wx-row">
                <span>
                  {Math.round(d.tMax)}
                  {tempUnit} / {Math.round(d.tMin)}
                  {tempUnit}
                </span>
                <span>💧 {Math.round(d.precipProbMax)}%</span>
                <span>
                  {d.precipSum > 0 ? `${d.precipSum.toFixed(2)} ${precipUnit}` : '—'}
                </span>
                <span>💨 {Math.round(d.windMax)} {windUnit}</span>
              </div>
              <div className="wx-row wx-sun">
                <span>
                  🌅{' '}
                  {new Date(d.sunrise).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span>
                  🌇{' '}
                  {new Date(d.sunset).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Trips ----------------

function TripsPanel() {
  const trips = useApp((s) => s.trips);
  const units = useApp((s) => s.units);

  return (
    <div className="panel-inner">
      <div className="btn-grid">
        <button className="btn" onClick={saveTrip}>
          💾 Save current
        </button>
        <button className="btn" onClick={newPlan}>
          ✨ New plan
        </button>
      </div>
      <h3>Saved trips</h3>
      {trips.length === 0 && (
        <div className="empty-hint">
          <p>
            Saved trips live in this browser — name your plan in the header and hit{' '}
            <b>Save</b>. Use <b>Share</b> for a link that works anywhere.
          </p>
        </div>
      )}
      <div className="trip-list">
        {trips.map((t) => (
          <div key={t.id} className="trip-item">
            <div className="trip-info">
              <span className="trip-name">{t.name}</span>
              <span className="trip-meta">
                {t.distance != null && <>{fmtDistance(t.distance, units)} · </>}
                {t.gain != null && <>↑ {fmtElevation(t.gain, units)} · </>}
                {new Date(t.savedAt).toLocaleDateString()}
              </span>
            </div>
            <button className="btn btn-small" onClick={() => loadTrip(t.id)}>
              Load
            </button>
            <button
              className="btn btn-small btn-danger"
              onClick={() => {
                if (confirm(`Delete “${t.name}”?`)) deleteTrip(t.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
