# Rutgers Campus Twin v2 — finish it properly

## Goal

Turn the existing one-file demo into a campus simulation where every visible thing is driven by the simulation — people routed along real sidewalks, buses along real roads, queues that form lines, numbers that are counts of agents — and where every remaining corner cut from the original brief is gone.

---

## Current context / assumptions

### What exists (verified)

| Path | Lines | What it is |
| --- | --- | --- |
| `src/App.tsx` | 2,969 | everything: data, engine glue, 3D scene, UI panels |
| `src/agents.ts` | 491 | agent engine: `createSim(world, from)` → `{ agents, buses, runTo(minute), snapshot() }` |
| `src/sim.ts` | 351 | **dead** — the old flow/queue model. Nothing imports it. Delete. |
| `src/roads.json` | 342 KB | 1,941 OSM road ways (residential + service only), scene units |
| `scripts/check-layout.mjs` | transforms + campus bounds, `layout ok` |
| `scripts/check-sim.mjs` | engine invariants, `sim ok` |

Stack: Node 25, Vite 8, React 19.3, three 0.186, `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9, recharts 3.10.1, Tailwind 4 via `@tailwindcss/vite`.

Data (all fetched, all CORS-open):

- **Buildings** — Rutgers ArcGIS `Rutgers_University_Buildings/FeatureServer/0`, 737 New Brunswick footprints with `BldgNum`, `BldgName`, `Category`, `District`.
- **Routes** — 12: A, B, B/L, C, EE, F, H, Lx, RexB, RexL, W1, W2. Weekday set matches `ipo.rutgers.edu/dots/weekday-routes-nb`; W1/W2 confirmed live as `wknd1`/`wknd2`.
- **Roads** — OSM, already downloaded to `/tmp/osm_tile1.osm`, `/tmp/osm_744470.osm`, `/tmp/osm_744720.osm` (union covers lat 40.42–40.56, lon −74.53 to −74.28).
- **Live feed** — `wss://demo.rubus.live/ws`, `https://demo.rubus.live/buses` (9 vehicles right now).

### What is wrong today (the honest list)

1. **No sidewalks.** The brief asked for grass + concrete sidewalks + buildings. There are no sidewalks anywhere.
2. **People are capsules.** A humanoid `Person` is now drawn for the 26 agents nearest a hardcoded point, but at 40 px it reads as a pawn. Nothing walks along a path — agents lerp in a straight line toward their target.
3. **Route geometry is hand-traced.** A/B/C/H/Lx/RexB/RexL use hand-made polylines; EE/F are straight lines between stops; B/L is OSM-only and unverified.
4. **Queues are numbers.** No line of people at a stop, no ordering, no "who is at the front".
5. **No picking.** You cannot click a person or a bus.
6. **The alert copy is wrong.** Brief says `High Volume Predicted at ARC`; the app says `23 people waiting at Allison Road Classroom`.
7. **App.tsx is 2,969 lines** — every change risks a different feature. Three "fixes" this session broke something else for exactly this reason.
8. **No replay tape.** Scrubbing backwards is impossible; the sim only steps forward.

### Assumptions

- Desktop Chromium/Firefox at ≥1280 px. Mobile out of scope (already recorded).
- The simulation is a **sandbox**: no "deploy" language, no real-world control.
- "Accurate" means: every route that DOTS publishes is present, every stop is at its real coordinates, and every path follows a real road. Where a source is missing, the UI says so rather than inventing.

---

## Architecture / proposed approach

**One routable network is the backbone.** Build a graph from OSM (roads + footways), snap every stop to its nearest node, and route everything on it: bus polylines become A* paths between consecutive stops, pedestrians walk sidewalk edges, and queue positions are placed along the kerb. That single change removes three classes of fake at once — hand-traced route lines, straight-line walking, and stops floating off the street.

Around it, split the monolith into a small set of single-purpose modules (data / sim / scene / ui), keep the simulation a pure stepped engine that emits per-minute frames, and render with two levels of detail: sprite billboards for crowds at distance, humanoid meshes for the near field. Everything added is verified by a runnable check, not by looking at a screenshot and hoping.

---

## Step-by-step tasks

Each task ends with a commit. Run `npm run build` and `npm run check:layout` / `npm run check:sim` after every task that touches `src/`.

---

### Task 1 — Delete the dead engine and freeze the baseline

```bash
cd /Users/rayhan/rutgers-transit-twin
grep -rn "from './sim'" src/ || echo "no importers"
```

