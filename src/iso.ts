/**
 * 2:1 dimetric projection, ported from the reference project
 * (MHacks26, experience/src/renderer/iso.ts) so both codebases agree on what an
 * isometric campus looks like.
 *
 * Ground units are metres (x east, z south), height is metres up. Plane units are
 * the projected 2D space the scene draws into.
 *
 *   one metre east  -> (+1, +0.5)
 *   one metre south -> (-1, +0.5)
 *   one metre up    -> (0, -Z_SCALE)
 */
export const Z_SCALE = 1.22
export const TOP_MARGIN_M = 44
export const SLAB_M = 3.5

export type PlanePt = { x: number; y: number }

export class IsoProjection {
  readonly worldW: number
  readonly worldD: number
  readonly planeW: number
  readonly planeH: number
  private readonly top: number

  constructor(worldW: number, worldD: number) {
    this.worldW = worldW
    this.worldD = worldD
    this.top = TOP_MARGIN_M * Z_SCALE * 0.6
    this.planeW = worldW + worldD
    this.planeH = (worldW + worldD) / 2 + this.top + SLAB_M * Z_SCALE + 2
  }

  /** ground + height in metres -> plane */
  px(xM: number, zM: number): number {
    return xM - zM + this.worldD
  }
  py(xM: number, zM: number, yM = 0): number {
    return (xM + zM) / 2 + this.top - yM * Z_SCALE
  }
  toPlane(xM: number, zM: number, yM = 0): PlanePt {
    return { x: this.px(xM, zM), y: this.py(xM, zM, yM) }
  }

  /** plane -> ground point at height 0 */
  toGround(p: PlanePt): { xM: number; zM: number } {
    const d = p.x - this.worldD
    const s = 2 * (p.y - this.top)
    return { xM: (s + d) / 2, zM: (s - d) / 2 }
  }

  /**
   * Affine matrix (a, b, c, d, tx, ty) that warps a top-down image of the world
   * (pxPerM pixels per metre, north up) onto the ground plane. This is how the
   * satellite layer and the vectors stay registered to each other.
   */
  groundMatrix(pxPerM: number): [number, number, number, number, number, number] {
    return [1 / pxPerM, 0.5 / pxPerM, -1 / pxPerM, 0.5 / pxPerM, this.worldD, this.top]
  }

  /** painter's-algorithm depth: larger draws in front */
  depth(xM: number, zM: number): number {
    return xM + zM
  }
}
