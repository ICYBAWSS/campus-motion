/**
 * The ground, painted once with Canvas 2D: grass, footways, then carriageway.
 *
 * This replaces a 130k-vertex flat buffer that would not draw under the
 * orthographic plan camera. One texture on one plane is both faster and
 * impossible to mis-bind.
 */
import * as THREE from 'three'
import NET from './network.json'

export const FRAME = { x0: -70, x1: 70, z0: -110, z1: 110 }
const PX = 2560 // texture pixels across the frame

const ROAD_PX: Record<string, number> = {
  motorway: 17,
  trunk: 17,
  primary: 14,
  secondary: 11,
  tertiary: 9,
  residential: 6.5,
  unclassified: 6.5,
  living_street: 5,
  service: 4.5,
  footway: 2,
  path: 1.8,
  pedestrian: 4,
  steps: 1.6,
  cycleway: 2,
}

const ROAD_COLOUR: Record<string, string> = {
  motorway: '#7f8288',
  trunk: '#7f8288',
  primary: '#8b8e94',
  secondary: '#96999f',
  tertiary: '#9ea1a7',
  residential: '#a9acb2',
  unclassified: '#a9acb2',
  living_street: '#b3b6bb',
  service: '#bdbfc4',
  footway: '#e7e2d6',
  path: '#e3ded1',
  pedestrian: '#eae5da',
  steps: '#ded9cd',
  cycleway: '#c7d2c2',
}

let cached: THREE.Texture | null = null

export function groundTexture(): THREE.Texture {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = PX
  canvas.height = PX
  const ctx = canvas.getContext('2d')!
  const scale = PX / (FRAME.x1 - FRAME.x0)
  const toPx = (x: number, z: number): [number, number] => [(x - FRAME.x0) * scale, (z - FRAME.z0) * scale]

  ctx.fillStyle = '#93cf7c'
  ctx.fillRect(0, 0, PX, PX)

  const edges = (
    NET as unknown as { edges: { a: number[]; b: number[]; drive: boolean; walk: boolean; kind: string }[] }
  ).edges

  // footways first, then asphalt over them
  const passes: [boolean, boolean][] = [
    [true, false],
    [false, false],
  ]
  ctx.lineCap = 'round'
  for (const [walkOnly, driveOnly] of passes) {
    for (const e of edges) {
      if (walkOnly && !(e.walk && !e.drive)) continue
      if (driveOnly && !e.drive) continue
      const [x1, z1] = toPx(e.a[0], e.a[1])
      const [x2, z2] = toPx(e.b[0], e.b[1])
      if (driveOnly) {
        ctx.strokeStyle = ROAD_COLOUR[e.kind] ?? '#a9acb2'
        ctx.lineWidth = ROAD_PX[e.kind] ?? 5
      } else {
        ctx.strokeStyle = ROAD_COLOUR[e.kind] ?? '#e7e2d6'
        ctx.lineWidth = ROAD_PX[e.kind] ?? 1.8
      }
      ctx.beginPath()
      ctx.moveTo(x1, z1)
      ctx.lineTo(x2, z2)
      ctx.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  cached = tex
  return tex
}
