/**
 * The simulation: people, not formulas.
 *
 * Every number the dashboard shows is a count over agents — the queue at a stop is how many agents
 * are standing there, a bus's load is how many are riding it. There is no arrival rate, no supply
 * formula, no decorative crowd.
 *
 * Agents live in real Rutgers buildings, have a plan for the day (class, lunch, home), walk at
 * walking speed, queue at the stop nearest their destination, board a bus that can actually take
 * them where they are going, ride, alight and walk to the door.
 */

export type StopId = string
export type BuildingId = number

export type BuildingSpec = {
  id: BuildingId
  x: number
  z: number
  kind: string
  /** nearest stop, precomputed by the caller */
  stop: StopId
}

export type RouteSpec = {
  ref: string
  stops: StopId[]
  /** distance of each stop along the path, same order as `stops` */
  haltD: number[]
  len: number
  /** scene units per minute */
  speed: number
  /** vehicles in service */
  fleet: number
  /** path distance -> scene position, supplied by the caller (it owns the geometry) */
  sample: (d: number) => { x: number; z: number }
}

export type SimWorld = {
  buildings: BuildingSpec[]
  stops: Record<StopId, [number, number]>
  routes: RouteSpec[]
  capacity: number
  /** scene units per minute: 1.35 m/s at 50 m per unit */
  walkSpeed: number
  population: number
  seed: number
  /** clock minute at sim minute 0 (e.g. 14:00 = 840), so plans land at the right time of day */
  startClock: number
}

import { pathLength, samplePath, walkRoute, type P } from './network'

export type AgentState = 'home' | 'walk-stop' | 'wait' | 'ride' | 'walk-dest' | 'at-dest'

type Appointment = { t: number; building: BuildingId; until: number }

export type Agent = {
  id: number
  home: BuildingId
  dest: BuildingId
  x: number
  z: number
  /** where they were one simulated minute ago, for interpolation */
  px: number
  pz: number
  state: AgentState
  /** minute the current state began */
  since: number
  stop: StopId
  /** index into the bus list while riding, -1 otherwise */
  bus: number
  colour: string
  plan: Appointment[]
  /** the footway path being walked, and when it ends */
  leg: { path: P[]; t0: number; t1: number } | null
  /** boarding bookkeeping while riding */
  boardAt: number
  alightAt: number
  /** the appointment this trip is for */
  target: number
  /** when the current appointment ends, for at-dest */
  until: number
  /** true when this agent is registered in its stop's waiting list */
  queued: boolean
}

export type Bus = {
  /** previous position, for interpolation */
  px: number
  pz: number
  ref: string
  route: RouteSpec
  /** unbounded distance along the path */
  at: number
  x: number
  z: number
  halt: number
  wait: number
  riders: number[]
  capacity: number
}

export type SimRun = {
  from: number
  to: number
  stops: StopId[]
  /** agents standing at each stop, per minute */
  queue: Record<StopId, number[]>
  /** agents that boarded there, per minute */
  boarded: Record<StopId, number[]>
  /** still standing when the bus that served them was full */
  leftBehind: Record<StopId, number[]>
  /** mean door-to-door minutes by origin stop */
  meanTrip: Record<StopId, number>
  /** bus positions, per minute */
  buses: { ref: string; track: { t: number; d: number; load: number; halt: StopId | null }[] }[]
  /** agents as they are at the end of the run */
  agents: Agent[]
  /** completed journeys, for the witness layer */
  trips: { origin: StopId; dest: StopId; ref: string; board: number; alight: number }[]
}

const SHIRTS = ['#ee0000', '#1e3a8a', '#0f766e', '#f59e0b', '#7c3aed', '#0891b2', '#c2410c', '#4d7c0f']

export const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** the next time this halt is reached on the bus's current lap */
const ahead = (d: number, len: number, at: number) => {
  const lap = Math.floor(at / len)
  const cand = d + lap * len
  return cand >= at ? cand : cand + len
}

/** one agent's day: a few appointments, each a building and a duration */
const planDay = (world: SimWorld, rand: () => number, home: BuildingSpec): Appointment[] => {
  /** clock time -> sim minutes from the start of the run */
  const at = (clockMinute: number) => (clockMinute - world.startClock + 1440) % 1440
  const pick = <T>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(rand() * xs.length)] : undefined)
  const academic = world.buildings.filter((b) => b.kind === 'academic')
  const social = world.buildings.filter((b) => b.kind === 'studentLife')
  const plan: Appointment[] = []
  if (!academic.length) return plan

  // classes and errands run right through the day: an idle campus is a broken campus
  for (const hour of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
    if (rand() > 0.55) continue
    const t = at(hour * 60 + Math.floor(rand() * 80))
    const b = pick(academic) ?? home
    plan.push({ t, building: b.id, until: t + 75 + Math.floor(rand() * 40) })
  }
  if (rand() < 0.8) {
    const t = at(12 * 60 + Math.floor(rand() * 50))
    const b = pick(social) ?? pick(academic) ?? home
    plan.push({ t, building: b.id, until: t + 45 })
  }
  return plan.sort((a, b) => a.t - b.t)
}

