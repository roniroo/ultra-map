# ⛰️ UltraMap

**Plan further.** A fast, modern web app for planning runs, hikes, rides and backcountry
trips — trail-snapping route drawing, instant elevation profiles, 3D terrain, weather,
GPX, and shareable links.

**Live: https://ultra-map.onrender.com**

## Run it locally

```bash
npm install
npm run dev        # → http://localhost:5173
```

Works with zero configuration. Optionally, create `.env.local` to enable short share
links (without it, sharing falls back to self-contained URLs):

```
VITE_SUPABASE_URL=https://ijtazxbzcxwcxjgxjxpz.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_9GuFqveiBUspiEmw2VPvPA_CdNtOIds
```

(The publishable key is safe to share — row-level security protects the data.)

## What it does

### Route planning
- **Trail-snapping drawing** — click the map; each leg routes along real trails/paths
  (Valhalla pedestrian/bicycle routing on OSM). Toggle to straight-line mode for
  off-trail travel. Mix both in one route.
- **Full editing** — drag any point to re-route just that section, right-click to delete
  points, undo/redo (⌘Z), reverse, close loop, out-and-back.
- **Grade-aware time estimates** — Tobler's hiking function over the actual elevation
  profile, scaled per activity (hike / run / bike), plus per-mile (or km) splits.
- **Distance markers** — automatic mile/km badges along the route.

### Terrain intelligence
- **Instant elevation profiles** — terrain tiles are decoded *in the browser*
  (AWS Open Data terrarium DEM), so profiles appear without any rate-limited elevation
  API. Grade-colored profile with hover sync between the chart and the map.
- **3D terrain** — one click tilts the map over real elevation data with adjustable
  exaggeration.
- **Hillshade overlay** and live cursor elevation readout.

### Maps & layers
- Base maps: OpenTopoMap, Esri satellite imagery, USGS topo, OSM streets, CyclOSM.
- Overlays: Waymarked Trails hiking + cycling networks, hillshade.

### Trip logistics
- **Waypoints** with icons, colors and notes (water sources, camps, bail-outs…).
- **5-day point forecast** at the route start, elevation-adjusted (Open-Meteo), with
  sunrise/sunset.
- **GPX import/export** (tracks import as editable routes; export includes elevation).
- **Short share links** — the Share button stores the plan in Supabase and copies a
  compact `#t=<id>` link. If Supabase is unconfigured or unreachable, it falls back to
  a self-contained `#plan=` URL; both formats open correctly forever.
- **Saved trips** in the browser, search (Photon), print view, imperial/metric.

## Keyboard

| Key | Action |
| --- | ------ |
| `R` | Route drawing tool |
| `W` | Waypoint tool |
| `V` / `Esc` | Select/pan tool |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| Right-click map | Remove last route point |

## Deployment

- **Hosting:** Render static site (free tier, global CDN, no cold starts). Pushing to
  `main` auto-deploys. Config lives in [render.yaml](render.yaml); the
  `VITE_SUPABASE_*` env vars are set on the Render service and baked in at build time.
- **Backend:** Supabase project (`ultra-map`, us-west-1) with a single `shared_plans`
  table for short links — schema in
  [supabase/migrations/0001_shared_plans.sql](supabase/migrations/0001_shared_plans.sql).
  RLS allows anonymous insert/read only; rows are immutable and payloads capped at
  100 KB.

See [HANDOFF.md](HANDOFF.md) for the full developer handoff.

## Data sources (all free, no keys)

| Source | Used for |
| ------ | -------- |
| [Valhalla @ FOSSGIS](https://valhalla.openstreetmap.de) | Trail-snapped routing |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Elevation profiles, 3D terrain, hillshade |
| [OpenTopoMap](https://opentopomap.org) / OSM / Esri / USGS / CyclOSM | Base maps |
| [Waymarked Trails](https://waymarkedtrails.org) | Trail network overlays |
| [Open-Meteo](https://open-meteo.com) | Weather + sunrise/sunset |
| [Photon (komoot)](https://photon.komoot.io) | Place search |
| [Supabase](https://supabase.com) | Short share links |

Please respect the usage policies of these community services for anything beyond
personal use.

## Stack

Vite · React · TypeScript · MapLibre GL JS. No other runtime dependencies — the
elevation decoder, GPX parser, polyline codec, chart, state store, and Supabase REST
client are hand-rolled.
