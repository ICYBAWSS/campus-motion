import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import ROUTE_PATHS from './route-paths.json'
import NETWORK from './network.json'
import type { Group as ThreeGroup } from 'three'
import {
  createSim,
  type Agent as SimAgent,
  type RouteSpec as SimRouteSpec,
  type Sim,
  type SimRun,
} from './agents'
import { Line as RLine, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/* ------------------------------------------------------------------ */
/* 1. map -> scene                                                    */
/* ------------------------------------------------------------------ */

const VERIZON_RED = '#ee0000'

const CENTER: [number, number] = [40.5028, -74.447]
/** ponytail: 50 m/unit is the only scale where all five campuses fit one frame */
const M_PER_UNIT = 50

/** every entity below is specified in metres and converted here, so the scene is 1:1 with reality */
const m = (metres: number) => metres / M_PER_UNIT
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574

type Vec2 = [number, number]

/** lat/lon -> scene units: +x east, +z south */
const toUnit = (lat: number, lon: number): Vec2 => [
  ((lon - CENTER[1]) * KX) / M_PER_UNIT,
  (-(lat - CENTER[0]) * KY) / M_PER_UNIT,
]

const STOPS = {
  werblin: {
    label: 'Werblin Recreation Center',
    at: toUnit(40.51871, -74.46008),
    capacity: 2000,
    capacitySrc: 'estimate',
    major: false,
  },
  cas: {
    label: 'College Ave Student Center',
    at: toUnit(40.50329, -74.4521),
    capacity: 600,
    capacitySrc: 'estimate',
    major: true,
  },
  yard: {
    label: 'The Yard',
    at: toUnit(40.49956, -74.44834),
    capacity: 500,
    capacitySrc: 'estimate',
    major: true,
  },
  sac: {
    label: 'Student Activities Ctr',
    at: toUnit(40.50411, -74.44898),
    capacity: 250,
    capacitySrc: 'estimate',
    major: false,
  },
  stadium: {
    label: 'Stadium West Lot',
    at: toUnit(40.51457, -74.46596),
    capacity: 52454,
    capacitySrc: 'published',
    major: false,
  },
  hill: {
    label: 'Hill Center',
    at: toUnit(40.52197, -74.46319),
    capacity: 900,
    capacitySrc: 'estimate',
    major: true,
  },
  science: {
    label: 'Science Buildings',
    at: toUnit(40.52389, -74.46413),
    capacity: 700,
    capacitySrc: 'estimate',
    major: false,
  },
  bsc: {
    label: 'Busch Student Center',
    at: toUnit(40.52359, -74.45811),
    capacity: 600,
    capacitySrc: 'derived',
    major: true,
  },
  livPlaza: {
    label: 'Livingston Plaza',
    at: toUnit(40.52506, -74.43853),
    capacity: 300,
    capacitySrc: 'estimate',
    major: false,
  },
  livSc: {
    label: 'Livingston Student Center',
    at: toUnit(40.52399, -74.43659),
    capacity: 300,
    capacitySrc: 'estimate',
    major: true,
  },
  quads: {
    label: 'Quads',
    at: toUnit(40.51995, -74.43358),
    capacity: 600,
    capacitySrc: 'estimate',
    major: false,
  },
  jma: {
    label: "Jersey Mike's Arena",
    at: toUnit(40.52434, -74.44065),
    capacity: 8000,
    capacitySrc: 'published',
    major: false,
  },
  rodkin: {
    label: 'Rodkin',
    at: toUnit(40.51578, -74.46299),
    capacity: 150,
    capacitySrc: 'estimate',
    major: false,
  },
  arc: {
    label: 'Allison Road Classroom',
    at: toUnit(40.52371, -74.46508),
    capacity: 500,
    capacitySrc: 'published',
    major: true,
  },
  redoak: {
    label: 'Red Oak Lane',
    at: toUnit(40.48282, -74.43762),
    capacity: 300,
    capacitySrc: 'estimate',
    major: false,
  },
  lipman: {
    label: 'Lipman Hall',
    at: toUnit(40.48118, -74.43642),
    capacity: 200,
    capacitySrc: 'estimate',
    major: false,
  },
  collegeHall: {
    label: 'College Hall',
    at: toUnit(40.48568, -74.43745),
    capacity: 400,
    capacitySrc: 'estimate',
    major: false,
  },
  biel: {
    label: 'Biel Road',
    at: toUnit(40.47993, -74.43249),
    capacity: 200,
    capacitySrc: 'estimate',
    major: true,
  },
  henderson: {
    label: 'Henderson Apartments',
    at: toUnit(40.48111, -74.42879),
    capacity: 150,
    capacitySrc: 'estimate',
    major: false,
  },
  gibbons: {
    label: 'Gibbons',
    at: toUnit(40.48525, -74.43187),
    capacity: 200,
    capacitySrc: 'estimate',
    major: false,
  },
  socam: {
    label: 'SoCam Apartments',
    at: toUnit(40.4923, -74.44245),
    capacity: 200,
    capacitySrc: 'estimate',
    major: false,
  },
} as const

type StopKey = keyof typeof STOPS

/* ------------------------------------------------------------------ */
/* 2. paths                                                           */
/* ------------------------------------------------------------------ */

const pathLength = (path: Vec2[]) => {
  let sum = 0
  for (let i = 0; i < path.length - 1; i++) {
    sum += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  }
  return sum
}

const samplePath = (path: Vec2[], len: number, d: number) => {
  let t = ((d % len) + len) % len
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i]
    const [bx, bz] = path[i + 1]
    const seg = Math.hypot(bx - ax, bz - az) || 1
    if (t <= seg || i === path.length - 2) {
      const k = t / seg
      const ux = (bx - ax) / seg
      const uz = (bz - az) / seg
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, nx: -uz, nz: ux, rot: Math.atan2(-uz, ux) }
    }
    t -= seg
  }
  return { x: path[0][0], z: path[0][1], nx: 0, nz: 1, rot: 0 }
}

const projectOnPath = (path: Vec2[], p: Vec2) => {
  let best = { d: 0, lateral: Infinity, side: 1 }
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i]
    const [bx, bz] = path[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const seg = Math.hypot(dx, dz) || 1
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (seg * seg)))
    const lat = Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz))
    if (lat < best.lateral) {
      best = { d: acc + t * seg, lateral: lat, side: dx * (p[1] - az) - dz * (p[0] - ax) > 0 ? 1 : -1 }
    }
    acc += seg
  }
  return best
}

type RouteSpec = {
  ref: string
  colour: string
  stops: StopKey[]
  ll: [number, number][]
  /** headway bands published on ipo.rutgers.edu/dots/nb-route-*, per day type: [fromMin, toMin, minutes] */
  bands: Partial<Record<Day, [number, number, number][]>>
}

const makeRoute = (spec: RouteSpec) => {
  const path = spec.ll.map(([lat, lon]) => toUnit(lat, lon))
  return {
    ...spec,
    path,
    len: pathLength(path),
    haltD: spec.stops.map((k) => projectOnPath(path, STOPS[k].at).d),
  }
}

/**
 * EE and F are the College Avenue <-> Cook/Douglass pair that the weekday DOTS sheet lists
 * (EE: CA -> Yard -> SAC -> SoCam -> Red Oak; F: Red Oak -> Lipman -> College Hall -> CA).
 * Their stop order comes from ipo.rutgers.edu/dots/weekday-routes-nb; the *path* between stops is
 * a straight line because there is no published polyline for them in the data we have.
 * ponytail: straight-line path, add hand-traced geometry when someone drives it.
 */
const makeRouteFromStops = (
  ref: string,
  colour: string,
  stops: StopKey[],
  bands: Record<string, [number, number, number][]>,
) => {
  // real road geometry from scripts/build-network.mjs (A* over the OSM graph);
  // ponytail: routes the builder could not parse (EE, F) fall back to straight stops
  const path = (ROUTE_PATHS as unknown as Record<string, Vec2[]>)[ref] ?? stops.map((k) => STOPS[k].at)
  return {
    ref,
    colour,
    stops,
    bands,
    path,
    len: pathLength(path),
    haltD: stops.map((k) => projectOnPath(path, STOPS[k].at).d),
  }
}

