/**
 * Build a routable OSM graph and re-derive every bus route on real roads.
 *
 * In:  /tmp/osm_*.osm  (Overpass/OSM extracts already on disk)
 *      src/App.tsx     (stop coordinates and route stop sequences, read by regex)
 * Out: src/network.json     { edges: [{a,b,drive,walk,kind}] }
 *      src/route-paths.json { REF: [[x,z], ...] }
 */
import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'

const ROOT = path.resolve(import.meta.dirname, '..')
const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50
const toUnit = (lat, lon) => [
  Number((((lon - CENTER[1]) * KX) / M).toFixed(2)),
  Number(((-(lat - CENTER[0]) * KY) / M).toFixed(2)),
]

/* ---------------- 1. parse the OSM dumps ---------------- */
const DRIVE = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
  'service',
])
const WALK = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'service', 'residential'])

const files = process.argv.slice(2)
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const nodes = new Map()
const edges = []

for (const f of files) {
  const doc = parser.parse(fs.readFileSync(f, 'utf8'))
  const osm = doc.osm
  for (const n of [].concat(osm.node ?? [])) {
    nodes.set(String(n['@_id']), toUnit(Number(n['@_lat']), Number(n['@_lon'])))
  }
  for (const w of [].concat(osm.way ?? [])) {
    const tags = {}
    for (const t of [].concat(w.tag ?? [])) tags[t['@_k']] = t['@_v']
    const hw = tags.highway
    if (!hw) continue
    const drive = DRIVE.has(hw)
    const walk = WALK.has(hw) || Boolean(tags.sidewalk)
    if (!drive && !walk) continue
    const refs = [].concat(w.nd ?? []).map((nd) => String(nd['@_ref']))
    for (let i = 0; i < refs.length - 1; i++) {
      const a = nodes.get(refs[i])
      const b = nodes.get(refs[i + 1])
      if (!a || !b) continue
      if (Math.abs(a[0]) > 70 || Math.abs(a[1]) > 84) continue
      if (Math.abs(b[0]) > 70 || Math.abs(b[1]) > 84) continue
      edges.push({ a, b, drive, walk, kind: hw })
    }
  }
}

const seen = new Set()
const unique = []
for (const e of edges) {
  const k = `${e.a}|${e.b}|${e.kind}`
  const kr = `${e.b}|${e.a}|${e.kind}`
  if (seen.has(k) || seen.has(kr)) continue
  seen.add(k)
  unique.push(e)
}
console.log(
  `edges ${unique.length} (drive ${unique.filter((e) => e.drive).length}, walk ${unique.filter((e) => e.walk).length})`,
)
fs.writeFileSync(path.join(ROOT, 'src/network.json'), JSON.stringify({ edges: unique }))

/* ---------------- 2. graph + A* ---------------- */
const key = (p) => `${p[0]},${p[1]}`
const adj = new Map()
for (const e of unique) {
  const ka = key(e.a)
  const kb = key(e.b)
  if (!adj.has(ka)) adj.set(ka, [])
  if (!adj.has(kb)) adj.set(kb, [])
  const c = Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1])
  adj.get(ka).push({ to: e.b, cost: c, drive: e.drive, walk: e.walk })
  adj.get(kb).push({ to: e.a, cost: c, drive: e.drive, walk: e.walk })
}
const nodeList = [...adj.keys()].map((k) => k.split(',').map(Number))

/**
 * Snap to the nearest node that actually has an edge of the requested mode.
 * Stops sit on the footway, and a footway node is not a road node — snapping to
 * "the nearest node, period" strands drive routing at the kerb.
 */
function snap(p, mode) {
  const allow = (e) => (mode === 'drive' ? e.drive : e.walk)
  let best = p
  let bd = Infinity
  for (const q of nodeList) {
    const k = key(q)
    const es = adj.get(k)
    if (!es || !es.some(allow)) continue
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}
const snapped = new Map()
for (const p of nodeList) snapped.set(key(p), p)

function route(from, to, mode) {
  const s = snap(from, mode)
  const t = snap(to, mode)
  const start = key(s)
  const goal = key(t)
  const allow = (e) => (mode === 'drive' ? e.drive : e.walk)
  const g = new Map([[start, 0]])
  const came = new Map()
  const open = [[0, start]]
  const h = (k) => {
    const [x, z] = k.split(',').map(Number)
    return Math.hypot(x - t[0], z - t[1])
  }
  while (open.length) {
    open.sort((a, b) => a[0] - b[0])
    const cur = open.shift()[1]
    if (cur === goal) break
    for (const e of adj.get(cur) ?? []) {
      if (!allow(e)) continue
      const nk = key(e.to)
      const ng = (g.get(cur) ?? Infinity) + e.cost
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng)
        came.set(nk, cur)
        open.push([ng + h(nk), nk])
      }
    }
  }
  if (!came.has(goal) && start !== goal) return null
  const out = []
  let cur = goal
  while (cur) {
    out.push(snapped.get(cur))
    cur = came.get(cur)
  }
  out.reverse()
  return out
}

/* ---------------- 3. stops and route sequences out of App.tsx ---------------- */
const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
const stopsBlock = app.slice(app.indexOf('const STOPS = {'), app.indexOf('const NODES'))
const STOPS = {}
for (const m of stopsBlock.matchAll(
  /(\w+):\s*\{\s*label:[^}]*?at:\s*toUnit\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g,
)) {
  STOPS[m[1]] = toUnit(Number(m[2]), Number(m[3]))
}
console.log('stops parsed:', Object.keys(STOPS).length)

const ROUTE_STOPS = {}
for (const m of app.matchAll(/ref:\s*'([^']+)',\s*\n\s*colour:[^\n]*\n\s*stops:\s*\[([^\]]*)\]/g)) {
  ROUTE_STOPS[m[1]] = m[2]
    .split(',')
    .map((t) => t.trim().replace(/'/g, ''))
    .filter(Boolean)
}
console.log('routes parsed:', Object.keys(ROUTE_STOPS).join(' '))

/* ---------------- 4. route each loop on the road graph ---------------- */
const out = {}
for (const [ref, keys] of Object.entries(ROUTE_STOPS)) {
  const path = []
  let missed = 0
  for (let i = 0; i < keys.length; i++) {
    const a = STOPS[keys[i]]
    const b = STOPS[keys[(i + 1) % keys.length]]
    if (!a || !b) {
      missed++
      continue
    }
    let leg = route(a, b, 'drive')
    if (!leg) {
      missed++
      leg = [a, b]
    }
    for (const p of leg) {
      const last = path[path.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p)
    }
  }
  const km =
    path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0) * (M / 1000)
  out[ref] = path
  console.log(
    `${ref.padEnd(5)} points ${String(path.length).padStart(5)}  loop ${km.toFixed(2)} km  legs missed ${missed}`,
  )
}
fs.writeFileSync(path.join(ROOT, 'src/route-paths.json'), JSON.stringify(out))
console.log('wrote src/route-paths.json')
