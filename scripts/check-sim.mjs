/**
 * Engine invariants for the rebuilt simulation.
 * Run: node scripts/check-sim.mjs
 */
import assert from 'node:assert/strict'
import { createSim, STOPS } from '../src/sim.ts'

const sim = createSim({ population: 800, seed: 11 })
sim.runTo(11 * 60)

const states = { home: 0, 'walk-stop': 0, wait: 0, ride: 0, 'walk-dest': 0, 'at-dest': 0 }
let outside = 0
for (const a of sim.agents) {
  states[a.state]++
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) throw new Error(`agent ${a.id} has a NaN position`)
  if (Math.abs(a.x) > 70 || Math.abs(a.z) > 110) outside++
}
assert.equal(outside, 0, `${outside} agents outside the campus frame`)
assert.ok(states['walk-stop'] + states['walk-dest'] > 0, 'somebody is walking')
assert.ok(
  Object.values(states).reduce((a, b) => a + b, 0) === sim.agents.length,
  'every agent has exactly one state',
)

// riders must be on a bus that lists them
let ghosts = 0
for (const b of sim.buses) {
  for (const id of b.riders) if (sim.agents[id].state !== 'ride') ghosts++
}
assert.equal(ghosts, 0, `${ghosts} riders are on a bus while not in the ride state`)

// a queue only holds people who are actually waiting there
let wrongQueue = 0
for (const [k, ids] of Object.entries(sim.queue)) {
  for (const id of ids) {
    const a = sim.agents[id]
    if (a.state !== 'wait' || a.stop !== k) wrongQueue++
  }
}
assert.equal(wrongQueue, 0, `${wrongQueue} agents are queued somewhere they are not`)

// every stop key must be real
for (const b of sim.buses)
  for (const s of b.route.stops) assert.ok(STOPS[s], `route ${b.route.ref} references unknown stop ${s}`)

console.log(
  `sim ok — ${sim.agents.length} agents ` +
    `(${states['walk-stop'] + states['walk-dest']} walking, ${states.wait} waiting, ${states.ride} riding), ` +
    `${sim.buses.length} buses`,
)
