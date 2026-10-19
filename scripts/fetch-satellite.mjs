/**
 * Fetch the satellite ground layer for the scene.
 *
 * The scene's projection is linear in degrees (x from longitude, z from
 * latitude), so the raster must be linear in degrees too — request imageSR=4326
 * and size the pixels in the same proportion as the degree box. Sizing by
 * metres instead is what made the first export misregister.
 *
 * Run: node scripts/fetch-satellite.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50

/** scene units -> lon/lat (inverse of toUnit in the app) */
const toLonLat = (x, z) => [CENTER[1] + (x * M) / KX, CENTER[0] - (z * M) / KY]

const FRAME = { x0: -70, x1: 70, z0: -110, z1: 110 }
const [lonW, latN] = toLonLat(FRAME.x0, FRAME.z0)
const [lonE, latS] = toLonLat(FRAME.x1, FRAME.z1) // z1 is south, so latS < latN
const bbox = [lonW, latS, lonE, latN].map((v) => v.toFixed(6)).join(',')

const lonSpan = lonE - lonW
const latSpan = latN - latS
const WIDTH = 1600
const HEIGHT = Math.round((WIDTH * latSpan) / lonSpan)

const url =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
  `?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${WIDTH},${HEIGHT}&format=jpg&f=image&dpi=96`

console.log(`bbox ${bbox}`)
console.log(`degrees ${lonSpan.toFixed(5)} x ${latSpan.toFixed(5)} -> ${WIDTH} x ${HEIGHT} px`)
assert.ok(Math.abs(WIDTH / HEIGHT - lonSpan / latSpan) < 0.01, 'pixel aspect must match the degree box')

const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
const buf = Buffer.from(await res.arrayBuffer())
assert.ok(buf.subarray(0, 2).toString('hex') === 'ffd8', 'response must be a JPEG')
fs.writeFileSync(new URL('../src/data/satellite.jpg', import.meta.url), buf)
console.log(`wrote src/data/satellite.jpg (${(buf.length / 1e6).toFixed(2)} MB)`)
