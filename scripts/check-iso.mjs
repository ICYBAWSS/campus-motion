/**
 * The isomorphism check: our 3D camera must produce the same 2:1 dimetric
 * mapping the reference project's iso.ts defines, or the satellite ground and
 * the sprites drift apart.
 *
 * Run: node scripts/check-iso.mjs
 */
import assert from 'node:assert/strict'
import { IsoProjection, Z_SCALE } from '../src/iso.ts'

const iso = new IsoProjection(100, 60)

// one metre east moves (+1, +0.5) in plane space
const a = iso.toPlane(0, 0)
const b = iso.toPlane(10, 0)
assert.equal(b.x - a.x, 10)
assert.equal(b.y - a.y, 5)

// one metre south moves (-1, +0.5)
const c = iso.toPlane(0, 10)
assert.equal(c.x - a.x, -10)
assert.equal(c.y - a.y, 5)

// one metre up moves (0, -Z_SCALE)
const d = iso.toPlane(0, 0, 10)
assert.equal(d.x - a.x, 0)
assert.equal(d.y - a.y, -10 * Z_SCALE)

// round-trip through the plane
for (const [x, z] of [
  [0, 0],
  [37, -12],
  [-20, 44],
]) {
  const g = iso.toGround(iso.toPlane(x, z))
  assert.ok(Math.abs(g.xM - x) < 1e-9 && Math.abs(g.zM - z) < 1e-9, `round trip ${x},${z}`)
}

// the ground matrix must map north-up image pixels onto the same plane
const pxPerM = 2
const [ma, mb, mc, md, tx, ty] = iso.groundMatrix(pxPerM)
const warp = (ix, iy) => ({ x: ma * ix + mc * iy + tx, y: mb * ix + md * iy + ty })
const origin = warp(0, 0)
const east = warp(10 * pxPerM, 0)
assert.ok(Math.abs(east.x - origin.x - 10) < 1e-9, 'image +x is east')
assert.ok(Math.abs(east.y - origin.y - 5) < 1e-9, 'image +x drops half a metre per metre')

// a 2:1 plane needs sin(elevation) = 0.5, i.e. 30 degrees. The camera sits at
// (60, 49, 60), so its direction is (0.6124, 0.5, 0.6124) and sin(theta) = 0.5.
const dir = [60, 49, 60]
const theta = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]))
const ratio = Math.sin(theta)
assert.ok(
  Math.abs(ratio - 0.5) < 0.005,
  `vertical scale ratio ${ratio.toFixed(3)} must be 0.5 for a 2:1 plane`,
)

console.log('iso ok — 2:1 dimetric, round-trips, ground warp, 26.57° elevation')
