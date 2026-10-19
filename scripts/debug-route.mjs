import fs from 'node:fs'
const net = JSON.parse(fs.readFileSync(new URL('../src/network.json', import.meta.url)))
const key = (p) => `${p[0]},${p[1]}`
const adj = new Map()
for (const e of net.edges) {
  const a = key(e.a)
  const b = key(e.b)
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  const c = Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1])
  adj.get(a).push({ to: b, cost: c, drive: e.drive, walk: e.walk })
  adj.get(b).push({ to: a, cost: c, drive: e.drive, walk: e.walk })
}
const nodes = [...adj.keys()].map((k) => k.split(',').map(Number))
const byKey = new Map(nodes.map((p) => [key(p), p]))
const snap = (p) => {
  let best = p
  let bd = Infinity
  for (const q of nodes) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

function route(from, to, mode) {
  const s = snap(from)
  const t = snap(to)
  const start = key(s)
  const goal = key(t)
  const allow = (e) => (mode === 'drive' ? e.drive : e.walk)
  const g = new Map([[start, 0]])
  const came = new Map()
  const open = [[0, start]]
  const h = (k) => {
    const [x, z] = k.split(',').map(Number)
    return Math.hypot(x - t[0], z - t[1])
  }
  let expansions = 0
  while (open.length) {
    open.sort((a, b) => a[0] - b[0])
    const cur = open.shift()[1]
    expansions++
    if (cur === goal) break
    for (const e of adj.get(cur) ?? []) {
      if (!allow(e)) continue
      const ng = (g.get(cur) ?? Infinity) + e.cost
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng)
        came.set(e.to, cur)
        open.push([ng + h(e.to), e.to])
      }
    }
  }
  return { path: came.has(goal) ? 'found' : 'none', expansions, g: g.get(goal) }
}

const arc = [-30.61, -46.24]
const bsc = [-18.81, -45.98]
console.log('results', route(arc, bsc, 'drive'), route(arc, bsc, 'walk'))
console.log('snap', snap(arc), snap(bsc), 'in graph', adj.has(key(snap(arc))), adj.has(key(snap(bsc))))
