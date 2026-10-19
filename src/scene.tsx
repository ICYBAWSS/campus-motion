import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import NET from './network.json'
import { BUS_SPEED, CAPACITY, ROUTES, STOPS, type Agent, type Bus, type Sim } from './sim'
import { figureTextures, FIGURE_ASPECT, POSES, VARIANTS } from './atlas'

const M = 50
/** metres -> scene units */
export const m = (metres: number) => metres / M

const BUILDINGS_URL =
  'https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/Rutgers_University_Buildings/FeatureServer/0/query' +
  '?where=1%3D1&outFields=BldgName,Category,District&outSR=4326&f=geojson&geometryPrecision=6'
const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const toUnit = (lat: number, lon: number): [number, number] => [
  ((lon - CENTER[1]) * KX) / M,
  (-(lat - CENTER[0]) * KY) / M,
]

type B = { ring: [number, number][]; h: number; colour: string }

const CAT_COLOUR: Record<string, string> = {
  Academic: '#b5654a',
  Housing: '#c08a5a',
  Administrative: '#9a6b52',
  'Student Life': '#c2743f',
  Athletic: '#7f9a5f',
  Research: '#a05c46',
  Healthcare: '#b06a6a',
  Parking: '#9aa0a6',
}

/** real Rutgers footprints, extruded from the ArcGIS ring geometry */
function useCampus() {
  const [data, setData] = useState<B[]>([])
  useEffect(() => {
    let dead = false
    fetch(BUILDINGS_URL)
      .then((r) => r.json())
      .then((g) => {
        if (dead) return
        const out: B[] = []
        for (const f of g.features ?? []) {
          const ring: [number, number][] =
            f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0]
          if (!ring || ring.length < 4) continue
          // keep the true outline: a bounding box on a diagonal building spills onto the road
          const pts = ring.map(([lon, lat]) => toUnit(lat, lon))
          const area = Math.abs(
            pts.reduce((a, [x, z], i) => {
              const [nx, nz] = pts[(i + 1) % pts.length]
              return a + (x * nz - nx * z)
            }, 0) / 2,
          )
          if (area < m(8) * m(8)) continue
          const cat = String(f.properties?.Category ?? '')
          out.push({ ring: pts, h: m(3.6) * 3, colour: CAT_COLOUR[cat] ?? '#b8b1a4' })
        }
        setData(out)
      })
      .catch(() => setData([]))
    return () => {
      dead = true
    }
  }, [])
  return data
}

/**
 * Buildings are extruded from their real footprints — roof triangulated from the
 * ring, walls raised along every edge. This is the whole point of keeping the
 * polygon: a bounding box would cover the street the building sits beside.
 */
function Buildings({ data }: { data: B[] }) {
  const geom = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    const c = new THREE.Color()

    for (const b of data) {
      const ring = b.ring.slice()
      // three's triangulator wants a CCW contour
      let area = 0
      for (let i = 0; i < ring.length; i++) {
        const [x, z] = ring[i]
        const [nx, nz] = ring[(i + 1) % ring.length]
        area += x * nz - nx * z
      }
      const contour = (area < 0 ? ring.slice().reverse() : ring).map(([x, z]) => new THREE.Vector2(x, z))
      if (contour.length < 3) continue

      const faces = THREE.ShapeUtils.triangulateShape(contour, [])
      c.set(b.colour)
      const rooC = [c.r * 1.08, c.g * 1.08, c.b * 1.08]
      const wallC = [c.r * 0.86, c.g * 0.86, c.b * 0.88]

      for (const f of faces) {
        for (const idx of f) {
          const v = contour[idx]
          pos.push(v.x, b.h, v.y)
          col.push(rooC[0], rooC[1], rooC[2])
        }
      }
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i]
        const d = contour[(i + 1) % contour.length]
        pos.push(a.x, 0, a.y, d.x, 0, d.y, d.x, b.h, d.y)
        pos.push(a.x, 0, a.y, d.x, b.h, d.y, a.x, b.h, a.y)
        for (let k = 0; k < 6; k++) col.push(wallC[0], wallC[1], wallC[2])
      }
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.computeVertexNormals()
    return g
  }, [data])

  if (!data.length) return null
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial vertexColors roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** grass, asphalt and concrete, all from the routing graph so nothing floats */
function Ground() {
  const { road, walk } = useMemo(() => {
    const edges = (
      NET as unknown as { edges: { a: number[]; b: number[]; drive: boolean; walk: boolean; kind: string }[] }
    ).edges
    const build = (
      keep: (e: { drive: boolean; walk: boolean }) => boolean,
      width: (k: string) => number,
      colour: number[],
    ) => {
      const pos: number[] = []
      const col: number[] = []
      for (const e of edges) {
        if (!keep(e)) continue
        const [x1, z1] = e.a as [number, number]
        const [x2, z2] = e.b as [number, number]
        const dx = x2 - x1
        const dz = z2 - z1
        const len = Math.hypot(dx, dz) || 1
        const w = width(e.kind) / 2
        const nx = (-dz / len) * w
        const nz = (dx / len) * w
        pos.push(
          x1 + nx,
          0,
          z1 + nz,
          x1 - nx,
          0,
          z1 - nz,
          x2 + nx,
          0,
          z2 + nz,
          x2 + nx,
          0,
          z2 + nz,
          x1 - nx,
          0,
          z1 - nz,
          x2 - nx,
          0,
          z2 - nz,
        )
        for (let k = 0; k < 6; k++) col.push(colour[0], colour[1], colour[2])
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      return g
    }
    const roadWidth = (k: string) =>
      k === 'primary'
        ? m(18)
        : k === 'secondary'
          ? m(14)
          : k === 'tertiary'
            ? m(11)
            : k === 'residential'
              ? m(8)
              : m(5.5)
    const walkWidth = (k: string) => (k === 'pedestrian' ? m(7) : k === 'path' ? m(2.6) : m(3))
    return {
      road: build((e) => e.drive, roadWidth, [0.63, 0.64, 0.66]),
      walk: build((e) => e.walk && !e.drive, walkWidth, [0.93, 0.91, 0.86]),
    }
  }, [])

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[200, 320]} />
        <meshStandardMaterial color="#93cf7c" roughness={1} />
      </mesh>
      <mesh geometry={road} position={[0, 0.01, 0]}>
        <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={walk} position={[0, 0.03, 0]}>
        <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}