const ROUTES = [
  makeRoute({
    ref: 'A',
    colour: '#7b478a',
    stops: ['werblin', 'cas', 'yard', 'sac', 'stadium', 'hill', 'science', 'bsc'],
    bands: {
      'mo-th': [
        [420, 630, 10],
        [630, 1260, 6],
      ],
      fr: [
        [420, 630, 10],
        [630, 821, 5],
        [821, 1273, 8],
      ],
    },
    ll: [
      [40.5185, -74.4601],
      [40.5178, -74.4616],
      [40.5166, -74.46],
      [40.5166, -74.4587],
      [40.5175, -74.4568],
      [40.5168, -74.4557],
      [40.5145, -74.458],
      [40.5129, -74.4588],
      [40.5098, -74.4591],
      [40.5081, -74.4584],
      [40.5071, -74.4569],
      [40.5059, -74.4526],
      [40.5051, -74.4539],
      [40.499, -74.4477],
      [40.4998, -74.4452],
      [40.5027, -74.4467],
      [40.5053, -74.4515],
      [40.5065, -74.452],
      [40.5071, -74.4567],
      [40.5089, -74.4587],
      [40.5122, -74.4588],
      [40.5142, -74.4581],
      [40.5171, -74.4543],
      [40.5172, -74.4527],
      [40.5164, -74.4526],
      [40.5161, -74.4535],
      [40.5174, -74.4554],
      [40.5176, -74.4568],
      [40.5165, -74.4594],
      [40.5157, -74.4598],
      [40.5145, -74.4664],
      [40.515, -74.4633],
      [40.5178, -74.4611],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5237, -74.4644],
      [40.5252, -74.4633],
      [40.5246, -74.4612],
      [40.5253, -74.4608],
      [40.5249, -74.4597],
      [40.5228, -74.4568],
      [40.5207, -74.4573],
      [40.5185, -74.4601],
    ],
  }),
  makeRoute({
    ref: 'B',
    colour: '#4364a0',
    stops: ['bsc', 'livPlaza', 'livSc', 'quads', 'hill', 'science'],
    bands: {
      'mo-th': [
        [420, 521, 7],
        [521, 769, 6],
        [769, 1074, 5],
        [1074, 1247, 6.5],
        [1247, 1369, 25],
      ],
      fr: [
        [420, 540, 8.5],
        [540, 1095, 6.5],
        [1095, 1220, 8.5],
        [1220, 1369, 25],
      ],
    },
    ll: [
      [40.5255, -74.4382],
      [40.5246, -74.4391],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5208, -74.4328],
      [40.5189, -74.4342],
      [40.5233, -74.442],
      [40.5257, -74.4507],
      [40.5253, -74.4545],
      [40.526, -74.4549],
      [40.5265, -74.4542],
      [40.5258, -74.4524],
      [40.5242, -74.4509],
      [40.5224, -74.4505],
      [40.5204, -74.4511],
      [40.5181, -74.4531],
      [40.5176, -74.4569],
      [40.5165, -74.4595],
      [40.5174, -74.461],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5237, -74.4644],
      [40.5252, -74.4633],
      [40.5246, -74.4612],
      [40.5253, -74.4608],
      [40.5249, -74.4597],
      [40.5233, -74.4577],
      [40.5244, -74.4587],
      [40.5254, -74.4572],
      [40.525, -74.4556],
      [40.5256, -74.4508],
      [40.5233, -74.4423],
      [40.5225, -74.4411],
      [40.5246, -74.4391],
    ],
  }),
  makeRoute({
    ref: 'B/L',
    colour: '#818489',
    stops: ['science', 'jma', 'livSc', 'quads', 'bsc', 'rodkin', 'stadium', 'hill'],
    bands: {
      'mo-th': [
        [360, 1140, 12.5],
        [1140, 1440, 25],
      ],
      fr: [
        [360, 1140, 12.5],
        [1140, 1440, 25],
      ],
    },
    ll: [
      [40.5239, -74.4642],
      [40.5252, -74.4633],
      [40.5246, -74.4612],
      [40.5264, -74.4603],
      [40.525, -74.4556],
      [40.5256, -74.4508],
      [40.5233, -74.4423],
      [40.5225, -74.4411],
      [40.5246, -74.4391],
      [40.5251, -74.44],
      [40.5245, -74.4407],
      [40.5239, -74.4398],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5214, -74.4327],
      [40.5189, -74.4342],
      [40.5234, -74.4424],
      [40.5257, -74.4507],
      [40.525, -74.4556],
      [40.5254, -74.4572],
      [40.5242, -74.4588],
      [40.5228, -74.4568],
      [40.5207, -74.4573],
      [40.5181, -74.4607],
      [40.5179, -74.4615],
      [40.515, -74.4633],
      [40.5145, -74.4664],
      [40.515, -74.4633],
      [40.5178, -74.4611],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5239, -74.4642],
    ],
  }),
  makeRoute({
    ref: 'C',
    colour: '#496d35',
    stops: ['hill', 'stadium', 'arc'],
    bands: { 'mo-th': [[450, 1318, 12]], fr: [[450, 1165, 12]] },
    ll: [
      [40.5147, -74.4661],
      [40.515, -74.4633],
      [40.5178, -74.4611],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5239, -74.4645],
      [40.5227, -74.4659],
      [40.5219, -74.4632],
      [40.518, -74.4614],
      [40.515, -74.4633],
      [40.5145, -74.4662],
    ],
  }),
  makeRoute({
    ref: 'H',
    colour: '#e2669b',
    stops: ['stadium', 'cas', 'yard', 'sac', 'werblin', 'bsc', 'arc', 'hill'],
    bands: {
      'mo-th': [
        [360, 436, 15],
        [436, 556, 11],
        [556, 1292, 7],
        [1292, 1366, 11],
        [1366, 1440, 15],
      ],
      fr: [
        [360, 436, 15],
        [436, 556, 11],
        [556, 900, 7],
        [900, 1320, 11],
        [1320, 1440, 15],
      ],
    },
    ll: [
      [40.5046, -74.4533],
      [40.499, -74.4477],
      [40.4998, -74.4452],
      [40.5027, -74.4467],
      [40.5053, -74.4515],
      [40.5065, -74.452],
      [40.5071, -74.4567],
      [40.5089, -74.4587],
      [40.5122, -74.4588],
      [40.5142, -74.4581],
      [40.5171, -74.4543],
      [40.5174, -74.4532],
      [40.5169, -74.4525],
      [40.5161, -74.4533],
      [40.5176, -74.4561],
      [40.5165, -74.459],
      [40.5169, -74.4605],
      [40.5178, -74.4611],
      [40.5207, -74.4573],
      [40.5228, -74.4568],
      [40.5249, -74.4597],
      [40.5253, -74.4608],
      [40.5246, -74.4612],
      [40.5252, -74.4633],
      [40.5227, -74.4659],
      [40.5219, -74.4632],
      [40.518, -74.4614],
      [40.515, -74.4633],
      [40.5145, -74.4664],
      [40.5157, -74.4598],
      [40.5165, -74.4594],
      [40.5174, -74.4573],
      [40.5173, -74.456],
      [40.5166, -74.4558],
      [40.5148, -74.4578],
      [40.5133, -74.4587],
      [40.5096, -74.4591],
      [40.5073, -74.4574],
      [40.5059, -74.4526],
      [40.5051, -74.4539],
    ],
  }),
  makeRoute({
    ref: 'RexB',
    colour: '#52311e',
    stops: ['hill', 'redoak', 'lipman', 'collegeHall', 'arc'],
    bands: {
      'mo-th': [
        [420, 768, 12],
        [768, 1380, 9],
      ],
      fr: [
        [420, 924, 12],
        [924, 1374, 18],
      ],
    },
    ll: [
      [40.4826, -74.438],
      [40.4833, -74.4372],
      [40.4823, -74.4356],
      [40.4807, -74.4371],
      [40.4808, -74.4383],
      [40.482, -74.4404],
      [40.4853, -74.4369],
      [40.4872, -74.44],
      [40.4898, -74.437],
      [40.4922, -74.4386],
      [40.4992, -74.4406],
      [40.5057, -74.4501],
      [40.5071, -74.4564],
      [40.5081, -74.4582],
      [40.5102, -74.459],
      [40.5142, -74.4581],
      [40.5171, -74.4543],
      [40.5174, -74.4532],
      [40.5169, -74.4525],
      [40.5161, -74.4533],
      [40.5176, -74.4561],
      [40.5165, -74.4588],
      [40.5167, -74.4603],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5239, -74.4645],
      [40.5227, -74.4659],
      [40.5219, -74.4632],
      [40.5186, -74.4615],
      [40.5178, -74.4615],
      [40.5169, -74.4605],
      [40.5165, -74.459],
      [40.5175, -74.4567],
      [40.517, -74.4557],
      [40.5129, -74.4588],
      [40.5096, -74.4591],
      [40.5079, -74.4582],
      [40.5069, -74.4563],
      [40.5056, -74.4503],
      [40.5008, -74.4426],
      [40.4991, -74.4407],
      [40.4921, -74.439],
      [40.4898, -74.4376],
      [40.4872, -74.44],
      [40.4853, -74.4369],
      [40.4833, -74.4391],
      [40.4826, -74.438],
    ],
  }),
  makeRoute({
    ref: 'RexL',
    colour: '#4cae47',
    stops: ['livSc', 'redoak', 'lipman', 'collegeHall', 'livPlaza'],
    bands: {
      'mo-th': [
        [420, 540, 12],
        [540, 756, 9],
        [756, 1077, 7],
        [1077, 1384, 7],
      ],
      fr: [
        [420, 540, 12],
        [540, 756, 9],
        [756, 917, 7],
        [917, 1109, 12],
        [1109, 1379, 18],
      ],
    },
    ll: [
      [40.4826, -74.438],
      [40.4833, -74.4372],
      [40.4823, -74.4356],
      [40.4807, -74.4371],
      [40.4808, -74.4383],
      [40.482, -74.4404],
      [40.4853, -74.4369],
      [40.4872, -74.44],
      [40.4898, -74.437],
      [40.4922, -74.4386],
      [40.4994, -74.4407],
      [40.5057, -74.4501],
      [40.5077, -74.4577],
      [40.5093, -74.4589],
      [40.5122, -74.4588],
      [40.515, -74.4575],
      [40.5193, -74.4515],
      [40.5231, -74.4498],
      [40.5247, -74.4484],
      [40.5233, -74.4423],
      [40.5225, -74.4411],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5208, -74.4328],
      [40.5189, -74.4342],
      [40.5233, -74.442],
      [40.5257, -74.4507],
      [40.5253, -74.4545],
      [40.526, -74.4549],
      [40.5265, -74.4543],
      [40.5259, -74.4525],
      [40.5246, -74.4512],
      [40.523, -74.4505],
      [40.5215, -74.4506],
      [40.5187, -74.4524],
      [40.5156, -74.457],
      [40.5141, -74.4584],
      [40.5125, -74.4589],
      [40.5091, -74.459],
      [40.5071, -74.4569],
      [40.5061, -74.4517],
      [40.5054, -74.4499],
      [40.4994, -74.4409],
      [40.4921, -74.439],
      [40.4898, -74.4376],
      [40.4872, -74.44],
      [40.4853, -74.4369],
      [40.4833, -74.4391],
      [40.4826, -74.438],
    ],
  }),
  makeRoute({
    ref: 'Lx',
    colour: '#e5702c',
    stops: ['quads', 'cas', 'yard', 'sac', 'livPlaza', 'livSc'],
    bands: {
      'mo-th': [
        [360, 420, 15],
        [420, 630, 5.5],
        [630, 754, 4],
        [754, 1204, 3.5],
        [1204, 1336, 7],
        [1336, 1440, 15],
      ],
      fr: [
        [360, 420, 15],
        [420, 540, 5],
        [540, 754, 6],
        [754, 1204, 3.5],
        [1204, 1290, 6],
        [1290, 1440, 10],
      ],
    },
    ll: [
      [40.5033, -74.452],
      [40.499, -74.4477],
      [40.4998, -74.4452],
      [40.502, -74.4463],
      [40.5028, -74.4469],
      [40.5053, -74.4515],
      [40.5065, -74.452],
      [40.507, -74.4561],
      [40.5081, -74.4582],
      [40.5102, -74.459],
      [40.5142, -74.4581],
      [40.5188, -74.452],
      [40.5246, -74.4487],
      [40.5247, -74.4478],
      [40.5234, -74.4425],
      [40.5225, -74.4411],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5208, -74.4328],
      [40.5189, -74.4342],
      [40.5234, -74.4422],
      [40.5257, -74.4507],
      [40.5253, -74.4543],
      [40.5262, -74.4548],
      [40.5263, -74.4534],
      [40.5249, -74.4514],
      [40.5232, -74.4506],
      [40.5215, -74.4506],
      [40.5187, -74.4524],
      [40.5143, -74.4582],
      [40.5127, -74.4589],
      [40.5098, -74.4591],
      [40.5085, -74.4587],
      [40.5073, -74.4574],
      [40.5059, -74.4526],
      [40.5051, -74.4539],
      [40.504, -74.4527],
    ],
  }),
  makeRoute({
    ref: 'W1',
    colour: '#4cbeeb',
    stops: [
      'cas',
      'yard',
      'sac',
      'hill',
      'science',
      'bsc',
      'livPlaza',
      'livSc',
      'quads',
      'redoak',
      'lipman',
      'biel',
      'henderson',
      'gibbons',
      'collegeHall',
      'socam',
    ],
    bands: {
      sa: [
        [0, 180, 20],
        [180, 480, 60],
        [480, 720, 30],
        [720, 1440, 20],
      ],
      su: [
        [480, 720, 35],
        [720, 1170, 22],
        [1170, 1440, 20],
      ],
    },
    ll: [
      [40.5046, -74.4533],
      [40.499, -74.4477],
      [40.4998, -74.4452],
      [40.5027, -74.4467],
      [40.5053, -74.4515],
      [40.5065, -74.452],
      [40.5071, -74.4567],
      [40.5089, -74.4587],
      [40.5122, -74.4588],
      [40.5142, -74.4581],
      [40.5171, -74.4543],
      [40.5174, -74.4532],
      [40.5169, -74.4525],
      [40.5161, -74.4533],
      [40.5176, -74.4561],
      [40.5165, -74.459],
      [40.5169, -74.4605],
      [40.5219, -74.4632],
      [40.5227, -74.4659],
      [40.5237, -74.4644],
      [40.5252, -74.4633],
      [40.5246, -74.4612],
      [40.5253, -74.4608],
      [40.5249, -74.4597],
      [40.5233, -74.4577],
      [40.5244, -74.4587],
      [40.5254, -74.4572],
      [40.525, -74.4556],
      [40.5256, -74.4508],
      [40.5233, -74.4423],
      [40.5225, -74.4411],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5208, -74.4328],
      [40.5189, -74.4342],
      [40.5233, -74.442],
      [40.5257, -74.4507],
      [40.5253, -74.4543],
      [40.5258, -74.4549],
      [40.5264, -74.4545],
      [40.5262, -74.4531],
      [40.5249, -74.4514],
      [40.5232, -74.4506],
      [40.5215, -74.4506],
      [40.5187, -74.4524],
      [40.5143, -74.4582],
      [40.5127, -74.4589],
      [40.5098, -74.4591],
      [40.5085, -74.4587],
      [40.5073, -74.4574],
      [40.5059, -74.4524],
      [40.5033, -74.4478],
      [40.5034, -74.4472],
      [40.501, -74.4429],
      [40.4993, -74.4409],
      [40.4921, -74.439],
      [40.4897, -74.4376],
      [40.4872, -74.44],
      [40.4853, -74.4369],
      [40.4833, -74.4391],
      [40.4826, -74.438],
      [40.4833, -74.4372],
      [40.4822, -74.4355],
      [40.481, -74.4365],
      [40.479, -74.4367],
      [40.4789, -74.4349],
      [40.4798, -74.4337],
      [40.4806, -74.4313],
      [40.4807, -74.4286],
      [40.483, -74.4308],
      [40.4831, -74.4324],
      [40.4847, -74.4326],
      [40.4853, -74.432],
      [40.4852, -74.4328],
      [40.484, -74.4331],
      [40.4841, -74.4349],
      [40.4865, -74.4394],
      [40.4907, -74.4423],
      [40.4923, -74.4433],
      [40.4927, -74.4386],
      [40.4932, -74.4379],
      [40.4941, -74.4389],
      [40.4997, -74.4409],
      [40.5036, -74.4464],
      [40.5036, -74.4483],
      [40.506, -74.4523],
      [40.5051, -74.4539],
    ],
  }),
  makeRoute({
    ref: 'W2',
    colour: '#f5df15',
    stops: [
      'hill',
      'cas',
      'yard',
      'socam',
      'redoak',
      'lipman',
      'biel',
      'henderson',
      'gibbons',
      'collegeHall',
      'sac',
      'livPlaza',
      'livSc',
      'quads',
      'bsc',
      'arc',
    ],
    bands: {
      sa: [
        [0, 180, 20],
        [180, 480, 60],
        [480, 720, 30],
        [720, 1440, 20],
      ],
      su: [
        [480, 720, 30],
        [720, 1440, 20],
      ],
    },
    ll: [
      [40.5046, -74.4533],
      [40.499, -74.4477],
      [40.5003, -74.4428],
      [40.4994, -74.4415],
      [40.4983, -74.4414],
      [40.4981, -74.4404],
      [40.4931, -74.4393],
      [40.4923, -74.4433],
      [40.4866, -74.4395],
      [40.4853, -74.4369],
      [40.4833, -74.4391],
      [40.4826, -74.438],
      [40.4833, -74.4372],
      [40.4823, -74.4356],
      [40.481, -74.4365],
      [40.479, -74.4367],
      [40.4789, -74.4349],
      [40.4798, -74.4337],
      [40.4806, -74.4313],
      [40.4807, -74.4286],
      [40.483, -74.4308],
      [40.4831, -74.4324],
      [40.4847, -74.4326],
      [40.4853, -74.432],
      [40.4852, -74.4328],
      [40.4841, -74.433],
      [40.4839, -74.4344],
      [40.4865, -74.4394],
      [40.4872, -74.44],
      [40.4898, -74.437],
      [40.4922, -74.4386],
      [40.4997, -74.4409],
      [40.5036, -74.4464],
      [40.5036, -74.4483],
      [40.5053, -74.4515],
      [40.5065, -74.452],
      [40.5073, -74.4572],
      [40.5083, -74.4584],
      [40.5096, -74.459],
      [40.5129, -74.4587],
      [40.5142, -74.4581],
      [40.5188, -74.452],
      [40.5231, -74.4498],
      [40.5247, -74.4484],
      [40.5233, -74.4423],
      [40.5225, -74.4411],
      [40.5255, -74.4382],
      [40.5244, -74.4362],
      [40.5236, -74.4362],
      [40.524, -74.4355],
      [40.5228, -74.4328],
      [40.5208, -74.4328],
      [40.5189, -74.4342],
      [40.5229, -74.4409],
      [40.5257, -74.4506],
      [40.525, -74.4556],
      [40.5254, -74.4572],
      [40.5243, -74.4588],
      [40.5233, -74.4577],
      [40.5249, -74.4597],
      [40.5253, -74.4608],
      [40.5246, -74.4612],
      [40.5252, -74.4633],
      [40.5227, -74.4659],
      [40.5219, -74.4632],
      [40.5186, -74.4615],
      [40.5178, -74.4615],
      [40.5167, -74.4603],
      [40.5165, -74.4588],
      [40.5175, -74.4568],
      [40.5171, -74.4558],
      [40.5164, -74.4559],
      [40.5148, -74.4578],
      [40.5133, -74.4587],
      [40.5096, -74.4591],
      [40.5073, -74.4574],
      [40.5059, -74.4526],
      [40.5051, -74.4539],
    ],
  }),

  makeRouteFromStops('EE', '#b45309', ['cas', 'yard', 'sac', 'socam', 'redoak'], {
    'mo-th': [[420, 1260, 10]],
    fr: [[420, 1273, 10]],
  }),
  makeRouteFromStops('F', '#0f766e', ['redoak', 'lipman', 'collegeHall', 'cas'], {
    'mo-th': [[420, 1260, 10]],
    fr: [[420, 1273, 10]],
  }),
]