/** a live simulation: step it forward one simulated minute at a time */
export type Sim = {
  agents: Agent[]
  buses: Bus[]
  queue: Record<StopId, number[]>
  boarded: Record<StopId, number[]>
  leftBehind: Record<StopId, number[]>
  runTo: (minute: number) => void
  minute: number
  snapshot: () => SimRun
}

export function createSim(world: SimWorld, from = 0): Sim {
  const rand = prng(world.seed)
  const stops = Object.keys(world.stops)
  const zero = () => Object.fromEntries(stops.map((k) => [k, [] as number[]])) as Record<StopId, number[]>

  const queue = zero()
  const boarded = zero()
  const leftBehind = zero()
  const waiting = Object.fromEntries(stops.map((k) => [k, [] as number[]])) as Record<StopId, number[]>
  const totals = Object.fromEntries(stops.map((k) => [k, { sum: 0, n: 0 }])) as Record<
    StopId,
    { sum: number; n: number }
  >
  const trips: SimRun['trips'] = []

  const track: SimRun['buses'][number]['track'][] = []
  const buses: Bus[] = []
  for (const route of world.routes) {
    for (let i = 0; i < route.fleet; i++) {
      const at = (i / Math.max(1, route.fleet)) * route.len
      const p = route.sample(at)
      buses.push({
        ref: route.ref,
        route,
        at,
        x: p.x,
        z: p.z,
        px: p.x,
        pz: p.z,
        halt: 0,
        wait: 0,
        riders: [],
        capacity: world.capacity,
      })
      track.push([])
    }
  }

  const byId = new Map(world.buildings.map((b) => [b.id, b]))
  const housing = world.buildings.filter((b) => b.kind === 'housing')
  const homes = housing.length ? housing : world.buildings

  const agents: Agent[] = []
  for (let i = 0; i < world.population; i++) {
    const home = homes[Math.floor(rand() * homes.length)]
    if (!home) break
    agents.push({
      id: i,
      home: home.id,
      dest: home.id,
      x: home.x,
      z: home.z,
      px: home.x,
      pz: home.z,
      state: 'home',
      since: from,
      stop: home.stop,
      bus: -1,
      colour: SHIRTS[i % SHIRTS.length],
      plan: planDay(world, rand, home),
      leg: null,
      boardAt: -1,
      alightAt: -1,
      target: -1,
      until: from,
      queued: false,
    })
  }

  const pointOf = (id: BuildingId): [number, number] => {
    const b = byId.get(id)
    return b ? [b.x, b.z] : [0, 0]
  }
  const stopOf = (id: BuildingId): StopId => byId.get(id)?.stop ?? agents[0].stop
  /** a walk leg on the real footway network: path, start, and end time */
  const makeLeg = (from2: P, to2: P, t0: number) => {
    const path = walkRoute(from2, to2)
    const minutes = Math.max(1, pathLength(path) / world.walkSpeed)
    return { path, t0, t1: t0 + minutes }
  }

  const arrive = (a: Agent, t: number) => {
    const appt = a.plan.find((p) => p.building === a.dest && p.t <= t + 1)
    a.state = 'at-dest'
    a.since = t
    a.until = appt?.until ?? t + 45
  }

  const tick = (t: number) => {
    for (const a of agents) {
      a.px = a.x
      a.pz = a.z
    }

    // ---------- people ----------
    for (const a of agents) {
      switch (a.state) {
        case 'home': {
          const next = a.plan.find((p) => p.t > t)
          if (!next) break
          const destPt = pointOf(next.building)
          const leaveAt =
            next.t - Math.max(3, pathLength(walkRoute([a.x, a.z], destPt)) / world.walkSpeed) - 1
          if (t >= leaveAt) {
            a.dest = next.building
            a.target = next.t
            a.stop = stopOf(next.building)
            a.state = 'walk-stop'
            a.since = t
            a.leg = makeLeg([a.x, a.z], world.stops[a.stop], t)
          }
          break
        }

        case 'walk-stop': {
          const [sx, sz] = world.stops[a.stop]
          const leg = a.leg ?? makeLeg([a.x, a.z], [sx, sz], a.since)
          a.leg = leg
          const [px, pz] = samplePath(leg.path, (t - leg.t0) / Math.max(0.001, leg.t1 - leg.t0))
          a.x = px
          a.z = pz
          if (t >= leg.t1) {
            a.x = sx
            a.z = sz
            a.leg = null
            a.state = 'wait'
            a.since = t
            if (!a.queued) {
              waiting[a.stop].push(a.id)
              a.queued = true
            }
          }
          break
        }

        case 'wait': {
          // 45 minutes of watching full buses go by and they walk
          if (t - a.since > 45) {
            if (a.queued) {
              waiting[a.stop] = waiting[a.stop].filter((x) => x !== a.id)
              a.queued = false
            }
            const d = pointOf(a.dest)
            a.state = 'walk-dest'
            a.since = t
            a.leg = makeLeg([a.x, a.z], d, t)
          }
          break
        }

        case 'walk-dest': {
          const d = pointOf(a.dest)
          const leg = a.leg ?? makeLeg([a.x, a.z], d, a.since)
          a.leg = leg
          const [px, pz] = samplePath(leg.path, (t - leg.t0) / Math.max(0.001, leg.t1 - leg.t0))
          a.x = px
          a.z = pz
          if (t >= leg.t1) {
            a.leg = null
            arrive(a, t)
          }
          break
        }

        case 'at-dest': {
          if (t >= a.until) {
            const home = byId.get(a.home)!
            a.dest = home.id
            a.state = 'walk-dest'
            a.since = t
            a.leg = makeLeg([a.x, a.z], [home.x, home.z], t)
          }
          break
        }

        default:
          break
      }
    }

    // ---------- vehicles ----------
    for (let bi = 0; bi < buses.length; bi++) {
      const b = buses[bi]
      const route = b.route
      const target = ahead(route.haltD[b.halt % route.stops.length], route.len, b.at)

      if (b.wait > 0.001) {
        b.wait = Math.max(0, b.wait - 1)
      } else if (b.at + route.speed < target) {
        b.at += route.speed
      } else {
        b.at = target
        const here = route.stops[b.halt % route.stops.length]

        // alight
        const staying: number[] = []
        let alighted = 0
        for (const ai of b.riders) {
          const a = agents[ai]
          if (a.alightAt > b.at + 1e-6) {
            staying.push(ai)
            continue
          }
          alighted++
          a.state = 'walk-dest'
          a.since = t
          a.bus = -1
          a.x = b.x
          a.z = b.z
          const d = pointOf(a.dest)
          a.leg = makeLeg([a.x, a.z], d, t)
          const tot = totals[here]
          if (a.boardAt >= 0) {
            tot.sum += t - a.boardAt
            tot.n += 1
            if (trips.length < 600) {
              trips.push({ origin: here, dest: stopOf(a.dest), ref: b.ref, board: a.boardAt, alight: t })
            }
          }
        }
        b.riders = staying

        // board: only people this route can carry towards their destination stop
        const here_q = waiting[here]
        let seated = 0
        const left: number[] = []
        for (const ai of here_q) {
          const a = agents[ai]
          if (a.state !== 'wait') continue
          const destStop = stopOf(a.dest)
          const idx = route.stops.indexOf(destStop)
          const seats = b.capacity - b.riders.length - seated
          if (idx < 0 || seats < 1) {
            left.push(ai)
            continue
          }
          const alightAt = ahead(route.haltD[idx], route.len, b.at)
          if (alightAt <= b.at + 0.5) {
            left.push(ai)
            continue
          }
          a.queued = false
          a.state = 'ride'
          a.bus = bi
          a.boardAt = t
          a.alightAt = alightAt
          b.riders.push(ai)
          seated++
        }
        waiting[here] = left

        boarded[here].push(seated)
        leftBehind[here].push(left.length)
        b.wait = Math.max(4 / 60, Math.max(seated, alighted) / 120)
        b.halt++
      }

      const p = route.sample(b.at % route.len)
      b.px = b.x
      b.pz = b.z
      b.x = p.x
      b.z = p.z
      track[bi].push({ t, d: b.at % route.len, load: b.riders.length, halt: null })
    }

    // ---------- riders ride ----------
    for (const b of buses)
      for (const ai of b.riders) {
        agents[ai].x = b.x
        agents[ai].z = b.z
      }

    // ---------- record ----------
    for (const k of stops) {
      queue[k].push(waiting[k].length)
      if (boarded[k].length < t - from + 1) boarded[k].push(0)
      if (leftBehind[k].length < t - from + 1) leftBehind[k].push(0)
    }
  }
  let minute = from
  const runTo = (target: number) => {
    // guard: never simulate more than a day forward in one call
    const stop = Math.min(target, from + 24 * 60)
    while (minute < stop) {
      tick(minute)
      minute++
    }
  }

  const snapshot = (): SimRun => {
    const meanTrip = {} as Record<StopId, number>
    for (const [k, v] of Object.entries(totals)) meanTrip[k] = v.n ? v.sum / v.n : 0
    return {
      from,
      to: minute,
      stops,
      queue,
      boarded,
      leftBehind,
      meanTrip,
      buses: buses.map((b, i) => ({ ref: b.ref, track: track[i] ?? [] })),
      agents,
      trips,
    }
  }

  return {
    agents,
    buses,
    queue,
    boarded,
    leftBehind,
    runTo,
    get minute() {
      return minute
    },
    snapshot,
  }
}

/** one-shot run, used by the tests */
export function runAgents(world: SimWorld, to: number, from = 0): SimRun {
  const sim = createSim(world, from)
  sim.runTo(to)
  return sim.snapshot()
}