function BusMesh({ bus, clock }: { bus: Bus; clock: { t: number } }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    const node = g.current
    if (!node) return
    const f = clock.t - Math.floor(clock.t)
    const x = bus.px + (bus.x - bus.px) * f
    const z = bus.pz + (bus.z - bus.pz) * f
    node.position.set(x, 0, z)
    // heading from the path itself, at the *interpolated* distance, so the bus
    // never lags a frame behind its own nose
    const dNow = bus.d - (1 - f) * BUS_SPEED
    const p0 = atDistance(bus, dNow)
    const p1 = atDistance(bus, dNow + 1.5)
    const dx = p1[0] - p0[0]
    const dz = p1[1] - p0[1]
    if (dx || dz) node.rotation.y = Math.atan2(-dz, dx)
  })
  const load = bus.riders.length / CAPACITY
  return (
    <group ref={g}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} renderOrder={2}>
        <planeGeometry args={[m(13), m(4)]} />
        <meshBasicMaterial color="#1f2937" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group scale={m(12) / 2.1}>
        {/* scarlet body reads from the air; the white roof band is what you see top-down */}
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[2.1, 0.44, 0.86]} />
          <meshStandardMaterial color="#b3002d" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.66, 0]}>
          <boxGeometry args={[2.02, 0.06, 0.78]} />
          <meshStandardMaterial color="#b3002d" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <boxGeometry args={[1.98, 0.02, 0.18]} />
          <meshStandardMaterial color="#f8f8f6" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[2.12, 0.16, 0.88]} />
          <meshStandardMaterial color="#7f0021" roughness={0.6} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 0.5, s * 0.435]}>
            <boxGeometry args={[1.82, 0.2, 0.02]} />
            <meshStandardMaterial color="#1f2a37" roughness={0.15} metalness={0.5} />
          </mesh>
        ))}
        {[-1, 1].map((e) => (
          <mesh key={e} position={[e * 1.045, 0.5, 0]}>
            <boxGeometry args={[0.02, 0.2, 0.74]} />
            <meshStandardMaterial color="#1f2a37" roughness={0.15} metalness={0.5} />
          </mesh>
        ))}
        {(
          [
            [-0.72, -0.42],
            [-0.72, 0.42],
            [0.72, -0.42],
            [0.72, 0.42],
          ] as const
        ).map(([x, z], i) => (
          <mesh key={i} position={[x, 0.13, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 12]} />
            <meshStandardMaterial color="#111827" roughness={0.9} />
          </mesh>
        ))}
      </group>
      {/* a full bus turns its roof red: you can read load from the air */}
      <mesh position={[0, m(3.4), 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[m(11), m(2.4)]} />
        <meshBasicMaterial color={load > 0.85 ? '#dc2626' : '#16a34a'} transparent opacity={0.85} />
      </mesh>
      {load > 0 && <group />}
    </group>
  )
}

function atDistance(bus: Bus, distance: number): [number, number] {
  const len = bus.route.len
  const d = ((distance % len) + len) % len
  const path = bus.route.path
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (acc + seg >= d) {
      const t = (d - acc) / (seg || 1)
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ]
    }
    acc += seg
  }
  return path[path.length - 1]
}

/**
 * Agents as sprite billboards. One instanced quad per (variant, pose); the pose
 * alternates while walking so legs swing. This is the reference project's trick:
 * a painted figure reads at 8 px, a capsule does not.
 */