/* ------------------------------------------------------------------ */
/* 3. service calendar                                                */
/* ------------------------------------------------------------------ */

type Day = 'mo-th' | 'fr' | 'sa' | 'su'

/** minutes until this route's next bus, or null if it is not running */
const routeState = (route: (typeof ROUTES)[number], day: Day, minute: number) => {
  const bands = route.bands[day]
  if (!bands) return null
  for (const [from, to, headway] of bands) {
    if (minute >= from && minute < to) return headway
  }
  return null
}

/* ---------- the academic calendar: a July Tuesday is not an October Tuesday ---------- */

/** 2026-27 dates from scheduling.rutgers.edu */
const TERMS: { from: string; to: string; kind: 'session' | 'exams' | 'recess' | 'summer' }[] = [
  { from: '2026-09-01', to: '2026-12-10', kind: 'session' }, // fall classes
  { from: '2026-12-11', to: '2026-12-22', kind: 'exams' }, // reading days + finals
  { from: '2026-12-23', to: '2027-01-18', kind: 'recess' }, // winter break
  { from: '2027-01-19', to: '2027-03-12', kind: 'session' }, // spring classes
  { from: '2027-03-13', to: '2027-03-21', kind: 'recess' }, // spring recess
  { from: '2027-03-22', to: '2027-05-03', kind: 'session' },
  { from: '2027-05-04', to: '2027-05-31', kind: 'exams' },
  { from: '2027-06-01', to: '2027-08-18', kind: 'summer' }, // summer session
  { from: '2027-08-19', to: '2027-08-31', kind: 'recess' },
]

/** days when almost nobody is on campus — service runs, demand does not */
const HOLIDAYS = new Set([
  '2026-09-07', // Labor Day
  '2026-11-26',
  '2026-11-27', // Thanksgiving
  '2027-01-18', // MLK
  '2027-05-31', // Memorial Day
  '2027-07-05', // Independence Day observed
])

const termOf = (date: string) => {
  if (HOLIDAYS.has(date)) return 'holiday' as const
  const hit = TERMS.find((t) => date >= t.from && date <= t.to)
  return hit?.kind ?? 'recess'
}

/** how much of a normal weekday's demand and service exists in each term */
const TERM_DEMAND: Record<string, number> = {
  session: 1,
  exams: 0.55,
  summer: 0.45,
  recess: 0.25,
  holiday: 0.08,
}
const TERM_SERVICE: Record<string, number> = { session: 1, exams: 1, summer: 0.7, recess: 0.6, holiday: 0.6 }

/** weekday band from the date, so the calendar and the schedule cannot disagree */
const bandOf = (date: string): Day => {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (wd === 0) return 'su' // weekend routes use the same two-letter keys as `Day`
  if (wd === 6) return 'sa'
  if (wd === 5) return 'fr'
  return 'mo-th'
}

/** published headway for that weekday, stretched when the term runs reduced service */
const headwayAt = (route: (typeof ROUTES)[number], minute: number, date: string) => {
  const hw = routeState(route, bandOf(date), SIM_BASE + minute)
  return hw === null ? null : hw / TERM_SERVICE[termOf(date)]
}

/* ------------------------------------------------------------------ */
/* 4. world: events, places, service, closures                        */
/* ------------------------------------------------------------------ */

type Scenario = {
  venue: StopKey
  rsvps: number
  startMin: number
  durationMin: number
  /** how long the crowd takes to arrive before the start */
  rampMin: number
  /** spread of arrivals before the start, and of the exit after it — the two biggest assumptions left */
  rampSigma: number
  exitSigma: number
}

type PlaceKind = 'building' | 'dining' | 'retail' | 'venue'

type Place = {
  id: string
  label: string
  kind: PlaceKind
  stop: StopKey
  /** slot used to fan places around their stop so they do not stack */
  slot: number
  /** seats / occupants / daily visitors at peak */
  capacity: number
  /** open + close, minutes since midnight */
  hours: [number, number]
}

type World = {
  event: Scenario | null
  places: Place[]
  serviceScale: Record<string, number>
  closed: StopKey[]
  /** the simulated day: YYYY-MM-DD, which also decides weekday, term and holidays */
  date: string
  /** demand calibration solved from an observed boarding count, 1 = untouched */
  cal: number
}

const SCENARIO_0: Scenario = {
  venue: 'arc',
  rsvps: 1200,
  startMin: 45,
  durationMin: 60,
  rampMin: 45,
  rampSigma: 16,
  exitSigma: 12,
}

const BASE_WORLD: World = {
  event: SCENARIO_0,
  places: [],
  serviceScale: {},
  closed: [],
  date: '2026-10-19',
  cal: 1,
}

const SIM_BASE = 14 * 60
const fmt = (min: number) =>
  `${String(Math.floor((SIM_BASE + min) / 60) % 24).padStart(2, '0')}:${String(
    Math.round((SIM_BASE + min) % 60),
  ).padStart(2, '0')}`

/* ---------- flow model: arrivals -> queue -> boarding -> dwell ---------- */

/** a stop reads 100% at this many people waiting */
const QUEUE_100 = 200
/** Rutgers campus bus: ~60 people (estimate, no published figure) */
const BUS_CAPACITY = 60
/** all-door boarding, people per second (estimate) */
const BOARD_RATE = 2
const BASE_DWELL = 4 /* seconds of door cycle even with nobody waiting */
/* Boarding is front + rear doors at once, no fare and no ID tap: Rutgers buses are free and open-boarding,
   and alighting through the rear runs in parallel, so it adds no time to the stop. */

/** people per minute arriving at a stop, from every intervention in the world */
/* ---------- campus fabric: 737 official buildings + 191 parking lots, each a trip generator ---------- */

type CampusBuilding = {
  x: number
  z: number
  w: number
  d: number
  rot: number
  h: number
  cat: string
  name: string
  district: string
  stop: StopKey
}

/** official Rutgers building numbers for the two the dashboard names (BldgNum 3878 / 3834) */
const LANDMARK_NUM: Record<number, string> = {
  3878: 'Allison Road Classroom',
  3834: 'Busch Student Center',
}

