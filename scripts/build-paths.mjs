/**
 * Rebuild every route polyline so it never leaves the drivable network.
 *
 * The previous version started each leg at the stop's exact coordinate and then
 * jumped to the nearest road node — those jumps are straight lines across
 * whatever happened to be between, which is why buses appeared to cross lawns
 * and clip buildings. Legs are now node-to-node, and the stop itself snaps to
 * the road.
 *
 * Run: node scripts/build-paths.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const net = JSON.parse(fs.readFileSync(new URL('../src/network.json', import.meta.url)))
const routes = JSON.parse(fs.readFileSync(new URL('../src/data/routes.json', import.meta.url)))
const stops = JSON.parse(fs.readFileSync(new URL('../src/data/stops.json', import.meta.url)))

const key = (p) => `${p[0]},${p[1]}`
const adj = new Map()
const nodes = new Map()

for (const e of net.edges) {
  if (!e.drive) continue
  const a = key(e.a)
  const b = key(e.b)
  nodes.set(a, e.a)
  nodes.set(b, e.b)
  const c = Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1])
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  adj.get(a).push({ to: b, cost: c })
  adj.get(b).push({ to: a, cost: c })
}

const nodeList = [...nodes.entries()]

/** nearest drivable node — the bus stops on the road, not at the plaza coordinate */
function snap(p) {
  let best = null
  let bd = Infinity
  for (const k of nodeList) {
    const q = k[1]
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (d < bd) {
      bd = d
      best = k[0]
    }
  }
  return best
}

function astar(start, goal, used) {
  if (start === goal) return [nodes.get(goal)]
  const gx = nodes.get(goal)[0]
  const gz = nodes.get(goal)[1]
  const dist = new Map([[start, 0]])
  const came = new Map()
  const open = [[0, start]]
  while (open.length) {
    open.sort((a, b) => a[0] - b[0])
    const cur = open.shift()[1]
    if (cur === goal) break
    for (const e of adj.get(cur) ?? []) {
      // driving back down the street we just came up is what looks like a bus
      // going into reverse; make it cost four times as much
      const reuse = used.has(cur < e.to ? `${cur}|${e.to}` : `${e.to}|${cur}`) ? 4 : 1
      const ng = dist.get(cur) + e.cost * reuse
      if (ng < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, ng)
        came.set(e.to, cur)
        const q = nodes.get(e.to)
        open.push([ng + Math.hypot(q[0] - gx, q[1] - gz), e.to])
      }
    }
  }
  if (!came.has(goal)) return null
  const out = [nodes.get(goal)]
  let cur = goal
  while (came.has(cur)) {
    cur = came.get(cur)
    out.push(nodes.get(cur))
  }
  return out.reverse()
}

const out = {}
for (const r of routes) {
  const nodesFor = r.stops.map((s) => snap(stops[s].at))
  const path = []
  const used = new Set()
  let missed = 0
  for (let i = 0; i < nodesFor.length; i++) {
    const leg = astar(nodesFor[i], nodesFor[(i + 1) % nodesFor.length], used)
    if (!leg) {
      missed++
      continue
    }
    for (let k = 0; k < leg.length; k++) {
      const p = leg[k]
      const last = path[path.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p)
      if (k > 0) {
        const a = key(leg[k - 1])
        const b = key(p)
        used.add(a < b ? `${a}|${b}` : `${b}|${a}`)
      }
    }
  }
  assert.ok(path.length > 10, `route ${r.ref} produced ${path.length} points`)
  assert.equal(missed, 0, `route ${r.ref} has ${missed} unroutable legs`)
  out[r.ref] = path
  const km = path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0) * 0.05
  console.log(`${r.ref.padEnd(5)} ${String(path.length).padStart(4)} pts  ${km.toFixed(2)} km`)
}

/* every point must sit on the drivable network */
let worst = 0
for (const [ref, path] of Object.entries(out)) {
  for (const [x, z] of path) {
    let best = Infinity
    for (const [, q] of nodeList) {
      const d = Math.hypot(q[0] - x, q[1] - z)
      if (d < best) best = d
      if (best === 0) break
    }
    worst = Math.max(worst, best)
    assert.ok(best * 50 < 1, `${ref}: point ${x},${z} is ${(best * 50).toFixed(1)} m off the road network`)
  }
}

fs.writeFileSync(new URL('../src/data/paths.json', import.meta.url), JSON.stringify(out))
console.log(`wrote paths.json — worst point ${(worst * 50).toFixed(2)} m from a road node`)
