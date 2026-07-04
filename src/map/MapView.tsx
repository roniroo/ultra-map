import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle } from './layers';
import { store, type AppState } from '../state/store';
import {
  addAnchorAt,
  addWaypointAt,
  deleteAnchor,
  moveAnchor,
  removeLastAnchor,
  updateWaypoint,
} from '../state/store';
import { elevationAt } from '../lib/elevation';
import { cumulativeDistances, interpolateAlong } from '../lib/geo';
import { fullRouteCoords } from '../state/store';
import type { LngLat } from '../types';

const DEFAULT_CENTER: LngLat = [-105.293, 39.998]; // Boulder, CO — Flatirons trails
const DEFAULT_ZOOM = 12.2;

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const initial = store.getState();
    const map = new maplibregl.Map({
      container,
      style: buildStyle(initial),
      center: initial.viewCenter ?? DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    (window as unknown as { __map?: maplibregl.Map }).__map = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );
    const scale = new maplibregl.ScaleControl({ unit: initial.units, maxWidth: 120 });
    map.addControl(scale, 'bottom-left');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');

    let loaded = false;
    let anchorMarkers: maplibregl.Marker[] = [];
    let waypointMarkers = new Map<string, maplibregl.Marker>();
    let distanceMarkers: maplibregl.Marker[] = [];
    let hoverMarker: maplibregl.Marker | null = null;

    // ---------- sync helpers ----------

    const syncBase = (s: AppState) => {
      for (const layerId of [
        'base-topo',
        'base-sat',
        'base-usgs',
        'base-osm',
        'base-cyclosm',
      ]) {
        map.setLayoutProperty(
          layerId,
          'visibility',
          layerId === `base-${s.baseLayer}` ? 'visible' : 'none'
        );
      }
    };

    const syncOverlays = (s: AppState) => {
      map.setLayoutProperty(
        'overlay-hiking',
        'visibility',
        s.overlays.hikingTrails ? 'visible' : 'none'
      );
      map.setLayoutProperty(
        'overlay-cycling',
        'visibility',
        s.overlays.cyclingTrails ? 'visible' : 'none'
      );
      map.setLayoutProperty(
        'hillshade',
        'visibility',
        s.overlays.hillshade ? 'visible' : 'none'
      );
    };

    const syncTerrain = (s: AppState) => {
      if (s.terrain3d) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: s.exaggeration });
        if (map.getPitch() < 20) map.easeTo({ pitch: 62, duration: 800 });
      } else {
        map.setTerrain(null);
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
      }
    };

    const syncRoute = (s: AppState) => {
      const src = map.getSource('route') as GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: s.plan.segments.map((seg) => ({
          type: 'Feature',
          properties: { pending: seg.pending === true },
          geometry: { type: 'LineString', coordinates: seg.coords },
        })),
      });
    };

    const syncAnchors = (s: AppState) => {
      anchorMarkers.forEach((m) => m.remove());
      anchorMarkers = [];
      const n = s.plan.anchors.length;
      s.plan.anchors.forEach((a, i) => {
        const el = document.createElement('div');
        el.className =
          'anchor-dot' + (i === 0 ? ' anchor-start' : i === n - 1 ? ' anchor-end' : '');
        el.title =
          i === 0
            ? 'Start — drag to move, right-click to delete'
            : 'Drag to move, right-click to delete';
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteAnchor(i);
        });
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(a)
          .addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          moveAnchor(i, [p.lng, p.lat]);
        });
        anchorMarkers.push(marker);
      });
    };

    const syncWaypoints = (s: AppState) => {
      const seen = new Set<string>();
      for (const w of s.plan.waypoints) {
        seen.add(w.id);
        let marker = waypointMarkers.get(w.id);
        if (!marker) {
          const el = document.createElement('div');
          el.className = 'wp-marker';
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            store.setState({ selectedWaypointId: w.id, sidebarTab: 'points', sidebarOpen: true });
          });
          marker = new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat(w.lngLat)
            .addTo(map);
          const id = w.id;
          marker.on('dragend', () => {
            const p = marker!.getLngLat();
            updateWaypoint(id, { lngLat: [p.lng, p.lat] });
          });
          waypointMarkers.set(w.id, marker);
        }
        marker.setLngLat(w.lngLat);
        const el = marker.getElement();
        el.textContent = w.icon;
        el.title = w.name;
        el.style.borderColor = w.color;
        el.classList.toggle('wp-selected', s.selectedWaypointId === w.id);
      }
      for (const [id, marker] of waypointMarkers) {
        if (!seen.has(id)) {
          marker.remove();
          waypointMarkers.delete(id);
        }
      }
    };

    const syncDistanceMarkers = (s: AppState) => {
      distanceMarkers.forEach((m) => m.remove());
      distanceMarkers = [];
      const coords = fullRouteCoords(s.plan);
      if (coords.length < 2) return;
      const cum = cumulativeDistances(coords);
      const total = cum[cum.length - 1];
      const unit = s.units === 'imperial' ? 1609.344 : 1000;
      const count = Math.floor(total / unit);
      if (count < 1 || count > 250) return;
      for (let k = 1; k <= count; k++) {
        const pt = interpolateAlong(coords, cum, k * unit);
        const el = document.createElement('div');
        el.className = 'dist-marker';
        el.textContent = String(k);
        distanceMarkers.push(
          new maplibregl.Marker({ element: el }).setLngLat(pt).addTo(map)
        );
      }
    };

    const syncHover = (s: AppState) => {
      if (s.hoverPoint) {
        if (!hoverMarker) {
          const el = document.createElement('div');
          el.className = 'hover-dot';
          hoverMarker = new maplibregl.Marker({ element: el }).setLngLat(
            s.hoverPoint.lngLat
          );
        }
        hoverMarker.setLngLat(s.hoverPoint.lngLat).addTo(map);
      } else if (hoverMarker) {
        hoverMarker.remove();
      }
    };

    const syncCursorClass = (s: AppState) => {
      container.classList.toggle('tool-draw', s.tool !== 'select');
    };

    const syncAll = (s: AppState) => {
      syncBase(s);
      syncOverlays(s);
      syncTerrain(s);
      syncRoute(s);
      syncAnchors(s);
      syncWaypoints(s);
      syncDistanceMarkers(s);
      syncHover(s);
      syncCursorClass(s);
    };

    // ---------- store subscription (diffed) ----------

    let prev = store.getState();
    const unsubscribe = store.subscribe(() => {
      const s = store.getState();
      if (!loaded) {
        prev = s;
        return;
      }
      if (s.baseLayer !== prev.baseLayer) syncBase(s);
      if (s.overlays !== prev.overlays) syncOverlays(s);
      if (s.terrain3d !== prev.terrain3d || s.exaggeration !== prev.exaggeration)
        syncTerrain(s);
      if (s.plan.segments !== prev.plan.segments) syncRoute(s);
      if (s.plan.anchors !== prev.plan.anchors) syncAnchors(s);
      if (
        s.plan.waypoints !== prev.plan.waypoints ||
        s.selectedWaypointId !== prev.selectedWaypointId
      )
        syncWaypoints(s);
      if (s.plan.segments !== prev.plan.segments || s.units !== prev.units) {
        syncDistanceMarkers(s);
        scale.setUnit(s.units === 'imperial' ? 'imperial' : 'metric');
      }
      if (s.hoverPoint !== prev.hoverPoint) syncHover(s);
      if (s.tool !== prev.tool) syncCursorClass(s);
      if (s.flyTo && s.flyTo !== prev.flyTo) {
        map.flyTo({ center: s.flyTo.lngLat, zoom: s.flyTo.zoom ?? 13.5, duration: 1600 });
      }
      if (s.fitBounds && s.fitBounds !== prev.fitBounds) {
        map.fitBounds(s.fitBounds.bounds, { padding: 80, maxZoom: 14.5, duration: 1200 });
      }
      prev = s;
    });

    map.on('load', () => {
      loaded = true;
      map.resize();
      const s = store.getState();
      syncAll(s);
      // apply any view request made before the map finished loading
      // (e.g. opening a share link or restoring a trip on startup)
      if (s.fitBounds) {
        map.fitBounds(s.fitBounds.bounds, { padding: 80, maxZoom: 14.5, duration: 0 });
      } else if (s.flyTo) {
        map.jumpTo({ center: s.flyTo.lngLat, zoom: s.flyTo.zoom ?? 13.5 });
      }
    });

    // keep the canvas matched to the container (sidebar toggle, window resize,
    // and the 0-sized-at-construction case maplibre's own observer can miss)
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    // ---------- interactions ----------

    map.on('click', (e) => {
      const s = store.getState();
      if (s.tool === 'route') {
        addAnchorAt([e.lngLat.lng, e.lngLat.lat]);
      } else if (s.tool === 'waypoint') {
        addWaypointAt([e.lngLat.lng, e.lngLat.lat]);
      }
    });

    map.on('contextmenu', (e) => {
      const s = store.getState();
      if (s.tool === 'route' && s.plan.anchors.length > 0) {
        e.preventDefault();
        removeLastAnchor();
      }
    });

    let cursorTimer: ReturnType<typeof setTimeout> | undefined;
    map.on('mousemove', (e) => {
      if (cursorTimer) return;
      cursorTimer = setTimeout(async () => {
        cursorTimer = undefined;
        const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
        store.setState({ cursor: { lngLat, ele: null } });
        const ele = await elevationAt(lngLat);
        const cur = store.getState().cursor;
        if (cur && cur.lngLat[0] === lngLat[0] && cur.lngLat[1] === lngLat[1]) {
          store.setState({ cursor: { lngLat, ele } });
        }
      }, 120);
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      store.setState({ viewCenter: [c.lng, c.lat] });
    });

    return () => {
      ro.disconnect();
      unsubscribe();
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="map-container" />;
}
