/**
 * Accuracy check against reality.
 *
 * 1. Live vehicle positions from the Rutgers tracker, matched to our route
 *    geometry. A bus drawn on the wrong road shows up as a large distance.
 * 2. Stop coordinates versus the satellite frame the scene renders.
 *
 * Run: node scripts/check-live.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50
const toUnit = (lat, lon) => [((lon - CENTER[1]) * KX) / M, (-(lat - CENTER[0]) * KY) / M]

const paths = JSON.parse(fs.readFileSync(new URL('../src/data/paths.json', import.meta.url)))
const stops = JSON.parse(fs.readFileSync(new URL('../src/data/stops.json', import.meta.url)))

/* ---------------- 1. satellite frame covers every stop ---------------- */
// the ground plane is 140 x 220 units centred on the projection origin
const HALF_X = 70
const HALF_Z = 110
let outside = 0
for (const [k, s] of Object.entries(stops)) {
  const [x, z] = s.at
  if (Math.abs(x) > HALF_X || Math.abs(z) > HALF_Z) {
    outside++
    console.log(`stop outside satellite frame: ${k} (${x}, ${z})`)
  }
}
assert.equal(outside, 0, 'every stop must sit inside the satellite image')
console.log(`satellite frame covers ${Object.keys(stops).length} stops`)

/* ---------------- 2. live vehicles vs our route geometry ---------------- */
const res = await fetch('https://demo.rubus.live/buses')
const live = await res.json()
const vehicles = Object.entries(live).map(([id, v]) => ({ id, ...v }))
console.log(`live vehicles: ${vehicles.length}`)

const ROUTE_OF = { wknd1: 'W1', wknd2: 'W2' }

function distToPath(p, path) {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const [x1, z1] = path[i - 1]
    const [x2, z2] = path[i]
    const dx = x2 - x1
    const dz = z2 - z1
    const l2 = dx * dx + dz * dz || 1
    let t = ((p[0] - x1) * dx + (p[1] - z1) * dz) / l2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(p[0] - (x1 + dx * t), p[1] - (z1 + dz * t))
    if (d < best) best = d
  }
  return best
}

let checked = 0
let worst = 0
for (const v of vehicles) {
  const ref = ROUTE_OF[v.route]
  if (!ref) continue
  const path = paths[ref]
  if (!path) {
    console.log(`no geometry for live route ${v.route}`)
    continue
  }
  const p = toUnit(v.lat, v.lng)
  const metres = distToPath(p, path) * M
  worst = Math.max(worst, metres)
  checked++
  console.log(
    `bus ${v.id.padEnd(5)} ${v.route} -> ${ref}: ${metres.toFixed(0)} m from our road geometry` +
      ` (${v.riders}/${v.capacity} riders)`,
  )
}

assert.ok(checked > 0, 'at least one live vehicle must match a route we model')
assert.ok(worst < 250, `a bus is ${worst.toFixed(0)} m off our geometry — route or projection is wrong`)
console.log(`live ok — ${checked} vehicles, worst ${worst.toFixed(0)} m from geometry`)
