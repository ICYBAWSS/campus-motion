/**
 * The simulation. Everything visible in the scene is a state of this file.
 *
 * Units: 1 scene unit = 50 m, 1 tick = 1 simulated minute.
 * Speeds are therefore in units per minute: 18 km/h = 6 u/min, walking 1.35 m/s = 1.62 u/min.
 */
import stopsData from './data/stops.json' with { type: 'json' }
import routesData from './data/routes.json' with { type: 'json' }
import pathsData from './data/paths.json' with { type: 'json' }
import placesData from './data/places.json' with { type: 'json' }
import { pathLength, samplePath, walkRoute, type P } from './network.ts'

export type StopKey = keyof typeof stopsData
export type Stop = { label: string; lat: number; lon: number; at: P }

export const STOPS = stopsData as unknown as Record<string, Stop>

export type Route = {
  ref: string
  colour: string
  stops: string[]
  path: P[]
  len: number
  /** arc-length position of each stop along the loop */
  halt: number[]
}

const PALETTE: Record<string, string> = {
  A: '#7b478a',
  B: '#1f6f3f',
  'B/L': '#818489',
  C: '#1d4ed8',
  EE: '#b45309',
  F: '#0f766e',
  H: '#be123c',
  Lx: '#0369a1',
  RexB: '#a16207',
  RexL: '#4d7c0f',
  W1: '#9333ea',
  W2: '#c026d3',
}

function projectOnLoop(path: P[], p: P): number {
  let best = 0
  let bestD = Infinity
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz || 1
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2
    t = Math.max(0, Math.min(1, t))
    const qx = a[0] + dx * t
    const qz = a[1] + dz * t
    const d = (qx - p[0]) ** 2 + (qz - p[1]) ** 2
    if (d < bestD) {
      bestD = d
      best = acc + Math.sqrt(l2) * t
    }
    acc += Math.sqrt(l2)
  }
  return best
}

export const ROUTES: Route[] = (routesData as unknown as { ref: string; stops: string[] }[]).map((r) => {
  const path = (pathsData as unknown as Record<string, P[]>)[r.ref]
  return {
    ref: r.ref,
    colour: PALETTE[r.ref] ?? '#64748b',
    stops: r.stops,
    path,
    len: pathLength(path),
    halt: r.stops.map((k) => projectOnLoop(path, STOPS[k].at)),
  }
})

/* ------------------------------------------------------------------ */
/* tuning                                                             */
/* ------------------------------------------------------------------ */
export const BUS_SPEED = 6 // units/min = 18 km/h
export const WALK_SPEED = 1.62 // units/min = 4.86 km/h
/**
 * Rutgers buses seat about 44 and stand to roughly 77 total. Each vehicle draws
 * its own figure from this band so a mixed fleet behaves like a real one — some
 * buses fill early and leave people behind, others take the overflow.
 */
export const CAPACITY_MIN = 70
export const CAPACITY_MAX = 84
export const CAPACITY = 77 // nominal, for thresholds and labels
export const DWELL = 0.4 // minutes at each stop
export const START = 7 * 60 // 07:00

/** headway in minutes per route, weekday daytime. Anything not listed runs at 12. */
const HEADWAY: Record<string, number> = {
  A: 6,
  B: 5,
  C: 12,
  H: 7,
  RexB: 9,
  RexL: 7,
  Lx: 4,
  EE: 10,
  F: 10,
  'B/L': 12,
  W1: 15,
  W2: 15,
}

export type AgentState = 'home' | 'walk-stop' | 'wait' | 'ride' | 'walk-dest' | 'at-dest'

export type Agent = {
  id: number
  state: AgentState
  /** current position, and the position one tick ago (for interpolation) */
  x: number
  z: number
  px: number
  pz: number
  col: string
  home: P
  dest: P
  stop: string
  /** walk leg: polyline + start/end minute */
  leg: { path: P[]; t0: number; t1: number } | null
  /** minutes spent in the current state */
  since: number
  bus: number
  /** the stop they alight at */
  destStop: string
  /** time they must be at their destination */
  due: number
}

export type Bus = {
  route: Route
  /** distance along the loop */
  d: number
  /** distance one tick ago — interpolate along the path, never across it */
  pd: number
  x: number
  z: number
  px: number
  pz: number
  dwell: number
  riders: number[]
  /** this vehicle's own legal load, drawn once at spawn */
  capacity: number
  /** next stop index this bus will serve */
  next: number
}

const SHIRTS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#4b5563', '#be185d']

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export type Sim = ReturnType<typeof createSim>