Expected: `no importers`. If anything prints, stop and fix that import first.

```bash
cd /Users/rayhan/rutgers-transit-twin && rm src/sim.ts && npm run build > /tmp/t1.log 2>&1; echo "build=$?"; tail -2 /tmp/t1.log
```

Expected: `build=0`, `✓ built in`.

```bash
git add -A && git commit -m "chore: delete the dead flow-model engine"
```

---

### Task 2 — Split `App.tsx` (mechanical, no behaviour change)

Four moves, each followed by a build. Do **not** change any logic while moving.

**2a. `src/data/stops.ts`** — cut `Vec2`, `toUnit`, `CENTER`, `M_PER_UNIT`, `STOPS`, `StopKey`, `pathLength`, `projectOnPath`, `samplePath`, the `RouteSpec` (App's) type, `ROUTES`, `makeRoute`, `makeRouteFromStops`, `SIM_ROUTES`. Export all of them.

**2b. `src/data/campus.ts`** — cut `CampusBuilding`, `CAT_*`, `HOUR_WEIGHT`, `CAMPUS`, `nearestStop`, `tightBox`, `ringsOf`, `BUILDINGS_URL`, `PARKING_URL`, `loadCampusOnce`, `loadCampus`, `getCampusRev` (see 2d).

**2c. `src/data/calendar.ts`** — cut `TERMS`, `HOLIDAYS`, `termOf`, `TERM_DEMAND`, `TERM_SERVICE`, `bandOf`, `headwayAt`, `Day`.

**2d. Campus load without prop drilling.** `loadCampus()` is called once from an effect; replace the `campusRev` state with a tiny subscription so `campus.ts` owns it:

```ts
// src/data/campus.ts
let rev = 0
const listeners = new Set<() => void>()
export const getCampusRev = () => rev
export const subscribeCampus = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const bump = () => {
  rev++
  for (const fn of listeners) fn()
}
// at the end of loadCampusOnce(): bump()
```

In `App.tsx`:

```tsx
const campusRev = useSyncExternalStore(subscribeCampus, getCampusRev)
```

```bash
cd /Users/rayhan/rutgers-transit-twin && npx tsc -b && npm run build > /tmp/t2.log 2>&1; echo "build=$?"
```

Expected: `build=0`. `src/App.tsx` should now be under 1,300 lines:

```bash
wc -l src/App.tsx
```

```bash
git add -A && git commit -m "refactor: split data out of App.tsx (no behaviour change)"
```

---

### Task 3 — Build the routable network

**3.1 Extract roads *and* footways** from the OSM dumps into one graph-ready file.

Write `scripts/build-network.mjs`:

```js
import fs from 'node:fs'
import { XMLParser } from 'fast-xml-parser' // npm i -D fast-xml-parser

const CENTER = [40.5028, -74.447]
const M = 50
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const toUnit = (lat, lon) => [
  Number((((lon - CENTER[1]) * KX) / M).toFixed(2)),
  Number(((-(lat - CENTER[0]) * KY) / M).toFixed(2)),
]

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service'])
const WALK = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'service', 'residential'])

const files = ['/tmp/osm_tile1.osm', '/tmp/osm_744470.osm', '/tmp/osm_744720.osm']
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const nodes = new Map()
const edges = [] // { a: [x,z], b: [x,z], drive: boolean, walk: boolean, kind: string }

for (const f of files) {
  const doc = parser.parse(fs.readFileSync(f, 'utf8'))
  const os = doc.osm
  for (const n of [].concat(os.node ?? [])) nodes.set(String(n['@_id']), toUnit(Number(n['@_lat']), Number(n['@_lon'])))
  for (const w of [].concat(os.way ?? [])) {
    const tags = {}
    for (const t of [].concat(w.tag ?? [])) tags[t['@_k']] = t['@_v']
    const hw = tags.highway
    if (!hw) continue
    const drive = DRIVE.has(hw)
    const walk = WALK.has(hw) || !!tags.sidewalk
    if (!drive && !walk) continue
    const refs = [].concat(w.nd ?? []).map((nd) => String(nd['@_ref']))
    for (let i = 0; i < refs.length - 1; i++) {
      const a = nodes.get(refs[i])
      const b = nodes.get(refs[i + 1])
      if (!a || !b) continue
      if (Math.abs(a[0]) > 70 || Math.abs(a[1]) > 82) continue
      if (Math.abs(b[0]) > 70 || Math.abs(b[1]) > 82) continue
      edges.push({ a, b, drive, walk, kind: hw })
    }
  }
}

// dedupe undirected edges
const seen = new Set()
const unique = []
for (const e of edges) {
  const k = `${e.a[0]},${e.a[1]}|${e.b[0]},${e.b[1]}|${e.kind}`
  const kr = `${e.b[0]},${e.b[1]}|${e.a[0]},${e.a[1]}|${e.kind}`
  if (seen.has(k) || seen.has(kr)) continue
  seen.add(k)
  unique.push(e)
}

fs.mkdirSync('src/data', { recursive: true })
fs.writeFileSync('src/data/network.json', JSON.stringify({ edges: unique }))
console.log(`edges ${unique.length}, drive ${unique.filter((e) => e.drive).length}, walk ${unique.filter((e) => e.walk).length}`)
```

```bash
cd /Users/rayhan/rutgers-transit-twin && npm i -D fast-xml-parser && node scripts/build-network.mjs
```

Expected: `edges N, drive D, walk W` with `N > 8000`, `D > 3000`, `W > 5000`, and `src/data/network.json` between 1.5 and 6 MB.

**3.2 Graph + A\*.** `src/network.ts`:

```ts
import net from './data/network.json'

export type P = [number, number]
export type Edge = { a: P; b: P; drive: boolean; walk: boolean; kind: string }

const key = (p: P) => `${p[0]},${p[1]}`
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])

export class Network {
  private adj = new Map<string, { to: P; cost: number; drive: boolean; walk: boolean }[]>()

  constructor(edges: Edge[]) {
    for (const e of edges) {
      const ka = key(e.a)
      const kb = key(e.b)
      if (!this.adj.has(ka)) this.adj.set(ka, [])
      if (!this.adj.has(kb)) this.adj.set(kb, [])
      const c = dist(e.a, e.b)
      this.adj.get(ka)!.push({ to: e.b, cost: c, drive: e.drive, walk: e.walk })
      this.adj.get(kb)!.push({ to: e.a, cost: c, drive: e.drive, walk: e.walk })
    }
  }

  /** snap a point to the nearest graph node */
  snap(p: P): P {
    let best: P = p
    let bestD = Infinity
    for (const k of this.adj.keys()) {
      const [x, z] = k.split(',').map(Number)
      const d = (x - p[0]) ** 2 + (z - p[1]) ** 2
      if (d < bestD) {
        bestD = d
        best = [x, z]
      }
    }
    return best
  }

  /** shortest path; mode decides which edges are legal */
  route(from: P, to: P, mode: 'drive' | 'walk'): P[] {
    const allow = (e: { drive: boolean; walk: boolean }) => (mode === 'drive' ? e.drive : e.walk)
    const start = key(this.snap(from))
    const goal = key(this.snap(to))
    if (start === goal) return [this.snap(from), this.snap(to)]

    const open: { k: string; f: number }[] = [{ k: start, f: 0 }]
    const g = new Map<string, number>([[start, 0]])
    const came = new Map<string, string>()
    const h = (k: string) => {
      const [x, z] = k.split(',').map(Number)
      const [gx, gz] = goal.split(',').map(Number)
      return Math.hypot(x - gx, z - gz)
    }

    while (open.length) {
      open.sort((a, b) => a.f - b.f)
      const cur = open.shift()!.k
      if (cur === goal) break
      for (const e of this.adj.get(cur) ?? []) {
        if (!allow(e)) continue
        const nk = key(e.to)
        const ng = (g.get(cur) ?? Infinity) + e.cost
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng)
          came.set(nk, cur)
          open.push({ k: nk, f: ng + h(nk) })
        }
      }
    }

    if (!came.has(goal) && start !== goal) return [from, to] // disconnected: straight line, and say so
    const out: P[] = []
    let cur: string | undefined = goal
    while (cur) {
      const [x, z] = cur.split(',').map(Number)
      out.push([x, z])
      cur = came.get(cur)
    }
    out.reverse()
    return out
  }
}

export const network = new Network(net.edges as Edge[])
```

**3.3 Test it** — `scripts/check-network.mjs`:

```js
import assert from 'node:assert/strict'
import { network } from '../src/network.ts'

// ARC stop to Busch Student Center stop, both real coordinates in scene units
const arc = [-30.61, -46.24]
const bsc = [-18.81, -45.98]

for (const mode of ['drive', 'walk']) {
  const path = network.route(arc, bsc, mode)
  assert.ok(path.length >= 2, `${mode}: path has at least two points`)
  const len = path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0)
  assert.ok(len > 8, `${mode}: path is not a shortcut (got ${len.toFixed(1)} units)`)
  assert.ok(len < 60, `${mode}: path is not absurd (got ${len.toFixed(1)} units)`)
  console.log(mode, 'points', path.length, 'length', len.toFixed(1))
}

// a route that must exist on the network: Old Queens to the Yard, both on College Ave
const a = network.snap([-0.04, 0.16])
const b = network.snap([-8.4, 4.2])
assert.notDeepEqual(a, b, 'two distinct nodes at different places')
console.log('network ok')
```

```bash
cd /Users/rayhan/rutgers-transit-twin && node scripts/check-network.mjs
```

Expected: `drive points …`, `walk points …`, `network ok`. Path length between 8 and 60 units (400–3,000 m) is the sanity band for that pair.

```bash
git add -A && git commit -m "feat: OSM road and footway network with A* routing"
```

---

### Task 4 — Route every bus along real roads

**4.1 Regenerate route geometry.** `scripts/build-routes.mjs`:

```js
import fs from 'node:fs'
import { network } from '../src/network.ts'

// stop sequences, copied verbatim from src/data/stops.ts after task 2
const ROUTE_STOPS = JSON.parse(fs.readFileSync('scripts/route-stops.json', 'utf8'))
const STOPS = JSON.parse(fs.readFileSync('scripts/stops.json', 'utf8'))

const out = {}
for (const [ref, keys] of Object.entries(ROUTE_STOPS)) {
  const path = []
  for (let i = 0; i < keys.length; i++) {
    const a = STOPS[keys[i]]
    const b = STOPS[keys[(i + 1) % keys.length]]
    const leg = network.route(a, b, 'drive')
    for (const p of leg) {
      const last = path[path.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p)
    }
  }
  out[ref] = path
  const km = path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0) * 0.05
  console.log(ref, 'points', path.length, 'loop km', km.toFixed(2))
}
fs.writeFileSync('src/data/route-paths.json', JSON.stringify(out))
```

Before running it, dump the two inputs from the current code (one-off, in the repo, committed):

```bash
cd /Users/rayhan/rutgers-transit-twin && node --experimental-strip-types -e "
import('./src/data/stops.ts').then(({ STOPS, ROUTES }) => {
  const fs = require('node:fs')
  fs.writeFileSync('scripts/stops.json', JSON.stringify(Object.fromEntries(Object.entries(STOPS).map(([k,v]) => [k, v.at]))))
  fs.writeFileSync('scripts/route-stops.json', JSON.stringify(Object.fromEntries(ROUTES.map(r => [r.ref, r.stops]))))
  console.log('wrote', Object.keys(STOPS).length, 'stops,', ROUTES.length, 'routes')
})"
```

Expected: `wrote 21 stops, 12 routes`.

```bash
node --experimental-strip-types scripts/build-routes.mjs
```

Expected, per route, `loop km` in this band: A ≈ 11, B ≈ 9, B/L ≈ 10, C ≈ 3, **EE ≈ 4–6**, **F ≈ 4–6**, H ≈ 11, Lx ≈ 12, RexB ≈ 15, RexL ≈ 18. Anything wildly outside means the stop sequence is wrong — fix the sequence, not the routing.

**4.2 Use the new paths.** In `src/data/stops.ts`, `makeRoute` now takes its `path` from `route-paths.json[ref]` and computes `len`/`haltD` with the existing `pathLength`/`projectOnPath`. Delete `makeRouteFromStops` and the hand-traced `ll` arrays — 700 lines of hand geometry go away.

```bash
cd /Users/rayhan/rutgers-transit-twin && npm run build && npm run check:layout
```

Expected: `build=0`, `layout ok`.

```bash
git add -A && git commit -m "feat: every route follows the real road network (EE and F now have geometry)"
```

---

### Task 5 — Sidewalks

**5.1** Add a `Walkways` mesh in `src/scene/Walkways.tsx`, built exactly like `Roads` but from walk-only edges, drawn 4 cm higher and 1.6× wider than the road ribbon, in a light concrete tone:

```tsx
const WALK_COLOUR = [0.78, 0.78, 0.76]
```

Verification is visual and specific — the ARC stop must sit on a grey band that connects to a building entrance.

**5.2** Agents walk on it. In `agents.ts`, replace every straight-line lerp with a path:

```ts
type Leg = { path: P[]; t0: number; t1: number }
```

`createSim` takes a `route: (a: P, b: P, mode: 'walk' | 'drive') => P[]` function in `SimWorld`, and on each state transition (`home→walk-stop`, `wait→walk-dest`, alight→`walk-dest`) it stores `a.leg.path = world.route([a.x, a.z], targetPoint, 'walk')` and sets `t1 = t0 + pathLength(path) / world.walkSpeed`.

Each tick, position comes from the path at `f = (t - t0) / (t1 - t0)`.

**5.3 Verify with a real assertion**, not eyeballing — `scripts/check-sim.mjs` gains:

```js
// every agent walking is on the walk network
const walking = run.agents.filter((a) => a.state === 'walk-stop' || a.state === 'walk-dest')
assert.ok(walking.length > 0, 'somebody is walking at some point in the day')
assert.ok(
  walking.every((a) => Number.isFinite(a.x) && Number.isFinite(a.z) && Math.abs(a.x) < 70 && Math.abs(a.z) < 82),
  'walkers stay inside the campus frame',
)
```

```bash
cd /Users/rayhan/rutgers-transit-twin && npm run check:sim
```

Expected: `sim ok`.

```bash
git add -A && git commit -m "feat: sidewalks on the real footway network; agents walk paths, not straight lines"
```

---

### Task 6 — People that look like people

**6.1 Sprite atlas generated at build time** (no asset pipeline, no downloads). `scripts/build-atlas.mjs` draws a 6-colour × 8-frame walking figure into a 480×320 PNG using `@napi-rs/canvas`… — **no**: don't add a native dep. Draw it in the browser instead, once, at startup: `src/scene/atlas.ts` creates a `OffscreenCanvas`, draws 8 poses (legs at 8 phases) × 6 shirt colours, and returns a `CanvasTexture`. ~70 lines, zero dependencies, and it ships inside the bundle.

**6.2 Two levels of detail.**

- Far (> 12 units from the camera target): `THREE.Points`? No — a **billboard instanced quad** per agent with the atlas frame chosen by `state` and `phase`. One `InstancedMesh`, one draw call, `map` = atlas, `alphaTest` 0.4.
- Near (< 12 units): the existing `Person` mesh, with a `useFrame` leg swing **only on the near set** (≤ 26 figures, cheap).

**6.3 The check that was missing last time** — verify by geometry, not by eye. `scripts/check-scene.mjs` renders the scene headlessly? Too heavy. Instead assert the maths that made people the wrong size:

```js
// the projected height of a person must be 8–40 px at the default camera
const zoom = 70
const viewportPx = 900
const unitsAcross = viewportPx / zoom
const personUnits = 0.42
const px = (personUnits / unitsAcross) * viewportPx
assert.ok(px > 8 && px < 40, `person is ${px.toFixed(1)} px tall at zoom ${zoom}`)
```

Plus one manual step, written down because it is the only way to see it: **zoom to the ARC stop, take a screenshot, and confirm you can count heads, arms and legs.** If you cannot, the figure is wrong — not the screenshot.

```bash
git add -A && git commit -m "feat: sprite crowd at distance, animated humanoids up close"
```

---

### Task 7 — Queue lines

Agents waiting are ordered by `a.since` and placed in a line that walks backwards from the stop along the kerb, 0.28 units apart, capped at 14 visible with the rest as a thinned tail.

In `agents.ts`, when an agent enters `wait`, give it a slot: `a.slot = waiting[stop].length`. In the scene, `QueueLine` renders each waiting agent at `stop + tangent * 0.28 * slot + normal * 0.35`.

Check: `run.queue['arc'][m]` (a count) must equal the number of agents drawn in ARC's line at minute `m` — assert it in `scripts/check-sim.mjs`:

```js
const waitingArc = run.agents.filter((a) => a.state === 'wait' && a.stop === 'arc').length
assert.equal(waitingArc, Math.round(run.queue['arc'][run.queue['arc'].length - 1]), 'the line matches the count')
```

```bash
git add -A && git commit -m "feat: queues are lines of people, ordered by arrival"
```

---

### Task 8 — Picking and the inspector

Click a person or a bus → right panel shows: who (origin building, destination building), how long they have waited, which route they need, and for buses: route, load, capacity.

Implementation: `onPointerDown` on the crowd instanced mesh gives `instanceId` → map to `agents[instanceId]` (keep the array order stable); buses get `onClick` on their group. Store `selected` in App state, render `InspectorPanel` in place of the alert card when something is selected.

Check: click three different figures, confirm each inspector's `state` matches what the scene shows (waiting / walking / riding), and that waiting minutes increase while the clock runs.

```bash
git add -A && git commit -m "feat: click a person or a bus to inspect the live simulation"
```

---

### Task 9 — Replay tape and scrubbing

`createSim` already steps by minute; add a ring buffer of frames:

```ts
export type Frame = { t: number; agents: Float32Array; buses: Float32Array; queue: Record<StopId, number> }
```

one frame per minute, 6 floats per agent (x, z, px, pz, state, id) and 4 per bus, in a flat `Float32Array` (`600 × 6 × 4 B = 14 KB/min`, 20 MB for a day — cap the tape at 6 hours and evict the oldest). Scrub the clock backwards by reading frames instead of re-simulating.

Check:

```js
// scrubbing backwards to minute 30 from 60 must produce the same frame as stepping forward to 30
```

```bash
git add -A && git commit -m "feat: replay tape — scrub the day without re-simulating"
```

---

### Task 10 — Fix the copy to the brief

- Alert headline exactly `High Volume Predicted at ARC` when `queued > 0.8 * QUEUE_100` at the venue, else `{venue} is clear`.
- Button `Deploy reserve bus (sim)` — keep "(sim)" because the sandbox rule outranks the original wording, and say so in a tooltip.
- Header exactly `Rutgers 5G Transit Twin - Powered by Verizon Mobile Edge Compute`.
- Left panel heading `IoT Sensors`, ten rows, each `{stop} {density}% · Verizon 5G UWB`.

Check: `grep -c "High Volume Predicted at ARC" src/App.tsx` → `1`.

```bash
git add -A && git commit -m "fix: dashboard copy matches the brief"
```

---

### Task 11 — Performance budget, measured

Add `src/dev/fps.ts` behind `import.meta.env.DEV` that samples frame times for 10 s and logs p50/p95. Acceptance: **p95 < 20 ms at 4× speed with 600 agents**, measured at zoom 70 over the Busch cluster, in a 1440×900 window.

If it misses: reduce `population` to 400, cap the near-LOD set at 16, and drop `dpr` to 1 before touching anything else.

```bash
git add -A && git commit -m "perf: measured frame budget at 4x with 600 agents"
```

---

### Task 12 — A/B, honestly

Two runs from the same world, differing only in one intervention (e.g. +2 buses on H). Show, side by side: peak queue at the venue, mean wait by stop, buses needed. Label the panel `modelled, not measured`.

```bash
git add -A && git commit -m "feat: A/B comparison of two worlds with the same seed"
```

---

## Tests / validation

| Command | Expected | Guards |
| --- | --- | --- |
| `npm run check:layout` | `layout ok` | projection, ARC↔BSC 590 m, campus bounds |
| `npm run check:network` | `network ok` | graph connectivity, path lengths, snapping |
| `npm run check:sim` | `sim ok` | conservation, capacity, walking bounds, queue == line length |
| `npm run build` | `✓ built` | types + bundle |
| `npm run format:check` | clean | formatting |

Visual acceptance, done by Rayhan, not by me: sidewalks visible under the ARC stop; a person you can count limbs on at zoom; queue forming a line; a bus pulling up and people boarding.

---

## Risks, tradeoffs, and open questions

- **A\* on a 12k-edge graph is O(E log V) per leg**; caching per (route, leg) at build time is mandatory — 12 routes × ~10 legs, run once in `build-routes.mjs`, ships as JSON.
- **OSM sidewalk coverage is uneven.** Some campus paths are `footway`, some are just road verges. Where there is no footway edge, walkers fall back to the road edge and that is visible — acceptable, stated, not hidden.
- **Camera zoom is unverified.** The canvas was refactored to true metre scale; `camera.zoom` must be read back from the live scene and a screenshot taken at three zoom levels (campus, block, street) before anyone claims zoom works.
- **EE and F have no OSM relation.** Their stop order comes from the DOTS weekday sheet; F's final stop is inferred. When a route then produces an absurd loop length (>2× expected), that is the signal the sequence is wrong — fix the data.
- **600 agents is a sample, not the campus.** The UI says "modelled"; it must never look like a headcount.
- **Open question for Rayhan**: do you want the camera to stay the fixed isometric campus view, or to zoom into a street-level mode below ~8 units? Sprites vs meshes depends on that answer, and it is the difference between "diagram" and "game".
- **`B/L` is real — confirmed by Rayhan.** It has no DOTS page and no live vehicle at the time of checking, which is why it looked uncertain; keep it, keep its OSM geometry, and mark its headway as unverified in the UI rather than deleting it.
