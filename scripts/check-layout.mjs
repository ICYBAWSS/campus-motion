import assert from 'node:assert/strict'

const CENTER = [40.5028, -74.447]
const M_PER_UNIT = 50
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574

const toUnit = (lat, lon) => [((lon - CENTER[1]) * KX) / M_PER_UNIT, (-(lat - CENTER[0]) * KY) / M_PER_UNIT]

const near = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got.toFixed(3)}, want ${want}`)

const arc = toUnit(40.52371, -74.46508)
const bsc = toUnit(40.52359, -74.45811)
const cook = toUnit(40.47993, -74.43249) // Biel Road, southernmost stop

// recomputed when the frame widened to the whole campus (origin 40.5028,-74.4470)
near(arc[0], -30.61, 0.4, 'ARC stop x')
near(arc[1], -46.24, 0.4, 'ARC stop z')
near(bsc[0], -18.81, 0.4, 'BSC stop x')
near(bsc[1], -45.98, 0.4, 'BSC stop z')
near(cook[0], 24.56, 0.4, 'Cook Biel Road x')
near(cook[1], 50.58, 0.4, 'Cook Biel Road z')

near(Math.hypot(bsc[0] - arc[0], bsc[1] - arc[1]) * M_PER_UNIT, 590.1, 2, 'ARC-BSC separation (m)')
const bearing = (Math.atan2(bsc[0] - arc[0], -(bsc[1] - arc[1])) * 180) / Math.PI
near(bearing, 91.3, 0.5, 'bearing ARC -> BSC')

assert.ok(arc[1] < -40, 'Busch must be north of the origin')
assert.ok(cook[1] > 40, 'Cook must be south of the origin')

console.log('layout ok')
