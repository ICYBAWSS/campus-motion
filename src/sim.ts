/* src/sim.ts — the transit model. Pure: give it a world, get a day back. */

export type StopId = string

export type RouteSpec = {
  ref: string
  colour: string
  /** path length in scene units */
  len: number
  /** halts in visit order with their distance along the path */
  halts: { k: StopId; d: number }[]
  /** minutes between vehicles, or null when the route is not running */
  headway: (minute: number) => number | null
}

export type SimInput = {
  stops: StopId[]
  from: number
  to: number
  routes: RouteSpec[]
  /** vehicles per route, after any service change and including reserved buses */
  fleet: Record<string, number>
  /** people per minute at a stop, already split by destination */
  arrivals: (stop: StopId, minute: number) => { dest: StopId; count: number }[]
  /** stops reachable from a stop on one bus, for the single-transfer rule */
  reach: Record<StopId, Set<StopId>>
  capacity: number
  /** people per minute through the doors (both doors, no fare) */
  boardRate: number
  baseDwell: number
  /** scene units per minute */
  speed: number
  timepoints: StopId[]
  /** minutes someone waits before giving up and walking */
  giveUp: number
  breakStops: StopId[]
  breakChance: number
  breakMinutes: [number, number]
  /** 0 = deterministic means, 1 = full sampling: some days are just worse */
  noise: number
  seed: number
}

export type Trip = { origin: StopId; dest: StopId; ref: string; board: number; alight: number }

export type SimRun = {
  from: number
  to: number
  stops: StopId[]
  queue: Record<StopId, number[]>
  boarded: Record<StopId, number[]>
  leftBehind: Record<StopId, number[]>
  transfers: Record<StopId, number>
  meanTrip: Record<StopId, number>
  buses: { ref: string; track: { t: number; d: number; load: number; halt: StopId | null }[] }[]
  trips: Trip[]
}

/** seeded PRNG: the same scenario and seed has to replay identically */
export const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** arrivals are a count, not a rate: sampling them is what makes a bad day possible */
const poisson = (lambda: number, rand: () => number) => {
  if (lambda <= 0) return 0
  if (lambda < 20) {
    const limit = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k += 1
      p *= rand()
    } while (p > limit)
    return k - 1
  }
  // normal approximation, O(1) instead of O(lambda)
  const g = Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand())
  return Math.max(0, lambda + Math.sqrt(lambda) * g)
}

/** the next time this halt is reached, given where the bus is on its loop */
const ahead = (d: number, len: number, at: number) => {
  const lap = Math.floor(at / len)
  const cand = d + lap * len
  return cand >= at ? cand : cand + len
}

