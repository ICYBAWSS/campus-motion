import assert from 'node:assert/strict'
import { runFleet } from '../src/sim.ts'

const stops = ['a', 'b', 'c']
const route = {
  ref: 'X',
  colour: '#000',
  len: 30,
  halts: [
    { k: 'a', d: 2 },
    { k: 'b', d: 12 },
    { k: 'c', d: 22 },
  ],
  headway: () => 10,
}

const arrivals = (stop) => {
  if (stop === 'a') return [{ dest: 'b', count: 10 }]
  if (stop === 'b') return [{ dest: 'c', count: 10 }]
  return [{ dest: 'a', count: 10 }]
}

const base = {
  stops,
  from: 420,
  to: 660,
  routes: [route],
  fleet: { X: 3 },
  arrivals,
  capacity: 40,
  boardRate: 120,
  baseDwell: 4 / 60,
  speed: 3,
  timepoints: ['b'],
  giveUp: 45,
  breakStops: ['b'],
  breakChance: 0.06,
  breakMinutes: [3, 8],
  reach: { a: new Set(['a', 'b', 'c']), b: new Set(['a', 'b', 'c']), c: new Set(['a', 'b', 'c']) },
  noise: 0,
  seed: 7,
}

const total = (rec) => Object.values(rec).reduce((n, arr) => n + arr.reduce((x, y) => x + y, 0), 0)

const run = runFleet(base)

// 1. nobody appears from nowhere
const arrivalsTotal = stops.length * 10 * (base.to - base.from)
const waitingEnd = Object.values(run.queue).reduce((n, arr) => n + arr[arr.length - 1], 0)
assert.ok(total(run.boarded) + waitingEnd <= arrivalsTotal + 1, 'conservation: more boarded than arrived')
assert.ok(total(run.boarded) > arrivalsTotal * 0.5, 'most people should actually get carried')

// 2. capacity is respected
assert.ok(
  run.buses.every((b) => b.track.every((p) => p.load <= 40)),
  'a bus carried more than its capacity',
)

// 3. journey times are physical
assert.ok(
  Object.values(run.meanTrip).every((m) => m >= 0 && m < 120),
  'trip minutes out of range',
)

// 4. a surge leaves people behind
const crowded = runFleet({ ...base, arrivals: (s) => [{ dest: s === 'a' ? 'b' : 'a', count: 60 }] })
assert.ok(total(crowded.leftBehind) > total(run.leftBehind), 'a surge should strand people')

// 5. extra fleet is not cosmetic
const more = runFleet({ ...base, fleet: { X: 8 } })
assert.ok(total(more.boarded) >= total(run.boarded), 'extra buses carried fewer people')

// 6. one transfer happens instead of a give-up
const stub = {
  ref: 'Y',
  colour: '#000',
  len: 20,
  halts: [
    { k: 'a', d: 1 },
    { k: 'b', d: 9 },
  ],
  headway: () => 10,
}
const viaB = runFleet({
  ...base,
  routes: [route, stub],
  fleet: { X: 2, Y: 3 },
  arrivals: (s) => (s === 'a' ? [{ dest: 'c', count: 20 }] : []),
})
assert.ok(total(viaB.boarded) > 0, 'nobody boarded towards a transfer')
assert.ok(
  Object.values(viaB.transfers).some((n) => n > 0),
  'a rider should change buses rather than give up',
)

// 7. the same seed reproduces the same day
const noisy = { ...base, noise: 1, seed: 11 }
const one = runFleet(noisy)
const two = runFleet(noisy)
const three = runFleet({ ...noisy, seed: 12 })
assert.equal(total(one.boarded), total(two.boarded), 'same seed must replay identically')
assert.notEqual(total(one.boarded), total(three.boarded), 'a new seed should be a different day')

console.log('sim ok')
