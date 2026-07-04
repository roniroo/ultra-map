import { useEffect, useRef } from 'react';
import MapView from './map/MapView';
import Sidebar from './components/Sidebar';
import { HelpTip, SearchBox, StatusBar, TerrainButton, Toolbar } from './components/Overlays';
import ElevationPanel from './components/ElevationPanel';
import {
  copyShareLink,
  exportGpx,
  importGpxText,
  loadFromHash,
  redo,
  saveTrip,
  setPlanName,
  setTool,
  setUnits,
  undo,
  useApp,
  store,
} from './state/store';

export default function App() {
  const units = useApp((s) => s.units);
  const planName = useApp((s) => s.plan.name);
  const busy = useApp((s) => s.routingBusy > 0 || s.profileBusy);
  const toasts = useApp((s) => s.toasts);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFromHash();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      switch (e.key.toLowerCase()) {
        case 'r':
          setTool('route');
          break;
        case 'w':
          setTool('waypoint');
          break;
        case 'v':
        case 'escape':
          setTool('select');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    await importGpxText(text, file.name);
  };

  return (
    <div className="app">
      <header className="header">
        <button
          className="icon-btn sidebar-toggle"
          title="Toggle sidebar"
          onClick={() => store.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))}
        >
          ☰
        </button>
        <div className="brand">
          <span className="brand-icon">⛰️</span>
          <span>
            Ultra<b>Map</b>
          </span>
        </div>
        <input
          className="plan-name"
          value={planName}
          placeholder="Name this adventure…"
          onChange={(e) => setPlanName(e.target.value)}
        />
        {busy && <div className="spinner" title="Working…" />}
        <div className="header-actions">
          <button className="btn" onClick={saveTrip} title="Save trip to this browser">
            Save
          </button>
          <button className="btn" onClick={copyShareLink} title="Copy a shareable link">
            Share
          </button>
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            title="Import a GPX track"
          >
            Import
          </button>
          <button className="btn" onClick={exportGpx} title="Export route + waypoints as GPX">
            GPX ↓
          </button>
          <button className="btn" onClick={() => window.print()} title="Print this map">
            Print
          </button>
          <button
            className="btn btn-units"
            onClick={() => setUnits(units === 'imperial' ? 'metric' : 'imperial')}
            title="Toggle units"
          >
            {units === 'imperial' ? 'mi · ft' : 'km · m'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,application/gpx+xml"
          hidden
          onChange={handleFile}
        />
      </header>
      <div className="body">
        {sidebarOpen && <Sidebar />}
        <main className="main">
          <MapView />
          <Toolbar />
          <SearchBox />
          <TerrainButton />
          <StatusBar />
          <HelpTip />
          <ElevationPanel />
        </main>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