/** esri category strings -> the coefficient keys below */
const CAT_KEY: Record<string, string> = {
  Academic: 'academic',
  Housing: 'housing',
  Agricultural: 'agricultural',
  Administrative: 'administrative',
  'Student Life': 'studentLife',
  Storage: 'storage',
  Utilities: 'utilities',
  Athletic: 'athletic',
  'Health Care': 'healthCare',
  Research: 'research',
  'Information Center': 'informationCenter',
  Parking: 'parking',
}

/** bus boardings per hour per m² of floor, by building category (occupancy x bus share) */
const CAT_COEF: Record<string, number> = {
  academic: 0.003,
  housing: 0.002,
  studentLife: 0.005,
  healthCare: 0.002,
  administrative: 0.002,
  research: 0.002,
  informationCenter: 0.002,
  athletic: 0.001,
  agricultural: 0.0004,
  storage: 0.0004,
  utilities: 0.0002,
  untagged: 0.001,
}

/** parking generates commuter trips: stalls (area / 30 m²) x how many of those parkers ride a bus */
const PARK_COEF = 0.06 /* boardings per stall per peak hour */
const PARK_M2_PER_STALL = 30

const CAT_FLOORS: Record<string, number> = {
  academic: 3,
  housing: 4,
  studentLife: 2,
  healthCare: 3,
  administrative: 2,
  research: 3,
  informationCenter: 2,
  athletic: 2,
  agricultural: 1,
  storage: 1,
  utilities: 1,
  untagged: 2,
}

const CAT_COLOUR: Record<string, string> = {
  academic: '#c9b8a4',
  housing: '#b9a48f',
  studentLife: '#c2a27a',
  healthCare: '#e3d6c8',
  administrative: '#a9b2bb',
  research: '#b6c2bf',
  informationCenter: '#a9b2bb',
  athletic: '#b7c6a0',
  agricultural: '#a9bd8f',
  storage: '#9aa3ad',
  utilities: '#8f979f',
  parking: '#5f6468',
  untagged: '#b0aca4',
}

/** weekday activity by hour: class changes at 8–9, lunch, the 5 pm wave */
const HOUR_WEIGHT = [
  0.05, 0.03, 0.02, 0.02, 0.03, 0.08, 0.25, 0.7, 1, 0.85, 0.9, 0.8, 0.75, 0.85, 0.9, 0.85, 0.8, 0.85, 0.6,
  0.4, 0.3, 0.2, 0.12, 0.07,
]

/** filled once at load: the geometry to draw, the arrival rate each stop inherits, and its district */
const CAMPUS: {
  buildings: CampusBuilding[]
  perStop: Partial<Record<StopKey, number>>
  districtVotes: Record<string, Record<string, number>>
} = { buildings: [], perStop: {}, districtVotes: {} }

const nearestStop = (x: number, z: number) => {
  let best: StopKey = 'arc'
  let bestD = Infinity
  for (const k of Object.keys(STOPS) as StopKey[]) {
    const [sx, sz] = STOPS[k].at
    const d = (sx - x) ** 2 + (sz - z) ** 2
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

/** tightest oriented box around a ring, over six rotations — used for both sources */
const tightBox = (pts: [number, number][]) => {
  let cx = 0
  let cz = 0
  for (const [x, z] of pts) {
    cx += x
    cz += z
  }
  cx /= pts.length
  cz /= pts.length

  let w = 0
  let d = 0
  let rot = 0
  let bestArea = 0
  for (let r = 0; r < 6; r++) {
    const a = (r * Math.PI) / 12
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of pts) {
      const px = (x - cx) * Math.cos(a) + (z - cz) * Math.sin(a)
      const pz = -(x - cx) * Math.sin(a) + (z - cz) * Math.cos(a)
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minZ = Math.min(minZ, pz)
      maxZ = Math.max(maxZ, pz)
    }
    const area = (maxX - minX) * (maxZ - minZ)
    if (bestArea === 0 || area < bestArea) {
      bestArea = area
      w = maxX - minX
      d = maxZ - minZ
      rot = a
    }
  }
  return { cx, cz, w, d, rot, area: bestArea }
}

const ringsOf = (g: any): [number, number][][] =>
  g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()

/**
 * Buildings: Rutgers' own facilities inventory (ArcGIS, 737 New Brunswick buildings with BldgNum,
 * name, category and district; CORS open, ~280 KB simplified). Parking: rubus.live's 191 named lots.
 * ponytail: the official Shape__Area field is not in ft² or m² (1.3M for the whole campus), so area
 * is computed from the ring instead of trusted.
 */
const BUILDINGS_URL =
  'https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/Rutgers_University_Buildings/FeatureServer/0/query?' +
  new URLSearchParams({
    where: "Campus='Rutgers University - New Brunswick'",
    outFields: 'BldgNum,BldgName,Category,District',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    maxAllowableOffset: '0.00004',
    f: 'geojson',
    resultRecordCount: '2000',
  }).toString()

const PARKING_URL = 'https://rubus.live/lib/buildings-parking_nb.json'

const loadCampusOnce = async () => {
  const [bRes, pRes] = await Promise.all([
    fetch(BUILDINGS_URL),
    fetch(PARKING_URL).catch(() => null), // parking is a bonus: buildings still load without it
  ])
  const geo = await bRes.json()
  const park = pRes ? await pRes.json() : { features: [] }

  const perStop: Partial<Record<StopKey, number>> = {}
  const votes: Record<string, Record<string, number>> = {}
  const buildings: CampusBuilding[] = []

  for (const f of geo.features as any[]) {
    const p = f.properties ?? {}
    const cat = CAT_KEY[String(p.Category)] ?? 'untagged'
    const ring = ringsOf(f.geometry).sort((a, b) => b.length - a.length)[0]
    if (!ring || ring.length < 4) continue

    const pts = ring.map(([lon, lat]: [number, number]) => toUnit(lat, lon))
    const box = tightBox(pts)
    const floors = CAT_FLOORS[cat] ?? 2
    const sqM = box.area * 2500 /* 1 unit = 50 m, so 1 unit² = 2500 m² */
    const stop = nearestStop(box.cx, box.cz)
    const district: string = p.District ?? ''

    perStop[stop] = (perStop[stop] ?? 0) + sqM * floors * (CAT_COEF[cat] ?? 0.001)
    if (district) {
      votes[stop] = votes[stop] ?? {}
      votes[stop][district] = (votes[stop][district] ?? 0) + 1
    }

    buildings.push({
      x: box.cx,
      z: box.cz,
      w: Math.max(0.2, box.w),
      d: Math.max(0.2, box.d),
      rot: box.rot,
      h: floors * m(3.6) /* one storey = 3.6 m, true height */,
      cat,
      name: LANDMARK_NUM[p.BldgNum] ?? '',
      district,
      stop,
    })
  }

  // parking lots: flat slabs, demand from stall count
  for (const f of park.features as any[]) {
    const props = f.properties ?? {}
    if (props.category !== 'parking') continue
    const ring = ringsOf(f.geometry).sort((a, b) => b.length - a.length)[0]
    if (!ring || ring.length < 4) continue

    const pts = ring.map(([lon, lat]: [number, number]) => toUnit(lat, lon))
    const box = tightBox(pts)
    const sqM = box.area * 2500
    const stop = nearestStop(box.cx, box.cz)

    perStop[stop] = (perStop[stop] ?? 0) + (sqM / PARK_M2_PER_STALL) * PARK_COEF
    buildings.push({
      x: box.cx,
      z: box.cz,
      w: Math.max(0.2, box.w),
      d: Math.max(0.2, box.d),
      rot: box.rot,
      h: 0.04,
      cat: 'parking',
      name: '',
      district: '',
      stop,
    })
  }

  CAMPUS.buildings = buildings
  CAMPUS.perStop = perStop
}

/** StrictMode runs effects twice; the campus only needs fetching once */
let campusPromise: Promise<void> | null = null
const loadCampus = () => (campusPromise ??= loadCampusOnce())

/** calibration knob: buildings + parking produce ~6,600 boardings/h at peak, scaled to ~80% of seat supply */
const DEMAND_SCALE = 0.6

const baselineRate = (key: StopKey, minute: number, term = 1) => {
  const perHour = (CAMPUS.perStop[key] ?? 0) * DEMAND_SCALE * term
  const hour = Math.floor((SIM_BASE + minute) / 60) % 24
  return (perHour / 60) * (HOUR_WEIGHT[hour] ?? 0.2)
}

const at = (run: SimRun, key: StopKey, minute: number) => {
  const i = Math.min(run.to - 1, Math.max(0, Math.floor(minute) - run.from))
  return run.queue[key]?.[i] ?? 0
}

/** 0..99 for the panels, against what the stop physically holds */
const stopDensity = (run: SimRun, key: StopKey, minute: number) =>
  Math.min(99, Math.round((at(run, key, minute) / QUEUE_100) * 100))

/** buses required to clear a queue at 80% full per departure */
const busesNeeded = (queued: number) => Math.max(0, Math.ceil(queued / (BUS_CAPACITY * 0.8)))

/** the chart: the next hour, six-minute steps */
/** the last hour, from what the agents actually did */
const series = (run: SimRun, key: StopKey, now: number) =>
  Array.from({ length: 11 }, (_, i) => {
    const min = Math.max(run.from, Math.round(now - 60 + i * 6))
    return { t: fmt(min), density: stopDensity(run, key, min) }
  })

const peakOver = (run: SimRun, key: StopKey, from: number, to: number) => {
  let best = { min: from, v: -1 }
  for (let m = from; m <= to; m += 2) {
    const v = stopDensity(run, key, m)
    if (v > best.v) best = { min: m, v }
  }
  return best
}

/** buses drawn per running route, from its headway and any service intervention */
/* fleet: vehicles needed = cycle time / headway. This is the real transit equation. */
const BUS_SPEED_KMH = 18 /* ponytail: campus average incl. stops and traffic; calibrate from the app (see "Fleet calibration") */
const DWELL_MIN = 0.33 /* ~20 s per stop */

/** round-trip running time in minutes (route length is in 50 m units) */
const cycleMin = (route: (typeof ROUTES)[number]) =>
  ((route.len * 0.05) / BUS_SPEED_KMH) * 60 + route.stops.length * DWELL_MIN

/** vehicles in service, before any intervention */
const fleetFor = (route: (typeof ROUTES)[number], headway: number, scale: number) =>
  Math.max(1, Math.ceil(cycleMin(route) / (headway * scale)))

/**
 * Observed in-service counts, which override the derived number.
 * 2026-10-18 ~20:00 ET (Saturday), from `node scripts/fetch-fleet.mjs` against wss://demo.rubus.live/ws
 */
const FLEET_OBSERVED: Partial<Record<string, number>> = { W1: 4, W2: 5 }

/** the ten routes as the engine wants them: ordered halts, and a headway that knows the date */

type Preset = { id: string; label: string; apply: (w: World) => World }

const PRESETS: Preset[] = [
  {
    id: 'arc-surge',
    label: 'Event surge at ARC (1,200 RSVPs)',
    apply: (w) => ({
      ...w,
      event: { ...SCENARIO_0, venue: 'arc', rsvps: 1200, startMin: 45, durationMin: 60 },
    }),
  },
  {
    id: 'game-day',
    label: "Game day at Jersey Mike's Arena (8,000)",
    apply: (w) => ({
      ...w,
      event: { ...SCENARIO_0, venue: 'jma', rsvps: 8000, startMin: 90, durationMin: 180 },
      serviceScale: { ...w.serviceScale, A: 0.6, H: 0.6 },
    }),
  },
  {
    id: 'dining-hall',
    label: 'New dining hall at Livingston (700 seats)',
    apply: (w) => ({
      ...w,
      places: [
        ...w.places,
        {
          id: 'dining-hall',
          label: 'Livingston Dining Hall',
          kind: 'dining',
          stop: 'livSc',
          slot: 0,
          capacity: 700,
          hours: [600, 1320],
        },
      ],
    }),
  },
  {
    id: 'restaurant-row',
    label: 'Restaurant row at College Ave',
    apply: (w) => ({
      ...w,
      places: [
        ...w.places,
        {
          id: 'market',
          label: 'College Ave Market',
          kind: 'retail',
          stop: 'cas',
          slot: 1,
          capacity: 260,
          hours: [600, 1380],
        },
        {
          id: 'pizza',
          label: 'Late-night Pizza',
          kind: 'dining',
          stop: 'cas',
          slot: 2,
          capacity: 140,
          hours: [840, 1440],
        },
      ],
    }),
  },
  {
    id: 'b-cut',
    label: 'Route B cut to a 20-minute headway',
    apply: (w) => ({ ...w, serviceScale: { ...w.serviceScale, B: 3 } }),
  },
  {
    id: 'arc-closed',
    label: 'ARC stop closed for construction',
    apply: (w) => ({ ...w, closed: [...w.closed, 'arc'] }),
  },
  {
    id: 'late-night',
    label: 'Cook/Douglass late-night pilot',
    apply: (w) => ({
      ...w,
      serviceScale: { ...w.serviceScale, RexB: 0.5, RexL: 0.5 },
      places: [
        ...w.places,
        {
          id: 'night-cafe',
          label: 'Red Oak Night Café',
          kind: 'retail',
          stop: 'redoak',
          slot: 0,
          capacity: 180,
          hours: [1140, 1440],
        },
      ],
    }),
  },
]

/* ------------------------------------------------------------------ */
/* 5. natural-language command                                        */
/* ------------------------------------------------------------------ */

type Command = {
  event?: Partial<Scenario>
  place?: Omit<Place, 'id' | 'slot'>
  service?: { route: string; everyMin?: number; factor?: number }
  close?: StopKey
  buses?: number
  speed?: number
  day?: Day
  reset?: boolean
  notes: string[]
}

const PROMPT_EXAMPLES = '3,000 RSVPs at Busch Student Center, Saturday 6pm for 2 hours'

const ALIASES: [StopKey, string[]][] = [
  ['arc', ['allison', 'arc']],
  ['bsc', ['busch', 'bsc']],
  ['cas', ['college ave', 'college avenue']],
  ['livSc', ['livingston']],
  ['hill', ['hill center']],
  ['science', ['science building']],
  ['quads', ['quads']],
  ['jma', ['jersey mike', 'arena', 'rac']],
  ['stadium', ['stadium']],
  ['werblin', ['werblin', 'weblin']],
  ['sac', ['activities center', 'sac']],
  ['yard', ['the yard']],
  ['socam', ['socam']],
  ['biel', ['biel']],
  ['lipman', ['lipman']],
  ['gibbons', ['gibbons']],
  ['henderson', ['henderson']],
  ['collegeHall', ['college hall']],
  ['redoak', ['red oak']],
  ['rodkin', ['rodkin']],
]

const findStop = (t: string) => ALIASES.find(([, words]) => words.some((w) => t.includes(w)))?.[0]

/**
 * Sentence -> world changes. One function, one call site (`applyPrompt`).
 * ponytail: rule-based so the sandbox runs with no key and no network. To wire an LLM, keep the
 * signature and replace the body with a fetch that returns this `Command` shape, then await it.
 */
const parseCommand = (text: string, now: number): Command => {
  const t = text.toLowerCase()
  const notes: string[] = []
  const stop = findStop(t)

  const event: Partial<Scenario> = {}
  const count = Number(
    (
      t.match(/([\d,]+)\s*(?:rsvps?|people|attendees|students|guests|fans)/)?.[1] ??
      t.match(/\b([\d,]{3,6})\b/)?.[1] ??
      ''
    ).replace(/,/g, ''),
  )
  if (Number.isFinite(count) && count > 0 && count <= 20000) {
    event.rsvps = count
    notes.push(`${count.toLocaleString()} RSVPs`)
  }

  const clocked = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  const relative = t.match(/\bin (\d+)\s*(?:min|minutes)\b/)
  if (clocked) {
    const hour = (Number(clocked[1]) % 12) + (clocked[3] === 'pm' ? 12 : 0)
    event.startMin = Math.max(0, hour * 60 + Number(clocked[2] ?? 0) - SIM_BASE)
    notes.push(`starts ${fmt(event.startMin)}`)
  } else if (relative) {
    event.startMin = Math.max(0, Math.round(now + Number(relative[1])))
    notes.push(`starts ${fmt(event.startMin)}`)
  }

  const dur = t.match(/\b(?:for|lasting)\s*(\d+)\s*(hours?|hrs?|min|minutes|mins)\b/)
  if (dur) {
    const n = Number(dur[1])
    event.durationMin = /^(h|hour)/.test(dur[2]) ? n * 60 : n
    notes.push(`${event.durationMin} min event`)
  }

  let day: Day | undefined
  if (/\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday)\b/.test(t)) {
    day = 'mo-th'
    notes.push('day: Mon–Thu')
  } else if (/\b(fri|friday)\b/.test(t)) {
    day = 'fr'
    notes.push('day: Friday')
  } else if (/\b(sat|saturday)\b/.test(t)) {
    day = 'sa'
    notes.push('day: Saturday')
  } else if (/\b(sun|sunday)\b/.test(t)) {
    day = 'su'
    notes.push('day: Sunday')
  }

  // "add a 400 seat dining hall at livingston" / "new restaurant at college ave with 200 seats"
  let place: Command['place'] | undefined
  const placeWord = t.match(
    /\b(building|restaurant|dining hall|cafeteria|cafe|café|hall|shop|store|market|gym|lab|library)\b/,
  )
  if (stop && placeWord) {
    const kind: PlaceKind = /restaurant|dining|cafeteria|cafe|café|hall|market/.test(placeWord[1])
      ? 'dining'
      : /shop|store/.test(placeWord[1])
        ? 'retail'
        : 'building'
    const seats = Number(t.match(/(\d+)\s*(?:seat|seats|capacity|people|students)/)?.[1] ?? 300)
    place = {
      label: `${STOPS[stop].label} ${placeWord[1].replace(/\b\w/g, (c) => c.toUpperCase())}`,
      kind,
      stop,
      capacity: Math.max(50, Math.min(9000, seats)),
      hours: [600, 1320],
    }
    notes.push(`new ${kind}: ${place.label} (${place.capacity})`)
  }

  // "route b every 20 minutes" / "double route h"
  let service: Command['service'] | undefined
  const refMatch = t.match(/\b(?:route|bus)\s*(a|b|b\/l|c|h|rexb|rexl|lx|w1|w2)\b/)
  if (refMatch) {
    const ref = refMatch[1].toUpperCase()
    const every = t.match(/every\s*(\d+)\s*(?:min|minutes)/)
    const factor = /\bhalve|half\b/.test(t) ? 2 : /\b(double|twice)\b/.test(t) ? 0.5 : undefined
    if (every) {
      service = { route: ref, everyMin: Number(every[1]) }
      notes.push(`route ${ref} every ${every[1]} min`)
    } else if (factor) {
      service = { route: ref, factor }
      notes.push(`route ${ref} ${factor === 0.5 ? 'doubled' : 'halved'}`)
    }
  }

  // "close the arc stop", "close allison"
  const close = stop && /\b(close|closed|shut|suspend)\b/.test(t) ? stop : undefined
  if (close) notes.push(`closed: ${STOPS[close].label}`)

  const buses = t.match(/\b(?:add|spawn|send|put)\s*(\d+)\s*(?:more\s*)?(?:reserve\s*)?buses?\b/)
  const speed = t.match(/\b(\d{1,2})\s*x\b/)
  const reset = /\b(reset|start over|clear)\b/.test(t)
  if (buses) notes.push(`+${buses[1]} reserve buses`)
  if (speed) notes.push(`${speed[1]}x speed`)
  if (reset) notes.push('reset')

  return {
    event: Object.keys(event).length ? event : undefined,
    place,
    service,
    close,
    buses: buses ? Number(buses[1]) : undefined,
    speed: speed ? Number(speed[1]) : undefined,
    day,
    reset,
    notes,
  }
}

