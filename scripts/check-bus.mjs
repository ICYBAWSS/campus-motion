/**
 * Buses must move along their own route at the right speed, and never leave it.
 *
 * Run: node scripts/check-bus.mjs
 */
import assert from 'node:assert/strict'
import { BUS_SPEED, createSim } from '../src/sim.ts'

const sim = createSim({ population: 120, seed: 3 })
sim.runTo(600) // start of observation

const TRACKED = 6
const picks = sim.buses.slice(0, TRACKED)
const before = picks.map((b) => ({ x: b.x, z: b.z, d: b.d, route: b.route.ref }))

let moved = 0
let dwelling = 0
let offRoute = 0
let worst = 0

function distToPath(x, z, path) {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const [x1, z1] = path[i - 1]
    const [x2, z2] = path[i]
    const dx = x2 - x1
    const dz = z2 - z1
    const l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2))
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)))
  }
  return best
}

for (let step = 0; step < 30; step++) {
  sim.runTo(600 + step + 1)
  picks.forEach((b, i) => {
    const was = before[i]
    const dMove = Math.hypot(b.x - was.x, b.z - was.z)
    // progress along the route is exactly BUS_SPEED units per minute; the chord
    // is shorter wherever the road bends, so compare arc length (d), not distance
    const dProgress = (((b.d - was.d) % b.route.len) + b.route.len) % b.route.len
    if (dProgress > 0.01) {
      assert.ok(
        Math.abs(dProgress - BUS_SPEED) < 0.05,
        `bus on ${b.route.ref} advanced ${dProgress.toFixed(2)} of ${BUS_SPEED} units in a minute`,
      )
      moved++
    } else dwelling++
    if (dMove > BUS_SPEED + 0.5) throw new Error(`bus teleported ${dMove.toFixed(2)} units`)

    const off = distToPath(b.x, b.z, b.route.path) * 50 // metres
    worst = Math.max(worst, off)
    if (off > 5) {
      offRoute++
      console.log(`bus ${i} on ${b.route.ref} is ${off.toFixed(1)} m off its own route`)
    }
    before[i] = { x: b.x, z: b.z, d: b.d, route: b.route.ref }
  })
}

/* wrapping the loop must not teleport: the interpolated position one tick apart
   along the path has to be within one tick's travel, never a campus diagonal */
function atDistance(bus, distance) {
  const len = bus.route.len
  const target = ((distance % len) + len) % len
  let acc = 0
  const path = bus.route.path
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (acc + seg >= target) {
      const t = (target - acc) / (seg || 1)
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]
    }
    acc += seg
  }
  return path[path.length - 1]
}

let wraps = 0
for (let step = 0; step < 120; step++) {
  sim.runTo(600 + step + 1)
  for (const b of sim.buses) {
    if (b.d >= b.pd) continue
    wraps++
    const len = b.route.len
    const advance = (((b.d - b.pd) % len) + len) % len
    const a = atDistance(b, b.pd)
    const m = atDistance(b, (b.pd + advance * 0.5) % len)
    const jump = Math.hypot(m[0] - a[0], m[1] - a[1])
    assert.ok(jump <= BUS_SPEED, `bus on ${b.route.ref} jumped ${jump.toFixed(1)} units across the loop wrap`)
  }
}
console.log(`wrap ok — ${wraps} loop wraps, none teleported`)

assert.ok(moved > 0, 'buses actually move')
assert.ok(offRoute === 0, `${offRoute} samples left the route (worst ${worst.toFixed(1)} m)`)
console.log(`bus ok — ${moved} moving samples, ${dwelling} dwelling, worst ${worst.toFixed(1)} m off route`)
