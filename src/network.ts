import net from './network.json' with { type: 'json' }

export type P = [number, number]

type Edge = { a: P; b: P; drive: boolean; walk: boolean; kind: string }

const key = (p: P) => `${p[0]},${p[1]}`

/** walkable graph, built once */
const adj = new Map<string, { to: string; cost: number; pt: P }[]>()
const nodes = new Map<string, P>()

for (const e of (net as unknown as { edges: Edge[] }).edges) {
  if (!e.walk) continue
  const ka = key(e.a as P)
  const kb = key(e.b as P)
  nodes.set(ka, e.a as P)
  nodes.set(kb, e.b as P)
  const cost = Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1])
  if (!adj.has(ka)) adj.set(ka, [])
  if (!adj.has(kb)) adj.set(kb, [])
  adj.get(ka)!.push({ to: kb, cost, pt: e.b as P })
  adj.get(kb)!.push({ to: ka, cost, pt: e.a as P })
}

const nodeList = [...nodes.entries()]

function snap(p: P): string {
  let best = ''
  let bd = Infinity
  for (const [k, q] of nodeList) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (d < bd) {
      bd = d
      best = k
    }
  }
  return best
}

export function pathLength(path: P[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++)
    n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  return n
}

/** position at arc-length fraction f along a polyline */
export function samplePath(path: P[], f: number): P {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]
  const total = pathLength(path)
  let want = Math.max(0, Math.min(1, f)) * total
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (seg <= 1e-6) continue
    if (want <= seg) {
      const r = want / seg
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * r,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * r,
      ]
    }
    want -= seg
  }
  return path[path.length - 1]
}

const memo = new Map<string, P[]>()

/**
 * Walking route over the real footway graph.
 * ponytail: A* per leg with a coordinate-keyed memo — fine for a few thousand
 * distinct origins/destinations; switch to contraction hierarchies if the
 * population ever grows past a few thousand agents.
 */
export function walkRoute(from: P, to: P): P[] {
  const mk = `${from[0].toFixed(1)},${from[1].toFixed(1)}|${to[0].toFixed(1)},${to[1].toFixed(1)}`
  const hit = memo.get(mk)
  if (hit) return hit

  const start = snap(from)
  const goal = snap(to)
  let out: P[]
  if (!start || !goal || start === goal) {
    out = [from, to]
  } else {
    const [gx, gz] = nodes.get(goal)!
    const g = new Map<string, number>([[start, 0]])
    const came = new Map<string, string>()
    const open: [number, string][] = [[0, start]]
    const h = (k: string) => {
      const p = nodes.get(k)!
      return Math.hypot(p[0] - gx, p[1] - gz)
    }
    while (open.length) {
      open.sort((a, b) => a[0] - b[0])
      const cur = open.shift()![1]
      if (cur === goal) break
      for (const e of adj.get(cur) ?? []) {
        const ng = (g.get(cur) ?? Infinity) + e.cost
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng)
          came.set(e.to, cur)
          open.push([ng + h(e.to), e.to])
        }
      }
    }
    if (!came.has(goal)) {
      out = [from, to]
    } else {
      const rev: P[] = [nodes.get(goal)!]
      let cur = goal
      while (came.has(cur)) {
        cur = came.get(cur)!
        rev.push(nodes.get(cur)!)
      }
      rev.reverse()
      out = [from, ...rev, to]
    }
  }
  memo.set(mk, out)
  return out
}