/* ------------------------------------------------------------------ */
/* 6. sensor rows                                                     */
/* ------------------------------------------------------------------ */

const NODES: { name: string; key: StopKey }[] = [
  { name: 'ARC Stop', key: 'arc' },
  { name: 'Busch Student Center', key: 'bsc' },
  { name: 'Livingston Student Center', key: 'livSc' },
  { name: 'College Ave Student Center', key: 'cas' },
  { name: 'Quads', key: 'quads' },
  { name: 'Hill Center', key: 'hill' },
  { name: 'Science Buildings', key: 'science' },
  { name: 'The Yard', key: 'yard' },
  { name: 'Biel Road', key: 'biel' },
  { name: 'Red Oak Lane', key: 'redoak' },
]

/* ------------------------------------------------------------------ */
/* 7. entities                                                        */
/* ------------------------------------------------------------------ */

/** ponytail: ~20x oversized so people read at 50 m/unit; zoom to maxZoom 40 for figures */

/** one figure. Static stance, animated by whatever group carries it — 120 of these must not each own a frame callback. */
/**
 * A Rutgers bus: white body, scarlet band, glazed windows on both sides, four wheels.
 * Position comes from the simulation; nothing here is decorative.
 */
function Bus({
  route,
  track,
  clock,
}: {
  route: (typeof ROUTES)[number]
  track: { t: number; d: number; load: number }[]
  clock: { t: number }
}) {
  const g = useRef<ThreeGroup>(null)

  useFrame(() => {
    const node = g.current
    if (!node || track.length < 2) return
    const minute = clock.t
    const i = Math.min(track.length - 2, Math.max(0, Math.floor(minute) - track[0].t))
    const a = track[i]
    const b = track[i + 1]
    const wrap = Math.abs(b.d - a.d) > route.len / 2
    const f = wrap ? 0 : (minute - a.t) / Math.max(0.001, b.t - a.t)
    const d = wrap ? a.d : a.d + (b.d - a.d) * Math.max(0, Math.min(1, f))
    const p = samplePath(route.path, route.len, d)
    node.position.set(p.x, 0.12, p.z)
    node.rotation.y = p.rot
  })

  const wheels: [number, number][] = [
    [-0.72, -0.42],
    [-0.72, 0.42],
    [0.72, -0.42],
    [0.72, 0.42],
  ]

  return (
    <group ref={g}>
      <group scale={m(12) / 2.1}>
        {/* body */}
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[2.1, 0.44, 0.86]} />
          <meshStandardMaterial color="#f7f7f5" roughness={0.55} />
        </mesh>
        {/* scarlet band, the only Rutgers colour that matters */}
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[2.12, 0.16, 0.88]} />
          <meshStandardMaterial color="#cc0033" roughness={0.6} />
        </mesh>
        {/* windows: dark glass on both flanks */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 0.5, side * 0.435]}>
            <boxGeometry args={[1.82, 0.2, 0.02]} />
            <meshStandardMaterial color="#1f2a37" roughness={0.15} metalness={0.5} />
          </mesh>
        ))}
        {/* windscreen and rear glass */}
        {[-1, 1].map((end2) => (
          <mesh key={end2} position={[end2 * 1.045, 0.5, 0]}>
            <boxGeometry args={[0.02, 0.2, 0.74]} />
            <meshStandardMaterial color="#1f2a37" roughness={0.15} metalness={0.5} />
          </mesh>
        ))}
        {/* roof detail so the top does not read as a floating slab */}
        <mesh position={[0, 0.66, 0]}>
          <boxGeometry args={[1.6, 0.05, 0.6]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.7} />
        </mesh>
        {wheels.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.13, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 14]} />
            <meshStandardMaterial color="#111827" roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** the near-field figure: head, torso, arms, legs. Capsules are for crowds at distance. */