export function runFleet(input: SimInput): SimRun {
  const { stops, from, to, routes, fleet, capacity, boardRate, baseDwell, speed, timepoints, giveUp } = input
  const zeros = () => Object.fromEntries(stops.map((k) => [k, []])) as Record<StopId, number[]>

  const queue = zeros()
  const boarded = zeros()
  const leftBehind = zeros()
  const transfers = Object.fromEntries(stops.map((k) => [k, 0])) as Record<StopId, number>
  const waiting = new Map(
    stops.map((k) => [k, [] as { dest: StopId; count: number; since: number; leg: number }[]]),
  )
  const sums = new Map(stops.map((k) => [k, { total: 0, n: 0 }]))
  const trips: Trip[] = []
  const rand = prng(input.seed)

  type Ride = {
    origin: StopId
    dest: StopId
    count: number
    alightAt: number
    boardAt: number
    /** set when this leg ends at a transfer stop instead of the destination */
    via: StopId | null
  }
  type Bus = {
    ref: string
    route: RouteSpec
    at: number
    halt: number
    wait: number
    load: number
    riding: Ride[]
    rand: () => number
    track: SimRun['buses'][number]['track']
  }

  const buses: Bus[] = []
  for (const route of routes) {
    const n = fleet[route.ref] ?? 0
    for (let i = 0; i < n; i++) {
      buses.push({
        ref: route.ref,
        route,
        at: (i / Math.max(1, n)) * route.len, // spread around the loop, not all at one end
        halt: 0,
        wait: 0,
        load: 0,
        riding: [],
        rand: prng(i * 7919 + route.ref.length * 31),
        track: [],
      })
    }
  }

  for (let t = from; t < to; t++) {
    // 1. people appear, in cohorts that know where they are going
    for (const k of stops) {
      const q = waiting.get(k)!
      for (const a of input.arrivals(k, t)) {
        const mean = a.count
        const count = input.noise <= 0 ? mean : mean + input.noise * (poisson(mean, rand) - mean)
        if (count < 0.02) continue
        const same = q.find((c) => c.dest === a.dest && c.leg === 1)
        if (same) same.count += count
        else q.push({ dest: a.dest, count, since: t, leg: 1 })
      }
      for (const c of q) if (t - c.since > giveUp) c.count = 0 // walked away
      for (let i = q.length - 1; i >= 0; i--) if (q[i].count < 0.02) q.splice(i, 1)
    }

    // 2. vehicles
    for (const b of buses) {
      const halts = b.route.halts
      const h = halts[b.halt % halts.length]
      const target = ahead(h.d, b.route.len, b.at)

      if (b.wait > 0.01) {
        b.wait = Math.max(0, b.wait - 1)
        b.track.push({ t, d: b.at % b.route.len, load: b.load, halt: h.k })
        continue
      }

      if (b.at + speed < target) {
        b.at += speed
        b.track.push({ t, d: b.at % b.route.len, load: b.load, halt: null })
        continue
      }

      b.at = target

      // alight first: the door is shared and the seats only exist once they leave
      let alighted = 0
      b.riding = b.riding.filter((r) => {
        if (r.alightAt > b.at + 1e-6) return true
        alighted += r.count
        if (r.via) {
          // end of leg one: back into the queue, one transfer used
          transfers[r.via] += r.count
          const q = waiting.get(r.via)!
          const same = q.find((c) => c.dest === r.dest && c.leg === 2)
          if (same) same.count += r.count
          else q.push({ dest: r.dest, count: r.count, since: t, leg: 2 })
          return false
        }
        const sum = sums.get(r.origin)!
        sum.total += (t - r.boardAt) * r.count
        sum.n += r.count
        if (trips.length < 400) {
          trips.push({ origin: r.origin, dest: r.dest, ref: b.ref, board: r.boardAt, alight: t })
        }
        return false
      })
      b.load -= alighted

      // board: only the people this bus can carry towards their stop, directly or to a transfer
      let seated = 0
      const q = waiting.get(h.k)!
      for (const c of q) {
        if (c.count < 0.02) continue
        let to = halts.find((x) => x.k === c.dest)
        let via: StopId | null = null
        if (!to && c.leg < 2) {
          // one transfer allowed: ride to a stop from which the destination is a direct hop
          for (const x of halts) {
            if (ahead(x.d, b.route.len, b.at) <= b.at + 0.5) continue
            if (input.reach[x.k]?.has(c.dest)) {
              to = x
              via = x.k
              break
            }
          }
        }
        if (!to) continue // this bus cannot help them: they wait for another route
        const seats = capacity - b.load - seated
        if (seats < 1) break
        const take = Math.min(c.count, seats)
        c.count -= take
        seated += take
        b.load += take
        b.riding.push({
          origin: h.k,
          dest: c.dest,
          count: take,
          alightAt: ahead(to.d, b.route.len, b.at),
          boardAt: t,
          via,
        })
      }
      boarded[h.k].push(seated)
      leftBehind[h.k].push(q.reduce((n, c) => n + c.count, 0))

      // front and rear doors in parallel, no fare: the slower stream sets the dwell
      b.wait = Math.max(baseDwell, Math.max(seated, alighted) / boardRate)

      // timepoint: if I am too close behind the bus ahead, wait here and let the gap open
      if (timepoints.includes(h.k)) {
        const targetGap = 0.5 * (b.route.headway(t) ?? 10)
        let gap = Infinity
        for (const other of buses) {
          if (other === b || other.route.ref !== b.route.ref) continue
          let delta = other.at - b.at // positive: that bus is ahead of me
          delta = ((delta % b.route.len) + b.route.len) % b.route.len
          if (delta > 0.001) gap = Math.min(gap, delta / speed)
        }
        if (gap < targetGap) b.wait += targetGap - gap
      }

      // driver break: only where there is somewhere to lay over, seeded so the day replays
      if (input.breakStops.includes(h.k) && b.rand() < input.breakChance) {
        const [lo, hi] = input.breakMinutes
        b.wait += lo + b.rand() * (hi - lo)
      }

      b.halt += 1
    }

    // 3. snapshot
    for (const k of stops) {
      const q = waiting.get(k)!
      queue[k].push(q.reduce((n, c) => n + c.count, 0))
      if (boarded[k].length < t - from + 1) boarded[k].push(0)
      if (leftBehind[k].length < t - from + 1) leftBehind[k].push(0)
    }
  }

  const meanTrip = {} as Record<StopId, number>
  for (const [k, v] of sums) meanTrip[k] = v.n > 0 ? v.total / v.n : 0

  return {
    from,
    to,
    stops,
    queue,
    boarded,
    leftBehind,
    transfers,
    meanTrip,
    buses: buses.map((b) => ({ ref: b.ref, track: b.track })),
    trips,
  }
}

