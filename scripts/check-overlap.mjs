/**
 * Do any route points fall inside a building footprint? If they do, a bus will
 * visibly drive through that building, and the fault is between the two source
 * datasets, not in the motion code.
 *
 * Run: node scripts/check-overlap.mjs
 */
import fs from 'node:fs'

const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50
const toUnit = (lat, lon) => [((lon - CENTER[1]) * KX) / M, (-(lat - CENTER[0]) * KY) / M]

const url =
  'https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/Rutgers_University_Buildings/FeatureServer/0/query' +
  '?where=1%3D1&outFields=BldgName&outSR=4326&f=geojson&geometryPrecision=6&resultRecordCount=3000'

const geo = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()
const boxes = []
for (const f of geo.features ?? []) {
  const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0]
  if (!ring || ring.length < 4) continue
  const pts = ring.map(([lon, lat]) => toUnit(lat, lon))
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    z0 = Math.min(z0, z)
    z1 = Math.max(z1, z)
  }
  boxes.push({ name: f.properties?.BldgName ?? '?', pts, x0, x1, z0, z1 })
}

function inside(p, poly) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

const paths = JSON.parse(fs.readFileSync(new URL('../src/data/paths.json', import.meta.url)))
let hits = 0
let total = 0
const offenders = new Map()
for (const [ref, path] of Object.entries(paths)) {
  for (const p of path) {
    total++
    for (const b of boxes) {
      if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.z0 || p[1] > b.z1) continue
      if (inside(p, b.pts)) {
        hits++
        offenders.set(`${ref} in ${b.name}`, (offenders.get(`${ref} in ${b.name}`) ?? 0) + 1)
      }
    }
  }
}

console.log(`${hits} of ${total} route points fall inside a building (${((hits / total) * 100).toFixed(2)}%)`)
for (const [k, n] of [...offenders].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k}: ${n}`)