export function createSim(opts: { population?: number; seed?: number } = {}) {
  const population = opts.population ?? 600
  const rand = rng(opts.seed ?? 7)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length) % xs.length]

  const stopKeys = Object.keys(STOPS)
  const places = placesData as unknown as { x: number; z: number; s: string }[]
  const carriers = ROUTES.filter((r) => r.stops.length >= 2)

  /* ---------------- agents ---------------- */
  const agents: Agent[] = []
  for (let i = 0; i < population; i++) {
    const from = places.length ? pick(places) : { x: 0, z: 0, s: pick(stopKeys) }
    const home: [number, number] = [from.x, from.z]
    const homeKey = from.s
    // most people leave home once and come back; the rest stay put
    const to = places.length && rand() >= 0.25 ? pick(places) : from
    const dest: [number, number] = [to.x, to.z]
    const destKey = to.s
    agents.push({
      id: i,
      state: 'home',
      x: home[0],
      z: home[1],
      px: home[0],
      pz: home[1],
      col: SHIRTS[i % SHIRTS.length],
      home,
      dest,
      stop: homeKey,
      destStop: destKey,
      leg: null,
      since: START,
      bus: -1,
      // two waves: the morning rush and the evening one, so the campus is never
      // empty and never uniformly busy
      due: START + (rand() < 0.65 ? 45 + Math.floor(rand() * 90) : 540 + Math.floor(rand() * 150)),
    })
  }

  /* ---------------- buses ---------------- */
  const buses: Bus[] = []
  for (const route of carriers) {
    const headway = HEADWAY[route.ref] ?? 12
    const cycle = route.len / BUS_SPEED + route.stops.length * DWELL
    const n = Math.max(1, Math.round(cycle / headway))
    for (let k = 0; k < n; k++) {
      const d = (route.len * k) / n
      const p = samplePath(route.path, d / route.len)
      buses.push({
        route,
        d,
        pd: d,
        x: p[0],
        z: p[1],
        px: p[0],
        pz: p[1],
        dwell: 0,
        riders: [],
        capacity: CAPACITY_MIN + Math.floor(rand() * (CAPACITY_MAX - CAPACITY_MIN + 1)),
        next: 0,
      })
    }
  }

  /* ---------------- the day ---------------- */
  const queue: Record<string, number[]> = {}
  const boardings: Record<string, number[]> = {}
  /** people waiting at each stop, one sample per minute */
  const history: Record<string, number[]> = {}
  for (const k of stopKeys) {
    queue[k] = []
    boardings[k] = []
    history[k] = []
  }

  let minute = START

  function walkLeg(from: P, to: P, t0: number) {
    const path = walkRoute(from, to)
    return { path, t0, t1: t0 + Math.max(1, pathLength(path) / WALK_SPEED) }
  }

  function step(t: number) {
    for (const a of agents) {
      a.px = a.x
      a.pz = a.z
    }
    for (const b of buses) {
      b.px = b.x
      b.pz = b.z
      b.pd = b.d
    }

    /* buses move along their loop, dwelling at stops */
    for (const b of buses) {
      if (b.dwell > 0) {
        b.dwell = Math.max(0, b.dwell - 1)
        continue
      }
      const before = b.d
      b.d = (b.d + BUS_SPEED) % b.route.len
      // crossing a halt starts a dwell and lets people off and on
      for (let i = 0; i < b.route.halt.length; i++) {
        const h = b.route.halt[i]
        const crossed = before <= b.d ? h > before && h <= b.d : h > before || h <= b.d
        if (!crossed) continue
        b.dwell = DWELL
        b.next = (i + 1) % b.route.halt.length
        const key = b.route.stops[i]
        // off
        const staying: number[] = []
        for (const id of b.riders) {
          const a = agents[id]
          if (a.destStop === key) {
            a.state = 'walk-dest'
            a.since = t
            a.bus = -1
            a.x = STOPS[key].at[0]
            a.z = STOPS[key].at[1]
            a.leg = walkLeg([a.x, a.z], a.dest, t)
          } else staying.push(id)
        }
        b.riders = staying
        // on: anyone waiting here whose destination is served by this route
        const wants = queue[key]
        const keep: number[] = []
        for (const id of wants) {
          const a = agents[id]
          const ok = b.riders.length < b.capacity && b.route.stops.includes(a.destStop)
          if (ok) {
            a.state = 'ride'
            a.bus = buses.indexOf(b)
            a.since = t
            b.riders.push(id)
          } else keep.push(id)
        }
        queue[key] = keep
        boardings[key][t - START] = (boardings[key][t - START] ?? 0) + (wants.length - keep.length)
      }
      const p = samplePath(b.route.path, b.d / b.route.len)
      b.x = p[0]
      b.z = p[1]
    }

    /* agents */
    for (const a of agents) {
      switch (a.state) {
        case 'home': {
          if (t < a.due - 40) break
          a.state = 'walk-stop'
          a.since = t
          a.leg = walkLeg([a.x, a.z], STOPS[a.stop].at, t)
          break
        }
        case 'walk-stop':
        case 'walk-dest': {
          const leg = a.leg
          if (!leg) break
          const f = (t - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)
          const p = samplePath(leg.path, f)
          a.x = p[0]
          a.z = p[1]
          if (f >= 1) {
            a.leg = null
            if (a.state === 'walk-stop') {
              a.state = 'wait'
              a.since = t
              if (!queue[a.stop].includes(a.id)) queue[a.stop].push(a.id)
            } else {
              a.state = 'at-dest'
              a.since = t
            }
          }
          break
        }
        case 'wait':
          break
        case 'ride':
          break
        case 'at-dest': {
          if (t - a.since < 45) break
          a.state = 'walk-dest'
          a.since = t
          a.dest = a.home
          a.leg = walkLeg([a.x, a.z], a.home, t)
          break
        }
      }
    }

    for (const k of stopKeys) queue[k] = queue[k].filter((id) => agents[id].state === 'wait')
    for (const k of stopKeys) history[k][t - START] = queue[k].length

    minute = t + 1
  }

  return {
    agents,
    buses,
    queue,
    boardings,
    history,
    get minute() {
      return minute
    },
    /** advance to an absolute minute; no-op if already there */
    runTo(target: number) {
      while (minute < target) step(minute)
    },
    stats() {
      let waiting = 0
      let riding = 0
      let walking = 0
      for (const a of agents) {
        if (a.state === 'wait') waiting++
        else if (a.state === 'ride') riding++
        else if (a.state === 'walk-stop' || a.state === 'walk-dest') walking++
      }
      return { waiting, riding, walking, fleet: buses.length }
    },
  }
}