/** 40 witness people, each with a whole day taken from the run's own trips */
export type Agent = {
  id: number
  home: StopId
  dest: StopId
  leave: number
  board: number
  alight: number
  classEnd: number
  backBoard: number
  backAlight: number
}

export function buildAgents(run: SimRun, walkMin: Record<StopId, number>, count = 40): Agent[] {
  const out: Agent[] = []
  // spread the sample across the whole day — the first N trips are all at 5am, which is why
  // nobody was ever on screen at a normal hour
  const stride = Math.max(1, Math.floor(run.trips.length / count))
  for (let i = 0; i < run.trips.length && out.length < count; i += stride) {
    const trip = run.trips[i]
    if (trip.alight - trip.board < 1) continue // not worth animating
    const classEnd = trip.alight + 75
    const back = run.trips.find((r) => r.origin === trip.dest && r.dest === trip.origin && r.board > classEnd)
    out.push({
      id: out.length,
      home: trip.origin,
      dest: trip.dest,
      leave: trip.board - (walkMin[trip.origin] ?? 2),
      board: trip.board,
      alight: trip.alight,
      classEnd,
      backBoard: back ? back.board : classEnd + (walkMin[trip.dest] ?? 2),
      backAlight: back ? back.alight : classEnd + (walkMin[trip.dest] ?? 2) * 2,
    })
  }
  return out
}

/** where a witness is at this minute: 'home' | 'walk' | 'wait' | 'ride' | 'class' */
export function agentAt(
  a: Agent,
  minute: number,
): { mode: 'home' | 'walk' | 'wait' | 'ride' | 'class'; from: StopId; to: StopId; f: number } {
  if (minute < a.leave) return { mode: 'home', from: a.home, to: a.home, f: 0 }
  if (minute < a.board) {
    const f = (minute - a.leave) / Math.max(0.5, a.board - a.leave)
    return { mode: f < 0.62 ? 'walk' : 'wait', from: a.home, to: a.home, f: Math.min(1, f) }
  }
  if (minute < a.alight) return { mode: 'ride', from: a.home, to: a.dest, f: 0 }
  if (minute < a.classEnd) {
    const f = (minute - a.alight) / 3
    return { mode: f < 1 ? 'walk' : 'class', from: a.dest, to: a.dest, f: Math.min(1, f) }
  }
  if (minute < a.backBoard) return { mode: 'wait', from: a.dest, to: a.dest, f: 0.6 }
  if (minute < a.backAlight) return { mode: 'ride', from: a.dest, to: a.home, f: 0 }
  const f = Math.min(1, (minute - a.backAlight) / 3)
  return { mode: f < 1 ? 'walk' : 'home', from: a.home, to: a.home, f }
}