function Person({ shirt, skin, scale = 0.5 }: { shirt: string; skin: string; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh position={[-0.075, 0.28, 0]} rotation-x={0.22}>
        <capsuleGeometry args={[0.055, 0.22, 2, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.9} />
      </mesh>
      <mesh position={[0.075, 0.28, 0]} rotation-x={-0.22}>
        <capsuleGeometry args={[0.055, 0.22, 2, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <capsuleGeometry args={[0.13, 0.24, 3, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.88, 0]}>
        <sphereGeometry args={[0.1, 10, 10]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
      <mesh position={[-0.18, 0.62, 0]} rotation-z={0.16}>
        <capsuleGeometry args={[0.038, 0.18, 2, 6]} />
        <meshStandardMaterial color={shirt} roughness={0.85} />
      </mesh>
      <mesh position={[0.18, 0.62, 0]} rotation-z={-0.16}>
        <capsuleGeometry args={[0.038, 0.18, 2, 6]} />
        <meshStandardMaterial color={shirt} roughness={0.85} />
      </mesh>
    </group>
  )
}

/** every agent, one draw call. Riders are hidden inside the bus they are on. */
/** every agent, one draw call, interpolated between the last two simulated minutes */
function Crowd({
  agents,
  buses,
  size,
  clock,
  skip,
}: {
  agents: SimAgent[]
  buses: { px: number; pz: number; x: number; z: number }[]
  size: number
  clock: { t: number }
  skip: Set<number>
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colour = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.t
    const f = t - Math.floor(t)
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      // riders are inside a bus, not nowhere: keep them on it so nobody pops out of existence
      const bus = a.state === 'ride' ? buses[a.bus] : undefined
      const shown = !skip.has(a.id)
      const sx = bus ? bus.px + (bus.x - bus.px) * f : a.px + (a.x - a.px) * f
      const sz = bus ? bus.pz + (bus.z - bus.pz) * f : a.pz + (a.z - a.pz) * f
      const x = sx
      const z = sz
      const s = shown ? size / 1.7 : 0.0001
      dummy.position.set(x, shown ? s * 0.85 : -80, z)
      dummy.scale.set(s, s, s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // waiting = warm red, walking = the shirt colour, at school = grey
      const c = a.state === 'wait' ? '#d9483b' : a.state === 'at-dest' ? '#94a3b8' : a.colour
      mesh.setColorAt(i, colour.set(c))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, agents.length)]} frustumCulled={false}>
      {/* 1.7 model units tall, scaled by size to a real 1.75 m */}
      <capsuleGeometry args={[0.35, 1, 3, 8]} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  )
}

function RouteLine({ route, active }: { route: (typeof ROUTES)[number]; active: boolean }) {
  return (
    <Line
      points={route.path.map(([x, z]) => [x, 0.05, z])}
      color={route.colour}
      lineWidth={active ? 2.4 : 1.2}
      transparent
      opacity={active ? 0.9 : 0.14}
      depthTest={false}
      renderOrder={3}
    />
  )
}

function StopMark({
  at,
  label,
  major,
  closed,
}: {
  at: Vec2
  label: string
  major: boolean
  closed: boolean
}) {
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
        <circleGeometry args={[m(major ? 5 : 3), 18]} />
        <meshStandardMaterial color={closed ? '#fecaca' : '#ffffff'} opacity={0.9} transparent />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, 0]}>
        <ringGeometry args={[m(major ? 3.6 : 2.4), m(major ? 5 : 3.2), 20]} />
        <meshStandardMaterial color={closed ? '#dc2626' : '#475569'} />
      </mesh>
      {major && (
        <Html position={[0, m(major ? 14 : 10), 0]} center style={{ pointerEvents: 'none' }}>
          <div
            className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[8px] font-semibold shadow-sm ring-1 ring-black/5 ${
              closed ? 'bg-red-50 text-red-700' : 'bg-white/90 text-slate-700'
            }`}
          >
            {label}
            {closed ? ' · closed' : ''}
          </div>
        </Html>
      )}
    </group>
  )
}

const PLACE_COLOUR: Record<PlaceKind, string> = {
  building: '#64748b',
  dining: '#d97706',
  retail: '#0284c7',
  venue: '#7c3aed',
}

function PlaceMass({ place }: { place: Place }) {
  const base = STOPS[place.stop].at
  const angle = (place.slot % 6) * (Math.PI / 3)
  const x = base[0] + Math.cos(angle) * 2.6
  const z = base[1] + Math.sin(angle) * 2.6
  const w = 1.2 + Math.min(2.4, place.capacity / 900)
  const h = 0.9 + Math.min(2.2, place.capacity / 1500)

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, w * 0.8]} />
        <meshStandardMaterial color={PLACE_COLOUR[place.kind]} roughness={0.7} />
      </mesh>
      <Html position={[0, h + 0.5, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded border border-white/70 bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 shadow-sm">
          {place.label}
        </div>
      </Html>
    </group>
  )
}

/**
 * The real street network, from OSM, as one triangle mesh: 11k segments would be 11k draw calls as
 * lines, so each segment becomes a quad in a single vertex-coloured buffer. Widths are exaggerated
 * the same way everything else at 1:50 is.
 */
const ROAD_WIDTH: Record<string, number> = {
  motorway: m(22),
  trunk: m(22),
  primary: m(18),
  secondary: m(14),
  tertiary: m(11),
  residential: m(8),
  unclassified: m(8),
  living_street: m(6),
  service: m(5.5),
  footway: m(2.4),
  path: m(2),
  pedestrian: m(6),
  steps: m(2),
  cycleway: m(2.4),
}

const ROAD_COLOUR: Record<string, number[]> = {
  footway: [0.82, 0.8, 0.76],
  path: [0.84, 0.82, 0.78],
  pedestrian: [0.85, 0.83, 0.79],
  steps: [0.8, 0.78, 0.74],
  cycleway: [0.7, 0.76, 0.7],
  motorway: [0.42, 0.44, 0.47],
  trunk: [0.42, 0.44, 0.47],
  primary: [0.47, 0.49, 0.52],
  secondary: [0.53, 0.55, 0.58],
  tertiary: [0.58, 0.6, 0.62],
  residential: [0.64, 0.65, 0.67],
  unclassified: [0.64, 0.65, 0.67],
  living_street: [0.66, 0.67, 0.69],
  service: [0.7, 0.71, 0.72],
}

function Roads() {
  /* One buffer for the whole network, built from the same graph the bus routes are
     computed on — so a route can never run where no road is drawn. */
  const geom = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    const net = NETWORK as unknown as { edges: { a: number[]; b: number[]; kind: string }[] }
    for (const e of net.edges) {
      const [x1, z1] = e.a as [number, number]
      const [x2, z2] = e.b as [number, number]
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz) || 1
      const w = (ROAD_WIDTH[e.kind] ?? m(5.5)) / 2
      const nx = (-dz / len) * w
      const nz = (dx / len) * w
      const c = ROAD_COLOUR[e.kind] ?? [0.66, 0.67, 0.69]
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
      for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <mesh geometry={geom} position={[0, 0.02, 0]}>
      <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Buildings({ data }: { data: CampusBuilding[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const mesh = ref.current
    if (!mesh || data.length === 0) return
    const dummy = new THREE.Object3D()
    const colour = new THREE.Color()
    data.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z)
      dummy.rotation.set(0, b.rot, 0)
      dummy.scale.set(b.w, b.h, b.d)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colour.set(b.name ? '#a85643' : (CAT_COLOUR[b.cat] ?? '#b0aca4')))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [data])

  return (
    <instancedMesh key={data.length} ref={ref} args={[undefined, undefined, Math.max(1, data.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.92} />
    </instancedMesh>
  )
}

/** the two named landmarks keep their labels; everything else is colour-coded mass */
const STOP_LABELS = new Set<string>(Object.values(STOPS).map((s) => s.label))

function LandmarkLabels({ data }: { data: CampusBuilding[] }) {
  return (
    <>
      {data
        /* a stop marker already names its own building — don't stack two labels on one roof */
        .filter((b) => b.name && !STOP_LABELS.has(b.name))
        .map((b) => (
          <Html key={b.name} position={[b.x, b.h + m(6), b.z]} center style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded-md border border-white/70 bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
              {b.name}
            </div>
          </Html>
        ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 8. scene                                                           */
/* ------------------------------------------------------------------ */

function Scene({
  world,
  run,
  agents,
  day,
  minute,
  nowF,
  sim,
  clock,
  speed,
  onCamera,
}: {
  world: World
  run: SimRun
  agents: SimAgent[]
  day: Day
  /** absolute minutes since midnight — for the service calendar */
  minute: number
  /** sim-relative fractional minutes — for smooth motion */
  nowF: number
  sim: Sim
  /** mutable sim clock, advanced once per frame so motion never waits on React */
  clock: { t: number }
  speed: number
  onCamera?: (camera: THREE.Camera) => void
}) {
  // advance the simulation off the frame clock, not off React renders
  useFrame((_, dt) => {
    clock.t += Math.min(0.25, dt) * speed
    const target = Math.floor(clock.t)
    if (target > sim.minute) sim.runTo(target)
  }, -1)
  const { camera } = useThree()
  useEffect(() => {
    onCamera?.(camera)
  }, [camera, onCamera])
  const venue = world.event?.venue ?? 'arc'
  /* ponytail: tokens follow the run's queue across stops, capped so the map stays readable */
  // whoever is within 14 units of the view centre gets a real figure
  const focus: [number, number] = [-30.6, -46.2]
  const near = agents
    .filter((a) => a.state !== 'ride' && Math.hypot(a.x - focus[0], a.z - focus[1]) < m(45))
    .slice(0, 26)
  const nearIds = new Set(near.map((a) => a.id))

  return (
    <>
      <color attach="background" args={['#bfe0f5']} />
      <hemisphereLight args={['#eaf6ff', '#6f9e58', 0.9]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[40, 50, 30]} intensity={2.1} color="#fff6e5" />

      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[220, 300]} />
        <meshStandardMaterial color="#8ecf72" roughness={1} />
      </mesh>

      <Roads />
      <Buildings data={CAMPUS.buildings} />
      <LandmarkLabels data={CAMPUS.buildings} />

      {ROUTES.map((route) => (
        <RouteLine key={route.ref} route={route} active={routeState(route, day, minute) !== null} />
      ))}

      {(Object.keys(STOPS) as StopKey[]).map((key) => (
        <StopMark
          key={key}
          at={STOPS[key].at}
          label={STOPS[key].label}
          major={STOPS[key].major === true || key === venue}
          closed={world.closed.includes(key)}
        />
      ))}

      {world.places.map((place) => (
        <PlaceMass key={place.id} place={place} />
      ))}

      {run.buses.map((b, i) => {
        const route = ROUTES.find((r) => r.ref === b.ref)
        if (!route) return null
        return <Bus key={`${b.ref}-${i}`} route={route} track={b.track} clock={clock} />
      })}

      {/* near the camera you get people; further out, crowd tokens */}
      <Crowd agents={agents} buses={sim.buses} size={m(1.75)} clock={clock} skip={nearIds} />
      {near.map((a) => {
        const f = nowF - Math.floor(nowF)
        const x = a.px + (a.x - a.px) * f
        const z = a.pz + (a.z - a.pz) * f
        return (
          <group key={a.id} position={[x, 0, z]}>
            <Person shirt={a.colour} skin="#e0b394" scale={m(1.75)} />
          </group>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 9. dashboard                                                       */
/* ------------------------------------------------------------------ */

const densityBar = (d: number) => (d >= 75 ? 'bg-[#ee0000]' : d >= 50 ? 'bg-amber-500' : 'bg-emerald-500')

/** ten colours and no key is a puzzle; this is the key */
function RouteLegend({ day, minute }: { day: Day; minute: number }) {
  return (
    <div className="absolute bottom-5 left-5 z-20 w-[13.5rem] rounded-2xl border border-white/70 bg-white/75 p-3 shadow-lg shadow-slate-900/5 backdrop-blur-md">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Routes</div>
      <ul className="grid grid-cols-2 gap-x-2 gap-y-1">
        {ROUTES.map((r) => {
          const on = routeState(r, day, minute) !== null
          return (
            <li
              key={r.ref}
              className={`flex items-center gap-1.5 text-[11px] ${on ? 'text-slate-700' : 'text-slate-400 line-through'}`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: on ? r.colour : '#cbd5e1' }}
              />
              {r.ref}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** reload keeps your scenario — a what-if tool that forgets is a demo, not a tool */
const SAVED_KEY = 'rutgers-twin-v1'

const readSaved = (): { scenario: Scenario; active: string[]; date: string } | null => {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function App() {
  const saved = useMemo(readSaved, [])
  const [scenario, setScenario] = useState<Scenario>(saved?.scenario ?? SCENARIO_0)
  const [active, setActive] = useState<string[]>(saved?.active ?? [])
  const [baseline, setBaseline] = useState<World | null>(null)
  const [eventOn, setEventOn] = useState(true)
  const [closedStops, setClosedStops] = useState<StopKey[]>([])
  const [serviceAdj, setServiceAdj] = useState<Record<string, number>>({})
  const [dayNoise, setDayNoise] = useState(1) // 0 = means only, 1 = a real day
  const [observed, setObserved] = useState('')
  const [seed, setSeed] = useState(7)
  /** scale solved from an observed boarding count; see the calibration panel */
  const [cal, setCal] = useState<number>(() => Number(localStorage.getItem('rutgers-twin-cal') ?? '1'))
  const [customs, setCustoms] = useState<Preset[]>([])
  const [simMin, setSimMin] = useState(30)
  const [speed, setSpeed] = useState(4)
  /** live orthographic zoom, surfaced as a scale bar so the scale is never in doubt */
  const [zoomNow, setZoomNow] = useState(120)
  const controls = useRef<any>(null)
  const [running, setRunning] = useState(true)
  const [date, setDate] = useState<string>(saved?.date ?? '2026-10-19')
  const day = bandOf(date) // derived, never independent of the calendar
  const [reserves, setReserves] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [lastCommand, setLastCommand] = useState<{ text: string; notes: string[] } | null>(null)

  const [campusRev, setCampusRev] = useState(0)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setSimMin((m) => m + speed * 0.4), 400)
    return () => clearInterval(id)
  }, [running, speed])

  useEffect(() => {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ scenario, active, date }))
  }, [scenario, active, date])

  useEffect(() => {
    loadCampus()
      .then(() => setCampusRev((r) => r + 1))
      .catch(() => setCampusRev((r) => r + 1)) // offline: sim still runs, just without the fabric
  }, [])

  const library = useMemo(() => [...PRESETS, ...customs], [customs])
  /** prompt-built presets do not survive a reload; only count the ones that still exist */
  const applied = useMemo(() => library.filter((p) => active.includes(p.id)), [library, active])

  const world = useMemo<World>(() => {
    const base = applied.reduce<World>((w, p) => p.apply(w), { ...BASE_WORLD, event: scenario, date, cal })
    return {
      ...base,
      event: eventOn ? scenario : null,
      closed: [...base.closed, ...closedStops],
      serviceScale: { ...base.serviceScale, ...serviceAdj },
    }
  }, [applied, scenario, date, cal, eventOn, closedStops, serviceAdj])

  const venueKey = world.event?.venue ?? scenario.venue
  const venue = STOPS[venueKey]
  const minute = SIM_BASE + Math.floor(simMin)
  const nowMin = Math.floor(simMin)

  /** one whole simulated day for a world; memoised on the world, never on the animating clock */
  const makeWorld = (w: World, reserveBuses: number) => {
    const reserveRoute = ROUTES.find((r) => r.stops.includes(venueKey))?.ref ?? 'H'
    const routes: SimRouteSpec[] = ROUTES.map((route) => {
      const hw = headwayAt(route, 30, w.date)
      const scale = w.serviceScale[route.ref] ?? 1
      const base = hw === null ? 0 : (FLEET_OBSERVED[route.ref] ?? fleetFor(route, hw, scale))
      return {
        ref: route.ref,
        stops: route.stops,
        haltD: route.haltD,
        len: route.len,
        speed: (BUS_SPEED_KMH * 1000) / 60 / 50,
        fleet: base + (route.ref === reserveRoute ? reserveBuses : 0),
        sample: (d: number) => samplePath(route.path, route.len, d),
      }
    })

    return {
      buildings: CAMPUS.buildings.map((b, i) => ({ id: i, x: b.x, z: b.z, kind: b.cat, stop: b.stop })),
      stops: Object.fromEntries((Object.keys(STOPS) as StopKey[]).map((k) => [k, STOPS[k].at])) as Record<
        string,
        [number, number]
      >,
      routes,
      capacity: BUS_CAPACITY,
      walkSpeed: 1.62, // 1.35 m/s at 50 m per unit, in units per minute
      population: 600,
      seed,
      startClock: SIM_BASE,
    }
  }

  // one live simulation, stepped forward to the clock. Never re-run from zero.
  const simKey = `${campusRev}|${date}|${cal}|${seed}|${reserves}|${JSON.stringify(world)}`
  const simRef = useRef<{ key: string; sim: Sim } | null>(null)
  /** advanced per frame by the scene; the UI only samples it */
  const clock = useRef({ t: 0 }).current
  if (!simRef.current || simRef.current.key !== simKey) {
    simRef.current = { key: simKey, sim: createSim(makeWorld(world, reserves), 0) }
    clock.t = simMin
  }
  simRef.current.sim.runTo(Math.floor(simMin))
  const sim = simRef.current.sim
  const agents = sim.agents
  const run: SimRun = sim.snapshot()

  const queued = at(run, venueKey, nowMin)
  const chart = useMemo(() => series(run, venueKey, nowMin), [nowMin, venueKey, run])
  const peak = useMemo(() => peakOver(run, venueKey, simMin - 60, simMin), [run, venueKey, simMin])
  const needed = Math.max(0, busesNeeded(queued) - reserves)
  const modelledHour = baselineRate(venueKey, nowMin, TERM_DEMAND[termOf(date)] * cal) * 60

  // A/B: same clock, same day, two worlds — each with its own run
  const baseRun = useMemo(() => {
    if (!baseline) return null
    const b = createSim(makeWorld(baseline, 0), 0)
    b.runTo(nowMin)
    return b.snapshot()
  }, [baseline, nowMin]) // eslint-disable-line react-hooks/exhaustive-deps
  const baseQueued = baseRun ? at(baseRun, venueKey, nowMin) : null
  const baseNeeded = baseQueued === null ? null : Math.max(0, busesNeeded(baseQueued))
  const queueDelta =
    baseQueued === null ? null : Math.round(((queued - baseQueued) / Math.max(1, baseQueued)) * 100)

  const states = ROUTES.map((route) => ({ route, headway: routeState(route, day, minute) }))
  const activeCount = states.filter((s) => s.headway !== null).length

  const nodes = NODES.map((n) => ({
    key: n.key,
    name: n.name,
    band: '5G UWB',
    density: world.closed.includes(n.key) ? 0 : stopDensity(run, n.key, nowMin),
  }))

  const toggleStop = (k: StopKey) =>
    setClosedStops((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))

  /** +1 bus on a route is a shorter headway; the route list shows the result */
  const bumpRoute = (ref: string, dir: 1 | -1) =>
    setServiceAdj((prev) => {
      const route = ROUTES.find((r) => r.ref === ref)
      const baseHw = (route && routeState(route, bandOf(date), minute)) || 10
      const cur = baseHw * (prev[ref] ?? 1)
      const target = Math.min(baseHw * 3, Math.max(2, cur - dir * 1.5))
      return { ...prev, [ref]: target / baseHw }
    })

  const applyCalibration = () => {
    const obs = Number(observed)
    if (!Number.isFinite(obs) || obs <= 0 || modelledHour <= 0) return
    const next = Number((cal * (obs / modelledHour)).toFixed(3))
    setCal(next)
    localStorage.setItem('rutgers-twin-cal', String(next))
    setObserved('')
  }

  const applyPrompt = () => {
    const cmd = parseCommand(prompt, simMin)
    const stamp = Date.now().toString(36)

    if (cmd.reset) {
      setScenario(SCENARIO_0)
      setActive([])
      setCustoms([])
      setSimMin(30)
      setReserves(0)
      setSpeed(4)
      setDate('2026-10-19')
      setRunning(true)
    }
    if (cmd.event) {
      setScenario((s) => ({ ...s, ...cmd.event }))
      setSimMin(Math.max(0, (cmd.event!.startMin ?? scenario.startMin) - 10))
      setRunning(true)
    }
    if (cmd.place) {
      const place: Place = { ...cmd.place, id: `place-${stamp}`, slot: world.places.length }
      const preset: Preset = {
        id: `custom-${stamp}`,
        label: `New ${place.kind}: ${place.label}`,
        apply: (w) => ({ ...w, places: [...w.places, place] }),
      }
      setCustoms((c) => [...c, preset])
      setActive((a) => [...a, preset.id])
    }
    if (cmd.service) {
      const route = ROUTES.find((r) => r.ref === cmd.service!.route)
      const everyMin = cmd.service.everyMin
      // "every N minutes" is relative to the headway in force right now
      const current = route ? (routeState(route, day, minute) ?? 10) : 10
      const scale = cmd.service.factor ?? (everyMin ? everyMin / current : 1)
      const preset: Preset = {
        id: `custom-${stamp}`,
        label: `Route ${cmd.service.route} ×${scale.toFixed(1)} headway`,
        apply: (w) => ({ ...w, serviceScale: { ...w.serviceScale, [cmd.service!.route]: scale } }),
      }
      setCustoms((c) => [...c, preset])
      setActive((a) => [...a, preset.id])
    }
    if (cmd.close) {
      const closed = cmd.close
      const preset: Preset = {
        id: `custom-${stamp}`,
        label: `${STOPS[closed].label} closed`,
        apply: (w) => ({ ...w, closed: [...w.closed, closed] }),
      }
      setCustoms((c) => [...c, preset])
      setActive((a) => [...a, preset.id])
    }
    if (cmd.buses) setReserves((r) => r + cmd.buses!)
    if (cmd.speed) setSpeed(cmd.speed)
    if (cmd.day)
      setDate({ 'mo-th': '2026-10-19', fr: '2026-10-23', sa: '2026-10-24', su: '2026-10-25' }[cmd.day])

    setLastCommand({ text: prompt, notes: cmd.notes })
    setPrompt('')
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-[#bfe0f5] to-[#e9f6ff] text-slate-800">
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [40, 36, 40], zoom: 120, near: -600, far: 900 }}
        gl={{ antialias: true }}
        className="absolute inset-0"
      >
        <Scene
          world={world}
          run={run}
          agents={agents}
          day={day}
          minute={minute}
          nowF={simMin}
          sim={sim}
          clock={clock}
          speed={speed}
          onCamera={(c) => ((window as unknown as { __cam: unknown }).__cam = c)}
        />
        <OrbitControls
          makeDefault
          target={[-30.6, 0, -46.2]}
          enableRotate={false}
          enablePan
          screenSpacePanning
          enableDamping
          dampingFactor={0.12}
          mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          ref={controls}
          onChange={() => {
            const z = controls.current?.object?.zoom
            if (z && Math.abs(z - zoomNow) > 0.5) setZoomNow(z)
          }}
          zoomSpeed={2}
          minZoom={6}
          maxZoom={1400}
        />
      </Canvas>

      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 border-b border-white/60 bg-white/70 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ee0000] text-sm font-black text-white">
            R
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-slate-900">Rutgers 5G Transit Twin</h1>
              <span className="rounded-full bg-[#ee0000] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
                sim
              </span>
              <span className="text-[9px] text-slate-400">
                roads {(NETWORK as unknown as { edges: unknown[] }).edges.length}
              </span>
              <span
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-600"
                title="width of the viewport in metres — 1 unit = 50 m"
              >
                {Math.round(((typeof window === 'undefined' ? 1280 : window.innerWidth) / zoomNow) * 50)} m
                across
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Powered by Verizon Mobile Edge Compute · simulated telemetry
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            <input
              type="date"
              value={date}
              min="2026-09-01"
              max="2027-08-31"
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-700 outline-none"
            />
            <span className={termOf(date) === 'session' ? 'text-emerald-600' : 'text-amber-600'}>
              {termOf(date)} · demand ×{TERM_DEMAND[termOf(date)]}
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="tabular-nums text-sm font-semibold text-slate-900">{fmt(simMin)}</span>
            <button
              onClick={() => setRunning((r) => !r)}
              className="rounded-md border border-slate-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-white"
            >
              {running ? 'Pause' : 'Play'}
            </button>
            {[1, 4, 16].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                  speed === s
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white/70 text-slate-600'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">Map data © OpenStreetMap contributors</span>
        </div>
      </header>

      <aside className="absolute left-5 top-24 z-20 max-h-[calc(100vh-9.5rem)] w-[19.5rem] space-y-3 overflow-y-auto pr-1">
        <section className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Scenario</h2>
            <span className="rounded-full bg-[#ee0000]/10 px-2 py-0.5 text-[10px] font-semibold text-[#c40000]">
              live
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Event</span>
            <button
              onClick={() => setEventOn((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${
                eventOn ? 'bg-[#ee0000] text-white' : 'bg-slate-900/[0.07] text-slate-500'
              }`}
            >
              {eventOn ? 'on' : 'off'}
            </button>
          </div>

          <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Venue
          </label>
          <select
            value={scenario.venue}
            onChange={(e) => setScenario((s) => ({ ...s, venue: e.target.value as StopKey }))}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-[#ee0000]"
          >
            {(Object.keys(STOPS) as StopKey[]).map((k) => (
              <option key={k} value={k}>
                {STOPS[k].label} ({STOPS[k].capacity.toLocaleString()}
                {STOPS[k].capacitySrc === 'estimate' ? ' est.' : ''})
              </option>
            ))}
          </select>

          <div className="mt-3 flex items-end justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">RSVPs</label>
            <input
              type="number"
              min={0}
              max={20000}
              step={50}
              value={scenario.rsvps}
              onChange={(e) =>
                setScenario((s) => ({
                  ...s,
                  rsvps: Math.max(0, Math.min(20000, Number(e.target.value) || 0)),
                }))
              }
              className="w-20 rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-right text-[11px] tabular-nums outline-none focus:border-[#ee0000]"
            />
          </div>
          <input
            type="range"
            min={0}
            max={8000}
            step={50}
            value={Math.min(8000, scenario.rsvps)}
            onChange={(e) => setScenario((s) => ({ ...s, rsvps: Number(e.target.value) }))}
            className="mt-1 w-full accent-[#ee0000]"
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Starts {fmt(scenario.startMin)}
              </label>
              <input
                type="range"
                min={0}
                max={180}
                step={5}
                value={scenario.startMin}
                onChange={(e) => setScenario((s) => ({ ...s, startMin: Number(e.target.value) }))}
                className="mt-1 w-full accent-[#ee0000]"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Duration
              </label>
              <select
                value={scenario.durationMin}
                onChange={(e) => setScenario((s) => ({ ...s, durationMin: Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-[#ee0000]"
              >
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
                <option value={120}>120 min</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => {
              setSimMin(30)
              setReserves(0)
              setActive([])
            }}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-white"
          >
            Reset simulation
          </button>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Routes · {fmt(simMin)}
            </h2>
            <span className="rounded-full bg-slate-900/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              {activeCount} running
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {states.map(({ route, headway }) => {
              const scale = world.serviceScale[route.ref] ?? 1
              return (
                <li
                  key={route.ref}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                    headway === null ? 'opacity-40' : 'bg-slate-900/[0.02]'
                  }`}
                >
                  <span
                    className="flex h-4 w-8 shrink-0 items-center justify-center rounded text-[8px] font-black text-white"
                    style={{ backgroundColor: route.colour }}
                  >
                    {route.ref}
                  </span>
                  <span className="flex-1 truncate text-[10px] text-slate-600">
                    {route.stops.length} stops
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-500">
                    {headway === null ? 'not running' : `${Math.round(headway * scale)} min`}
                  </span>
                  {headway !== null && (
                    <span className="flex shrink-0 gap-0.5">
                      <button
                        onClick={() => bumpRoute(route.ref, 1)}
                        title="More buses on this route"
                        className="h-4 w-4 rounded bg-slate-900/[0.06] text-[10px] font-bold leading-none text-slate-600 hover:bg-[#ee0000]/15 hover:text-[#ee0000]"
                      >
                        +
                      </button>
                      <button
                        onClick={() => bumpRoute(route.ref, -1)}
                        title="Fewer buses on this route"
                        className="h-4 w-4 rounded bg-slate-900/[0.06] text-[10px] font-bold leading-none text-slate-600 hover:bg-[#ee0000]/15 hover:text-[#ee0000]"
                      >
                        −
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">IoT Sensors</h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              {nodes.length} online
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {nodes.map((n) => (
              <li key={n.key}>
                <button
                  onClick={() => toggleStop(n.key)}
                  title="Close or reopen this stop"
                  className={`w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-900/[0.04] ${
                    closedStops.includes(n.key) ? 'bg-red-50/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-[11px] font-medium ${
                        closedStops.includes(n.key) ? 'text-red-700 line-through' : 'text-slate-700'
                      }`}
                    >
                      {n.name}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-900">
                      {n.density}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${densityBar(n.density)}`}
                        style={{ width: `${n.density}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      {closedStops.includes(n.key) ? 'closed' : n.band}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Calibrate</h2>
            <span className="text-[10px] font-semibold text-slate-400">×{cal.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Count boardings at {venue.label} for one peak hour, then enter it here. The model currently
            implies {Math.round(modelledHour)}/h.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              inputMode="numeric"
              value={observed}
              onChange={(e) => setObserved(e.target.value)}
              placeholder="observed / hour"
              className="w-full rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-[11px] text-slate-700 outline-none"
            />
            <button
              onClick={applyCalibration}
              className="shrink-0 rounded-lg bg-slate-900/[0.06] px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-900/10"
            >
              Apply
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-200/70 pt-2">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
              day variance
              <input
                type="range"
                min={0}
                max={1}
                step={0.25}
                value={dayNoise}
                onChange={(e) => setDayNoise(Number(e.target.value))}
                className="w-20 accent-[#ee0000]"
              />
            </label>
            <button
              onClick={() => setSeed((v) => v + 1)}
              className="rounded-lg bg-slate-900/[0.06] px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-900/10"
            >
              New day (seed {seed})
            </button>
          </div>
        </section>
      </aside>

      <RouteLegend day={day} minute={minute} />

      <aside className="absolute right-5 top-24 z-20 w-[21rem] space-y-3">
        <section className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Crowd Model</h2>
            <span className="rounded-full bg-slate-900/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              modelled, not measured
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Predicted queue · {venue.label} · {venue.capacity.toLocaleString()} capacity
            {venue.capacitySrc === 'estimate'
              ? ' (est.)'
              : venue.capacitySrc === 'derived'
                ? ' (derived)'
                : ''}
          </p>

          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <ReferenceLine y={80} stroke={VERIZON_RED} strokeDasharray="4 4" strokeWidth={1} />
                <RLine type="monotone" dataKey="density" stroke={VERIZON_RED} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>
              peak {Math.round(peak.v)}% at {fmt(peak.min)}
            </span>
            <span>threshold 80%</span>
          </div>
        </section>

        <section className="rounded-2xl border border-[#ee0000]/30 bg-white/80 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-start gap-2">
            <span className="relative mt-1 flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ee0000] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ee0000]" />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                {Math.round(queued)} people waiting at {venue.label}
              </h3>
              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                Boarding takes {Math.round(BASE_DWELL + queued / BOARD_RATE)}s at this queue, so each bus sits
                longer and the one behind catches up. Peak {Math.round(peak.v)}% at {fmt(peak.min)}
                {needed > 0
                  ? ` — ${needed} extra bus${needed === 1 ? '' : 'es'} needed to clear the queue.`
                  : ' — current service clears it.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => setReserves((r) => r + 1)}
            className="mt-3 w-full rounded-xl bg-[#ee0000] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#cc0000] active:scale-[0.99]"
          >
            Spawn reserve bus (sim)
          </button>
          <p className="mt-2 text-center text-[10px] text-slate-500">Reserve fleet · {reserves} in sim</p>

          <div className="mt-2 flex items-center gap-2 border-t border-slate-200/70 pt-2">
            <button
              onClick={() => setBaseline(baseline ? null : world)}
              className="rounded-lg bg-slate-900/[0.06] px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-900/10"
            >
              {baseline ? 'Clear baseline' : 'Mark baseline'}
            </button>
            {queueDelta !== null && baseQueued !== null && baseNeeded !== null && (
              <span className="text-[10px] text-slate-600">
                vs baseline:{' '}
                <span
                  className={
                    queueDelta >= 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'
                  }
                >
                  {queueDelta >= 0 ? '+' : ''}
                  {queueDelta}% queue
                </span>{' '}
                · {needed - baseNeeded >= 0 ? '+' : ''}
                {needed - baseNeeded} buses
              </span>
            )}
          </div>
        </section>
      </aside>

      <div className="absolute bottom-5 left-1/2 z-30 w-[34rem] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 p-2 shadow-xl shadow-slate-900/10 backdrop-blur-xl">
          <span className="pl-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">prompt</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && prompt.trim()) applyPrompt()
            }}
            placeholder={`Describe a change — “${PROMPT_EXAMPLES}”`}
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            onClick={() => prompt.trim() && applyPrompt()}
            className="rounded-xl bg-[#ee0000] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#cc0000]"
          >
            Apply
          </button>
        </div>

        {lastCommand && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
            {lastCommand.notes.length > 0 ? (
              lastCommand.notes.map((n) => (
                <span
                  key={n}
                  className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-black/5"
                >
                  {n}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                nothing understood — try “{PROMPT_EXAMPLES}”
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
