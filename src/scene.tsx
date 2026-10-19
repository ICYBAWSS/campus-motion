import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import NET from './network.json'
import satelliteUrl from './data/satellite.jpg'
import { CAPACITY, ROUTES, STOPS, type Agent, type Bus, type Sim } from './sim'
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

type B = { x: number; z: number; w: number; d: number; h: number; rot: number; name: string }

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
          const pts = ring.map(([lon, lat]) => toUnit(lat, lon))
          let minX = Infinity
          let maxX = -Infinity
          let minZ = Infinity
          let maxZ = -Infinity
          for (const [x, z] of pts) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minZ = Math.min(minZ, z)
            maxZ = Math.max(maxZ, z)
          }
          const w = maxX - minX
          const d = maxZ - minZ
          if (w < m(6) || d < m(6)) continue
          out.push({
            x: (minX + maxX) / 2,
            z: (minZ + maxZ) / 2,
            w,
            d,
            h: m(3.6) * 3,
            rot: 0,
            name: f.properties?.BldgName ?? '',
          })
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

function Buildings({ data }: { data: B[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (!mesh || !data.length) return
    const dummy = new THREE.Object3D()
    const colour = new THREE.Color()
    data.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z)
      dummy.rotation.set(0, b.rot, 0)
      dummy.scale.set(b.w, b.h, b.d)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colour.set(b.name ? CAT_COLOUR['Academic'] : '#b8b1a4'))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [data])
  if (!data.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, data.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.85} />
    </instancedMesh>
  )
}

const SAT_FRAME = { x0: -70, x1: 70, z0: -110, z1: 110 }

/** the actual ground: Esri World Imagery exported over the campus bounding box */
function SatelliteGround() {
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(satelliteUrl)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])
  const w = SAT_FRAME.x1 - SAT_FRAME.x0
  const h = SAT_FRAME.z1 - SAT_FRAME.z0
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(SAT_FRAME.x0 + SAT_FRAME.x1) / 2, -0.02, (SAT_FRAME.z0 + SAT_FRAME.z1) / 2]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
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
      {/* real satellite imagery, georeferenced to the same projection as everything else:
          stops x -70..70, z -110..110 — see scripts/fetch-satellite.mjs */}
      <SatelliteGround />
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
    const ahead = sampleAt(bus, 0.15)
    node.rotation.y = Math.atan2(ahead[0] - x, ahead[1] - z)
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

function sampleAt(bus: Bus, ahead: number): [number, number] {
  const d = (bus.d + ahead) % bus.route.len
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
  const { camera } = useThree()
  const tex = useMemo(() => figureTextures(), [])
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const H = m(1.75)
  const W = H * FIGURE_ASPECT

  useFrame(() => {
    const f = clock.t - Math.floor(clock.t)
    const stride = Math.floor(clock.t * 8) % 2
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
