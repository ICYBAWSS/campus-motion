import { useState } from 'react'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { CAPACITY, ROUTES, STOPS, type Sim } from './sim'

const fmt = (min: number) => {
  const t = Math.floor(min) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** the ten 5G nodes: one per major stop, each reporting how many people are standing there */
const NODES = ['arc', 'bsc', 'livSc', 'cas', 'quads', 'hill', 'science', 'yard', 'biel', 'redoak']

export function Panels({
  sim,
  clock,
  speed,
  setSpeed,
  running,
  setRunning,
}: {
  sim: Sim
  clock: { t: number }
  speed: number
  setSpeed: (n: number) => void
  running: boolean
  setRunning: (b: boolean) => void
}) {
  const minute = Math.floor(clock.t)
  const stats = sim.stats()
  const queue = (k: string) => (sim.queue[k] ?? []).length
  const busiest = NODES.reduce((a, b) => (queue(a) >= queue(b) ? a : b))
  const [picked, setPicked] = useState<string | null>(null)
  const watch = picked ?? busiest
  const history = sim.history[watch] ?? []
  const series = history
    .slice(-90)
    .map((waiting, i) => ({ t: fmt(minute - (Math.min(90, history.length) - 1 - i)), waiting }))
  const peak = Math.max(1, ...series.map((p) => p.waiting))

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto rounded-2xl border border-white/60 bg-white/75 px-4 py-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#ee0000] text-[11px] font-black text-white">
              R
            </span>
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">Rutgers 5G Transit Twin</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Powered by Verizon Mobile Edge Compute · simulated telemetry
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/60 bg-white/75 px-3 py-2 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <span className="text-sm font-semibold tabular-nums text-slate-900">{fmt(sim.minute)}</span>
          <button
            onClick={() => setRunning(!running)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
          >
            {running ? 'Pause' : 'Play'}
          </button>
          {[1, 10, 60, 240].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                speed === s ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </header>

      {/* sensors */}
      <aside className="absolute left-4 top-28 z-20 w-[16.5rem] space-y-2">
        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              IoT Sensors
            </h2>
            <span className="text-[10px] text-emerald-600">{NODES.length} online</span>
          </div>
          <ul className="space-y-1">
            {NODES.map((k) => {
              const n = queue(k)
              return (
                <li
                  key={k}
                  className="flex items-center justify-between rounded-lg px-1.5 py-1 text-[11px] hover:bg-slate-50"
                >
                  <span className="truncate text-slate-700">{STOPS[k].label}</span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <span className={n > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>{n}</span>
                    <span className="rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700">
                      5G UWB
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Live</h2>
          <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <dt>waiting</dt>
              <dd className="font-semibold text-slate-900">{stats.waiting}</dd>
            </div>
            <div className="flex justify-between">
              <dt>riding</dt>
              <dd className="font-semibold text-slate-900">{stats.riding}</dd>
            </div>
            <div className="flex justify-between">
              <dt>walking</dt>
              <dd className="font-semibold text-slate-900">{stats.walking}</dd>
            </div>
            <div className="flex justify-between">
              <dt>buses</dt>
              <dd className="font-semibold text-slate-900">{stats.fleet}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] leading-snug text-slate-400">
            {ROUTES.length} routes · capacity ~{CAPACITY} per bus (randomised) · modelled, not measured
          </p>
        </section>
      </aside>

      {/* prediction */}
      <aside className="absolute right-4 top-28 z-20 w-[19rem] space-y-2">
        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Prediction</h2>
            <select
              value={watch}
              onChange={(e) => setPicked(e.target.value)}
              className="max-w-[9.5rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
            >
              {NODES.map((k) => (
                <option key={k} value={k}>
                  {STOPS[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <YAxis hide domain={[0, Math.max(10, peak)]} />
                <ReferenceLine y={CAPACITY} stroke="#f59e0b" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="waiting"
                  stroke="#0f172a"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">waiting at {STOPS[watch].label} · last 90 min</p>
        </section>

        <section
          className={`rounded-2xl border p-3 shadow-xl backdrop-blur-xl ${queue(busiest) > 30 ? 'border-red-200 bg-red-50/85' : 'border-white/60 bg-white/75'}`}
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Alert</h2>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">
            {queue(busiest) > 30
              ? `High volume predicted at ${STOPS[busiest].label}`
              : `${STOPS[busiest].label} is clear`}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-slate-600">
            {queue(busiest)} waiting · {stats.fleet} buses in service · {stats.riding} riding
          </p>
          <button className="mt-2 w-full rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-white">
            Reserve fleet (sim)
          </button>
        </section>
      </aside>
    </>
  )
}
