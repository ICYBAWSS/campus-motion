import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './scene'
import { Panels } from './ui'
import { createSim } from './sim'

export default function App() {
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [, setFrame] = useState(0)

  // one simulation for the session; the scene advances it on the frame clock
  const simRef = useRef<ReturnType<typeof createSim> | null>(null)
  if (!simRef.current) {
    simRef.current = createSim({ population: 600, seed: 7 })
    simRef.current.runTo(9 * 60) // open at 09:00 with the day already under way
  }
  const sim = simRef.current
  ;(window as unknown as { __sim: unknown }).__sim = sim

  // open where the simulation is actually busiest, not on a hardcoded building
  const [focus] = useState(() => {
    let best = 'bsc'
    let n = -1
    for (const [k, q] of Object.entries(sim.queue)) {
      if (q.length > n) {
        n = q.length
        best = k
      }
    }
    return best
  })
  const clock = useRef({ t: sim.minute }).current

  // panels sample the sim a few times a second; the 3D scene runs at frame rate
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#cfe8f7] text-slate-900">
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [60, 54, 60], zoom: 80, near: -2000, far: 4000 }}
        gl={{ antialias: true }}
        className="absolute inset-0"
      >
        <Scene sim={sim} clock={clock} speed={running ? speed : 0} focus={focus} />
      </Canvas>

      <Panels
        sim={sim}
        clock={clock}
        speed={speed}
        setSpeed={setSpeed}
        running={running}
        setRunning={setRunning}
      />
    </div>
  )
}
