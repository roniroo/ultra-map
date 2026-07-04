import type { StyleSpecification } from 'maplibre-gl';
import { TERRARIUM_TILES } from '../lib/elevation';

export interface BaseLayerDef {
  id: string;
  name: string;
  description: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
}

export const BASE_LAYERS: BaseLayerDef[] = [
  {
    id: 'topo',
    name: 'Topo',
    description: 'OpenTopoMap — contours, shading, trails',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    maxzoom: 17,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
  {
    id: 'sat',
    name: 'Satellite',
    description: 'Esri World Imagery',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'usgs',
    name: 'USGS Topo',
    description: 'US National Map topographic (US only)',
    tiles: [
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    ],
    maxzoom: 16,
    attribution: 'USGS The National Map',
  },
  {
    id: 'osm',
    name: 'Streets',
    description: 'OpenStreetMap standard',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'cyclosm',
    name: 'CyclOSM',
    description: 'Cycling-focused OSM rendering',
    tiles: [
      'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    ],
    maxzoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.cyclosm.org">CyclOSM</a>',
  },
];

export const ROUTE_COLOR = '#ff3b6b';
export const ROUTE_PENDING_COLOR = '#94a3b8';

export function buildStyle(state: {
  baseLayer: string;
  overlays: { hillshade: boolean; hikingTrails: boolean; cyclingTrails: boolean };
}): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': '#0b0f14' },
      },
    ],
  };

  for (const base of BASE_LAYERS) {
    style.sources[`base-${base.id}`] = {
      type: 'raster',
      tiles: base.tiles,
      tileSize: 256,
      maxzoom: base.maxzoom,
      attribution: base.attribution,
    };
    style.layers.push({
      id: `base-${base.id}`,
      type: 'raster',
      source: `base-${base.id}`,
      layout: { visibility: state.baseLayer === base.id ? 'visible' : 'none' },
    });
  }

  // trail overlays (Waymarked Trails)
  style.sources['overlay-hiking'] = {
    type: 'raster',
    tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 18,
    attribution: '© <a href="https://waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)',
  };
  style.layers.push({
    id: 'overlay-hiking',
    type: 'raster',
    source: 'overlay-hiking',
    layout: { visibility: state.overlays.hikingTrails ? 'visible' : 'none' },
    paint: { 'raster-opacity': 0.85 },
  });
  style.sources['overlay-cycling'] = {
    type: 'raster',
    tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 18,
    attribution: '© <a href="https://waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)',
  };
  style.layers.push({
    id: 'overlay-cycling',
    type: 'raster',
    source: 'overlay-cycling',
    layout: { visibility: state.overlays.cyclingTrails ? 'visible' : 'none' },
    paint: { 'raster-opacity': 0.85 },
  });

  // DEM sources: one for hillshade, one for 3D terrain
  style.sources['hillshade-dem'] = {
    type: 'raster-dem',
    tiles: [TERRARIUM_TILES],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution: 'Terrain: Mapzen/AWS Open Data',
  };
  style.sources['terrain-dem'] = {
    type: 'raster-dem',
    tiles: [TERRARIUM_TILES],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
  };
  style.layers.push({
    id: 'hillshade',
    type: 'hillshade',
    source: 'hillshade-dem',
    layout: { visibility: state.overlays.hillshade ? 'visible' : 'none' },
    paint: {
      'hillshade-exaggeration': 0.45,
      'hillshade-shadow-color': '#2f2f3a',
    },
  });

  // route + hover sources (data filled in at runtime)
  style.sources['route'] = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  };
  style.layers.push(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      filter: ['!=', ['get', 'pending'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 6.5, 'line-opacity': 0.9 },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      filter: ['!=', ['get', 'pending'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': 3.5 },
    },
    {
      id: 'route-pending',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'pending'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_PENDING_COLOR,
        'line-width': 3,
        'line-dasharray': [1.5, 1.5],
      },
    }
  );

  return style;
}
