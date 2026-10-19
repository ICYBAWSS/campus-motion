/**
 * Bake building centroids into src/data/places.json — the places people come
 * from and go to. Without this, every agent lives at one of 20 bus stops, which
 * is why the campus between stops looks empty.
 *
 * Run: node scripts/build-places.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50
const toUnit = (lat, lon) => [((lon - CENTER[1]) * KX) / M, (-(lat - CENTER[0]) * KY) / M]

const PLACES_URL =
  'https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/Rutgers_University_Buildings/FeatureServer/0/query' +
  '?where=1%3D1&outFields=BldgName,Category,District&outSR=4326&f=geojson&geometryPrecision=6&resultRecordCount=3000'

const stops = JSON.parse(fs.readFileSync(new URL('../src/data/stops.json', import.meta.url)))
const stopKeys = Object.keys(stops)
const nearestStop = (x, z) =>
  stopKeys.reduce((best, k) => {
    const [sx, sz] = stops[k].at
    const db = stops[best].at
    return Math.hypot(sx - x, sz - z) < Math.hypot(db[0] - x, db[1] - z) ? k : best
  }, stopKeys[0])

const geo = await (await fetch(PLACES_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()
const places = []
for (const f of geo.features ?? []) {
  const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0]
  if (!ring || ring.length < 4) continue
  const pts = ring.map(([lon, lat]) => toUnit(lat, lon))
  const x = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const z = pts.reduce((a, p) => a + p[1], 0) / pts.length
  if (!Number.isFinite(x) || Math.abs(x) > 70 || Math.abs(z) > 110) continue
  places.push({
    n: String(f.properties?.BldgName ?? '').slice(0, 60),
    c: String(f.properties?.Category ?? ''),
    x: Number(x.toFixed(2)),
    z: Number(z.toFixed(2)),
    s: nearestStop(x, z),
  })
}

assert.ok(places.length > 400, `expected several hundred buildings, got ${places.length}`)
const byStop = {}
for (const p of places) byStop[p.s] = (byStop[p.s] ?? 0) + 1
fs.writeFileSync(new URL('../src/data/places.json', import.meta.url), JSON.stringify(places))
console.log(`wrote ${places.length} places across ${Object.keys(byStop).length} stops`)
for (const [k, n] of Object.entries(byStop)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)) {
  console.log(`  ${stops[k].label}: ${n}`)
}
