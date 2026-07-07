# UltraMap — Developer Handoff

Last updated: July 2026. State: **live and working end-to-end.**

## What this is

A client-side trip-planning map (runs / hikes / rides) with one small backend table
for short share links. Think "CalTopo/onX web planner, but fast, free, and no login."

| Thing | Where |
| ----- | ----- |
| Live app | https://ultra-map.onrender.com |
| Repo | https://github.com/roniroo/ultra-map (`main` auto-deploys) |
| Hosting | Render **static site** `ultra-map` (`srv-d966dmtckfvc73etn5n0`), workspace "Get A Head" |
| Backend | Supabase project `ultra-map` (`ijtazxbzcxwcxjgxjxpz`), us-west-1, org "Get A Head Studio" |
| Cost | Render: $0 · Supabase: $10/mo compute (offset by Pro plan's $10/mo credit) |

## Architecture in one paragraph

Everything runs in the browser. MapLibre GL renders raster base maps and a
raster-DEM terrain source; routing legs are fetched from the public FOSSGIS Valhalla
instance; elevation is sampled by fetching terrarium-encoded PNG tiles and decoding
pixels client-side; weather comes from Open-Meteo; search from Photon. There is no
server of ours anywhere except one Supabase table (`shared_plans`) that maps a short
random id → plan JSON so share links are compact. If that table is unreachable, the
app degrades to fully-self-contained links. Nothing requires an account or API key.

## Codebase map (~2,900 lines, no runtime deps beyond react + maplibre-gl)

```
src/
  main.tsx                 entry; no StrictMode (see Gotchas)
  App.tsx                  header, keyboard shortcuts, GPX file input, toasts, layout
  types.ts                 all shared types (Plan, Segment, Waypoint, ProfilePoint…)
  state/store.ts           THE hub: tiny pub/sub store + useApp() hook + every action
                           (route editing, undo history, waypoints, trips, share
                           links, GPX import/export) + share payload codec
  map/MapView.tsx          the only file that touches maplibre. Subscribes to the
                           store, diffs prev vs next state, syncs layers/markers.
                           All map interactions (click-to-add, drag anchors,
                           right-click delete) live here.
  map/layers.ts            base layer + overlay + route layer definitions (style JSON)
  components/Sidebar.tsx   Plan / Points / Layers / Weather / Trips panels
  components/Overlays.tsx  floating toolbar, search box, 3D button, status bar, help tip
  components/ElevationPanel.tsx  stats chips + hand-rolled SVG grade-colored chart
  lib/geo.ts               haversine, polyline6 decoder, Douglas-Peucker, Tobler speed,
                           stats/splits, formatters
  lib/elevation.ts         terrarium tile fetch/decode/cache (z13, bilinear), profile
                           builder — this is the "instant elevation" magic
  lib/routing.ts           Valhalla POST (pedestrian/bicycle), 12 s timeout
  lib/gpx.ts               GPX parse/build
  lib/weather.ts           Open-Meteo fetch + WMO code → icon/label
  lib/supabase.ts          hand-rolled PostgREST client (insert + select only);
                           inert unless VITE_SUPABASE_* env vars set at build
supabase/migrations/0001_shared_plans.sql   the entire backend schema
render.yaml                Render blueprint (docs/reproducibility; live service was
                           created via API)
```

### State pattern

`store.ts` has a ~20-line custom store (getState/setState/subscribe) consumed via
`useApp(selector)` (uses `useSyncExternalStore` — selectors must return primitives or
stable refs). Actions are plain exported functions that call `store.setState` and kick
off async work (routing, profile rebuild). `MapView` subscribes imperatively and diffs
by reference (`s.plan.segments !== prev.plan.segments`) — keep returning new arrays/
objects on change or the map won't update.

Route model: `anchors` (user click points) + `segments` (one per anchor pair, each
carrying its own geometry and `snap`/`straight` mode, resolved async by id so stale
responses can't clobber newer edits). Undo/redo snapshots the whole plan (50 deep).

## The share-link flow

1. Share button → `buildSharePayload()` (anchors rounded to 5 dp, per-segment modes,
   waypoints, activity — never geometry, which is re-derived on open).
2. If configured: `createSharedPlan(payload)` → POST to `shared_plans` → `#t=<10-char id>`.
3. On any failure (or unconfigured): base64url-encoded `#plan=<payload>` fallback.
4. `loadFromHash()` on boot handles both `#t=` (async fetch) and `#plan=` (inline).
   Snapped legs re-route on open, so a shared route can differ trivially from the
   original if OSM data changed — accepted tradeoff for tiny links.

Backend contract (see the migration): anon role can INSERT and SELECT only; no
update/delete policies → rows are effectively immutable; `pg_column_size(plan) <=
100000` caps payloads. The publishable key ships in the bundle by design.

## Infrastructure details

**Render** — static site, build `npm ci && npm run build`, publish `dist/`, env vars
`NODE_VERSION=22.12.0`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. SPA rewrite
`/* → /index.html` added via API (note: `render.yaml` routes only apply to
Blueprint-created services — this one was created via the REST API, so route/env
changes must go through the dashboard or API, not the yaml). Auto-deploy on push to
`main`. The Render CLI on this machine is authenticated (`~/.render/cli.yaml`).

**Supabase** — one table, RLS on, migration checked into the repo. Managed via the
dashboard or the Supabase MCP/CLI. If you ever recreate the project: apply the
migration, then update the two env vars on Render and redeploy.

## Gotchas & lore (read before debugging)

- **No React StrictMode.** It double-mounts the WebGL map in dev: doubles tile
  traffic against community servers and can strand the second map instance with an
  unloaded style in throttled tabs. Don't re-add it casually.
- **rAF shim in `index.html`.** Browsers suspend `requestAnimationFrame` in hidden
  tabs, which freezes MapLibre's style/tile pipeline (maps load blank in background
  tabs). The inline script races native rAF against a 250 ms timeout; native always
  wins in visible tabs. Remove it and background-tab loading breaks again.
- **Map resize.** MapLibre can miss the initial container size (canvas stuck at
  400×300); `MapView` calls `map.resize()` on load and runs its own ResizeObserver.
- **Env vars are baked at build time.** Changing them on Render does nothing until
  the next deploy. And when verifying a deploy, cache-bust — Render's CDN happily
  serves you a stale `index.html` (this burned us once: looked like env vars weren't
  applied when they were).
- **View requests before map load** (`flyTo`/`fitBounds` from share links) are queued
  in the store and applied in the map's `load` handler — don't remove that block.
- **Community services etiquette.** OpenTopoMap, Valhalla@FOSSGIS, Photon, and
  Waymarked Trails are volunteer-run. Fine for personal use; before any real traffic,
  move tiles/routing to a paid provider (MapTiler/Stadia + Valhalla on a VPS or
  Stadia's hosted Valhalla).
- Two other Render services exist in the same workspace (`plan-tr`, `cut-sew-print`)
  — different projects, ignore them. `plan-tr` 500s; that's the GreenGrid repo, not
  this app.

## Verification playbook

`npm run typecheck` and `npm run build` must pass. Manual smoke (2 min): draw two
points near trails (route should follow switchbacks, not a straight line) → profile
appears with stats → Share → open the copied link in a private window → plan
restores. Backend smoke: `curl` a `#t=` id against
`https://ijtazxbzcxwcxjgxjxpz.supabase.co/rest/v1/shared_plans?id=eq.<id>&select=plan`
with the publishable key as `apikey` header.

## Roadmap candidates (in rough value order)

1. **Slope-angle shading** (CalTopo's killer feature) — client-side from the same
   terrarium tiles we already decode: compute slope per pixel, render as a canvas
   overlay or custom raster layer.
2. **Public land / land-ownership overlays** (onX's killer feature) — BLM/USFS/
   PAD-US vector tiles; needs a tile source decision.
3. **Cloud-saved trips + auth** — Supabase anonymous auth → magic-link upgrade;
   `trips` table mirroring localStorage schema.
4. **Offline/PWA** — service worker + tile caching for field use.
5. **Print at fixed scales** (1:24k) with UTM grid — CalTopo parity.
6. Link previews (OG tags per shared plan — needs an edge function), route GPX
   drag-and-drop, multi-route plans, mileage waypoint notes on the profile.
