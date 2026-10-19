/**
 * People, painted with Canvas 2D and used as billboards.
 *
 * Lifted from the reference implementation's atlas approach (MHacks26
 * experience/src/renderer/atlas.ts): a person is drawn once per (variant, pose)
 * into a small canvas — dark rim so it separates from any ground, soft
 * upper-left light, hair cap, swinging legs — then instanced as a camera-facing
 * quad. That is why their crowd is readable and a 1.75 m capsule is not.
 */
import * as THREE from 'three'

export type Pose = 'stand' | 'walkA' | 'walkB'
export const POSES: Pose[] = ['stand', 'walkA', 'walkB']
export const VARIANTS = 8

const CELL_W = 44
const CELL_H = 66

type RGB = [number, number, number]
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`

const SKIN: RGB[] = [
  [224, 186, 156],
  [198, 152, 118],
  [160, 112, 80],
  [116, 78, 56],
  [232, 198, 170],
  [178, 128, 96],
  [140, 96, 70],
  [210, 170, 136],
]
const HAIR: RGB[] = [
  [42, 32, 26],
  [92, 64, 40],
  [24, 22, 22],
  [150, 120, 80],
  [70, 50, 36],
  [180, 172, 160],
  [30, 26, 24],
  [120, 82, 50],
]
const SHIRT: RGB[] = [
  [37, 99, 235],
  [22, 163, 74],
  [220, 38, 38],
  [124, 58, 237],
  [234, 88, 12],
  [8, 145, 178],
  [75, 85, 99],
  [190, 24, 93],
]
const TROUSERS: RGB[] = [
  [46, 52, 64],
  [70, 64, 56],
  [38, 40, 44],
  [92, 86, 74],
  [52, 60, 72],
  [84, 74, 64],
  [60, 56, 52],
  [40, 46, 58],
]

/** figure proportions, in canvas px, feet at (cx, base) */
function geom(_pose: Pose) {
  const unit = CELL_H / 1.85 // px per metre, figure is ~1.75 m
  const hip = 0.84 * unit
  const shoulder = hip + 0.56 * unit
  return { unit, hip, shoulder, headC: shoulder + 0.19 * unit, headR: 0.13 * unit, w: 0.5 * unit }
}

function torso(ctx: CanvasRenderingContext2D, cx: number, base: number) {
  const g = geom('stand')
  const top = base - g.shoulder
  const bottom = base - g.hip + 0.07 * g.unit
  ctx.beginPath()
  ctx.moveTo(cx - g.w * 0.5, top + 0.1 * g.unit)
  ctx.quadraticCurveTo(cx - g.w * 0.5, top, cx - g.w * 0.22, top)
  ctx.lineTo(cx + g.w * 0.22, top)
  ctx.quadraticCurveTo(cx + g.w * 0.5, top, cx + g.w * 0.5, top + 0.1 * g.unit)
  ctx.lineTo(cx + g.w * 0.36, bottom)
  ctx.lineTo(cx - g.w * 0.38, bottom)
  ctx.closePath()
}

export function paintFigure(variant: number, pose: Pose): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CELL_W
  c.height = CELL_H
  const ctx = c.getContext('2d')!
  const g = geom(pose)
  const cx = CELL_W / 2
  const base = CELL_H - 4
  const skin = SKIN[variant % SKIN.length]
  const hair = HAIR[(variant * 3) % HAIR.length]
  const shirt = SHIRT[variant % SHIRT.length]
  const legs = TROUSERS[(variant * 5) % TROUSERS.length]
  const rim = 'rgba(12,12,14,0.9)'
  ctx.lineCap = 'round'

  // contact shadow so figures sit on the ground
  const sh = ctx.createRadialGradient(cx + 1, base, 1, cx + 1, base, 0.42 * g.unit)
  sh.addColorStop(0, 'rgba(0,0,0,0.45)')
  sh.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sh
  ctx.beginPath()
  ctx.ellipse(cx + 1, base, 0.4 * g.unit, 0.16 * g.unit, 0, 0, Math.PI * 2)
  ctx.fill()

  const swing = pose === 'walkA' ? 0.14 * g.unit : pose === 'walkB' ? -0.14 * g.unit : 0
  const arms: [number, number, number, number][] = [
    [
      cx - g.w * 0.42,
      base - g.shoulder + 0.08 * g.unit,
      cx - g.w * 0.46 - swing * 0.6,
      base - g.hip + 0.04 * g.unit,
    ],
    [
      cx + g.w * 0.42,
      base - g.shoulder + 0.08 * g.unit,
      cx + g.w * 0.44 + swing * 0.6,
      base - g.hip + 0.06 * g.unit,
    ],
  ]

  // legs behind the torso
  const legW = 0.15 * g.unit
  const leg = (hx: number, fx: number, fy: number, col: RGB) => {
    ctx.strokeStyle = rim
    ctx.lineWidth = legW + 2.2
    ctx.beginPath()
    ctx.moveTo(cx + hx, base - g.hip)
    ctx.lineTo(cx + fx, base - fy)
    ctx.stroke()
    ctx.strokeStyle = css(col)
    ctx.lineWidth = legW
    ctx.beginPath()
    ctx.moveTo(cx + hx, base - g.hip)
    ctx.lineTo(cx + fx, base - fy)
    ctx.stroke()
    ctx.fillStyle = 'rgb(26,24,24)'
    ctx.beginPath()
    ctx.ellipse(cx + fx + legW * 0.3, base - fy, legW * 0.7, legW * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const sp = 0.07 * g.unit
  const dark: RGB = [legs[0] * 0.7, legs[1] * 0.7, legs[2] * 0.74]
  if (pose === 'stand') {
    leg(-sp, -sp * 1.1, 2, dark)
    leg(sp, sp, 2, legs)
  } else if (pose === 'walkA') {
    leg(-sp * 0.5, -0.2 * g.unit, 2.5, dark)
    leg(sp * 0.5, 0.2 * g.unit, 2, legs)
  } else {
    leg(-sp * 0.5, 0.17 * g.unit, 2, dark)
    leg(sp * 0.5, -0.19 * g.unit, 3, legs)
  }

  // arms: dark rim then shirt
  ctx.strokeStyle = rim
  ctx.lineWidth = 0.13 * g.unit + 2.4
  for (const [ax, ay, bx, by] of arms) {
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
  ctx.strokeStyle = css(shirt)
  ctx.lineWidth = 0.13 * g.unit
  for (const [ax, ay, bx, by] of arms) {
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }

  // torso
  ctx.fillStyle = rim
  torso(ctx, cx, base)
  ctx.lineWidth = 2.6
  ctx.strokeStyle = rim
  ctx.stroke()
  const grad = ctx.createLinearGradient(cx - g.w / 2, base - g.shoulder, cx + g.w / 2, base - g.hip)
  grad.addColorStop(0, css([shirt[0] * 1.18, shirt[1] * 1.18, shirt[2] * 1.18]))
  grad.addColorStop(0.55, css(shirt))
  grad.addColorStop(1, css([shirt[0] * 0.72, shirt[1] * 0.72, shirt[2] * 0.76]))
  ctx.fillStyle = grad
  torso(ctx, cx, base)
  ctx.fill()

  // hands
  ctx.fillStyle = css([skin[0] * 0.9, skin[1] * 0.88, skin[2] * 0.86])
  for (const [, , bx, by] of arms) {
    ctx.beginPath()
    ctx.arc(bx, by + 0.03 * g.unit, 0.055 * g.unit, 0, Math.PI * 2)
    ctx.fill()
  }

  // head
  ctx.fillStyle = css([skin[0] * 0.8, skin[1] * 0.77, skin[2] * 0.74])
  ctx.fillRect(cx - 0.045 * g.unit, base - g.headC + g.headR * 0.5, 0.09 * g.unit, 0.1 * g.unit)
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.arc(cx, base - g.headC, g.headR + 1.1, 0, Math.PI * 2)
  ctx.fill()
  const hg = ctx.createRadialGradient(
    cx - g.headR * 0.35,
    base - g.headC - g.headR * 0.35,
    g.headR * 0.2,
    cx,
    base - g.headC,
    g.headR * 1.1,
  )
  hg.addColorStop(
    0,
    css([Math.min(255, skin[0] * 1.1), Math.min(255, skin[1] * 1.07), Math.min(255, skin[2] * 1.05)]),
  )
  hg.addColorStop(1, css([skin[0] * 0.7, skin[1] * 0.66, skin[2] * 0.64]))
  ctx.fillStyle = hg
  ctx.beginPath()
  ctx.arc(cx, base - g.headC, g.headR, 0, Math.PI * 2)
  ctx.fill()

  // hair cap
  ctx.fillStyle = css(hair)
  ctx.beginPath()
  ctx.ellipse(
    cx - g.headR * 0.2,
    base - g.headC - g.headR * 0.3,
    g.headR * 1.02,
    g.headR * 0.8,
    0,
    Math.PI * 0.85,
    Math.PI * 2.1,
  )
  ctx.fill()

  return c
}

let cache: THREE.Texture[][] | null = null

/** [variant][pose] textures, painted once */
export function figureTextures(): THREE.Texture[][] {
  if (cache) return cache
  cache = Array.from({ length: VARIANTS }, (_, v) =>
    POSES.map((p) => {
      const tex = new THREE.CanvasTexture(paintFigure(v, p))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.magFilter = THREE.LinearFilter
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.generateMipmaps = true
      return tex
    }),
  )
  return cache
}

export const FIGURE_ASPECT = CELL_W / CELL_H