function People({ agents, clock }: { agents: Agent[]; clock: { t: number } }) {
  const { camera, size } = useThree()
  const tex = useMemo(() => figureTextures(), [])
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const f = clock.t - Math.floor(clock.t)
    const stride = Math.floor(clock.t * 8) % 2
    // true scale when you're close, a legible 8 px minimum when you're not:
    // a 1.75 m person is 3 px at campus zoom, which reads as nothing at all
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const unitsAcross = size.height / zoom
    const H = Math.max(m(1.75), unitsAcross * 0.017)
    const W = H * FIGURE_ASPECT
    const buckets: Agent[][] = Array.from({ length: VARIANTS * POSES.length }, () => [])
    for (const a of agents) {
      if (a.state === 'ride') continue
      const moving = a.state === 'walk-stop' || a.state === 'walk-dest'
      const pose = moving ? (stride ? 1 : 2) : 0
      buckets[(a.id % VARIANTS) * POSES.length + pose].push(a)
    }
    for (let i = 0; i < buckets.length; i++) {
      const mesh = refs.current[i]
      if (!mesh) continue
      const list = buckets[i]
      for (let k = 0; k < list.length; k++) {
        const a = list[k]
        const x = a.px + (a.x - a.px) * f
        const z = a.pz + (a.z - a.pz) * f
        dummy.position.set(x, H / 2, z)
        dummy.quaternion.copy(camera.quaternion)
        dummy.scale.set(W, H, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(k, dummy.matrix)
      }
      const count = mesh.instanceMatrix.count
      dummy.scale.set(0.00001, 0.00001, 1)
      dummy.updateMatrix()
      for (let k = list.length; k < count; k++) mesh.setMatrixAt(k, dummy.matrix)
      mesh.instanceMatrix.needsUpdate = true
      mesh.count = count
    }
  })

  return (
    <>
      {Array.from({ length: VARIANTS }, (_, v) =>
        POSES.map((_, p) => (
          <instancedMesh
            key={`${v}-${p}`}
            ref={(el) => {
              refs.current[v * POSES.length + p] = el
            }}
            args={[undefined, undefined, agents.length]}
            frustumCulled={false}
            renderOrder={4}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={tex[v][p]}
              transparent
              alphaTest={0.25}
              depthWrite={false}
              toneMapped={false}
            />
          </instancedMesh>
        )),
      )}
    </>
  )
}

function RouteLines() {
  return (
    <>
      {ROUTES.map((r) => (
        <Line
          key={r.ref}
          points={r.path.map(([x, z]) => [x, 0.05, z])}
          color={r.colour}
          lineWidth={1.6}
          transparent
          opacity={0.55}
        />
      ))}
    </>
  )
}

const MAJOR = new Set(['arc', 'bsc', 'livSc', 'cas', 'yard', 'redoak', 'hill', 'quads'])

function Stops() {
  return (
    <>
      {Object.entries(STOPS).map(([k, s]) => (
        <group key={k} position={[s.at[0], 0, s.at[1]]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.045, 0]}>
            <circleGeometry args={[m(4), 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
          </mesh>
          {MAJOR.has(k) && (
            <Html position={[0, m(12), 0]} center style={{ pointerEvents: 'none' }}>
              <div className="whitespace-nowrap rounded bg-white/85 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 shadow-sm">
                {s.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </>
  )
}

export function Scene({
  sim,
  clock,
  speed,
  focus,
  onCamera,
}: {
  sim: Sim
  clock: { t: number }
  speed: number
  /** stop key to open on */
  focus: string
  onCamera?: (c: THREE.Camera) => void
}) {
  const { camera } = useThree()
  const campus = useCampus()
  useEffect(() => {
    onCamera?.(camera)
  }, [camera, onCamera])

  // map view: straight down, north up. OrbitControls keeps pan and zoom but never
  // tilts, so the scene reads as a plan rather than an oblique 3D shot.
  useEffect(() => {
    const t = STOPS[focus].at
    camera.up.set(0, 0, -1)
    camera.position.set(t[0], 300, t[1])
    camera.lookAt(t[0], 0, t[1])
    ;(camera as THREE.OrthographicCamera).updateProjectionMatrix()
  }, [camera, focus])

  useFrame((_, dt) => {
    clock.t += (Math.min(0.25, dt) * speed) / 60
    const target = Math.floor(clock.t)
    if (target > sim.minute) sim.runTo(target)
  }, -1)

  return (
    <>
      <color attach="background" args={['#cfe8f7']} />
      <hemisphereLight args={['#eaf6ff', '#6f9e58', 1.0]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[60, 90, 50]} intensity={2.0} color="#fff6e5" />
      <Ground />
      <RouteLines />
      <Stops />
      <Buildings data={campus} />
      {sim.buses.map((b, i) => (
        <BusMesh key={i} bus={b} clock={clock} />
      ))}
      <People agents={sim.agents} clock={clock} />
      <OrbitControls
        makeDefault
        target={[STOPS[focus].at[0], 0, STOPS[focus].at[1]]}
        enableRotate={false}
        enablePan
        screenSpacePanning
        enableDamping
        dampingFactor={0.12}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        minZoom={5}
        maxZoom={1400}
        zoomSpeed={2}
      />
    </>
  )
}
