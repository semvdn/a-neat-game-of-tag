import type { AgentState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_HEIGHT,
  AGENT_WIDTH,
  NEW_CHASER_TAG_DELAY_MS,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
  TAG_COOLDOWN,
} from '../constants';

type Point = readonly [number, number];
type RectSpec = readonly [number, number, number, number];

type SpriteFrameGeometry = {
  hood: readonly Point[];
  face: readonly Point[];
  cloak: readonly Point[];
  tail: readonly Point[];
  hi: readonly Point[];
  sh: readonly Point[];
  feet: readonly RectSpec[];
  eyes: readonly Point[];
};

type SpriteAnimation = 'idle' | 'run' | 'sprint' | 'jump' | 'fall' | 'tag';

type AgentVisualRuntime = {
  facing: -1 | 1;
  lastGrounded: boolean;
  landingStartedAt: number;
};

const SPRITE_W = 38;
const SPRITE_H = 42;
const PIXEL_TRANSPARENT = 0;
const PIXEL_MAIN = 1;
const PIXEL_LIGHT = 2;
const PIXEL_DARK = 3;
const PIXEL_INK = 5;
const PIXEL_EYE = 6;
const PIXEL_OUTLINE = 7;
const VISUAL_WIDTH = 56;
const VISUAL_SCALE = VISUAL_WIDTH / SPRITE_W;
const VISUAL_HEIGHT = SPRITE_H * VISUAL_SCALE;
const VISUAL_X = (AGENT_WIDTH - VISUAL_WIDTH) / 2;
const VISUAL_Y = AGENT_HEIGHT - VISUAL_HEIGHT;
const LANDING_HOLD_MS = 150;

const visualRuntime = new Map<number, AgentVisualRuntime>();

const frames: Record<SpriteAnimation, readonly SpriteFrameGeometry[]> = {
  idle: [
    {
      hood: [[12,5],[16,2],[23,2],[29,7],[30,13],[27,18],[20,20],[13,18],[10,13]],
      face: [[17,8],[26,8],[28,11],[26,15],[17,15],[14,12]],
      cloak: [[14,18],[26,18],[29,31],[27,36],[21,35],[17,38],[10,36],[9,27]],
      tail: [[10,22],[8,29],[4,35],[10,34],[15,30]],
      hi: [[13,8],[15,5],[17,4],[17,16],[15,22],[13,29]],
      sh: [[25,18],[28,24],[27,34],[22,35],[22,20]],
      feet: [[14,36,2,5],[24,35,2,5]], eyes: [[19,11],[24,11]],
    },
    {
      hood: [[12,6],[16,3],[23,3],[29,8],[29,14],[26,19],[19,20],[13,18],[10,13]],
      face: [[17,9],[26,9],[27,12],[25,16],[17,16],[14,13]],
      cloak: [[14,19],[26,19],[29,31],[26,37],[21,36],[17,39],[10,37],[9,28]],
      tail: [[10,23],[7,30],[5,35],[11,34],[15,30]],
      hi: [[13,9],[15,6],[17,5],[17,17],[15,23],[13,30]],
      sh: [[25,19],[28,25],[26,35],[22,36],[22,21]],
      feet: [[14,37,2,4],[24,36,2,5]], eyes: [[19,12],[24,12]],
    },
    {
      hood: [[11,5],[15,2],[22,2],[29,6],[30,12],[28,18],[21,20],[14,19],[10,14]],
      face: [[16,8],[25,8],[28,11],[26,15],[17,16],[14,12]],
      cloak: [[14,18],[26,19],[28,31],[26,36],[21,35],[16,38],[9,36],[9,27]],
      tail: [[9,22],[6,28],[4,34],[10,34],[15,29]],
      hi: [[12,8],[14,5],[16,4],[16,16],[14,22],[12,29]],
      sh: [[24,19],[27,24],[26,34],[21,35],[21,20]],
      feet: [[13,36,2,5],[24,35,2,5]], eyes: [[18,11],[23,11]],
    },
  ],
  run: [
    {
      hood: [[13,6],[17,3],[24,3],[30,8],[30,14],[27,18],[20,19],[14,17],[11,12]],
      face: [[18,9],[27,9],[28,12],[25,15],[18,15],[15,12]],
      cloak: [[15,18],[27,18],[30,29],[28,34],[23,34],[18,36],[10,34],[9,27]],
      tail: [[11,21],[6,26],[2,32],[8,33],[15,29]],
      hi: [[14,9],[16,6],[18,5],[18,16],[16,22],[14,28]],
      sh: [[26,19],[29,24],[28,32],[23,34],[22,20]],
      feet: [[12,34,2,5],[25,31,3,3]], eyes: [[20,12],[25,12]],
    },
    {
      hood: [[14,5],[18,2],[25,3],[31,8],[31,13],[28,17],[21,19],[15,18],[12,12]],
      face: [[19,8],[28,9],[29,12],[27,15],[19,15],[16,12]],
      cloak: [[16,18],[28,18],[31,27],[29,32],[24,34],[18,35],[11,32],[10,25]],
      tail: [[11,21],[5,24],[1,29],[7,31],[15,27]],
      hi: [[15,8],[17,5],[19,4],[19,15],[17,21],[15,26]],
      sh: [[27,18],[30,23],[29,30],[24,33],[23,20]],
      feet: [[15,33,2,4],[26,33,2,5]], eyes: [[21,11],[26,12]],
    },
    {
      hood: [[13,4],[17,1],[24,2],[30,6],[31,12],[28,17],[21,19],[14,18],[11,12]],
      face: [[18,7],[27,8],[29,11],[27,15],[18,15],[15,11]],
      cloak: [[15,18],[28,18],[30,27],[27,32],[22,34],[17,34],[10,31],[9,24]],
      tail: [[10,20],[4,22],[1,26],[7,28],[15,25]],
      hi: [[14,7],[16,4],[18,3],[18,15],[16,20],[14,25]],
      sh: [[26,18],[29,22],[28,30],[23,33],[22,19]],
      feet: [[16,32,2,4],[25,31,3,3]], eyes: [[20,10],[25,11]],
    },
    {
      hood: [[11,6],[15,3],[22,3],[28,7],[29,13],[27,18],[20,20],[13,19],[9,14]],
      face: [[16,9],[25,9],[27,12],[25,16],[17,16],[13,13]],
      cloak: [[13,19],[26,19],[29,30],[27,35],[22,35],[16,37],[8,35],[8,28]],
      tail: [[9,22],[6,27],[3,33],[9,32],[14,29]],
      hi: [[12,9],[14,6],[16,5],[16,17],[14,23],[12,29]],
      sh: [[24,19],[28,24],[27,33],[22,35],[21,20]],
      feet: [[11,32,3,3],[24,35,2,5]], eyes: [[18,12],[23,12]],
    },
    {
      hood: [[10,5],[14,2],[21,2],[28,6],[29,12],[27,17],[20,19],[13,18],[9,13]],
      face: [[15,8],[24,8],[27,11],[25,15],[16,15],[12,12]],
      cloak: [[13,18],[26,18],[29,28],[27,33],[22,35],[16,36],[8,33],[8,26]],
      tail: [[8,21],[5,25],[2,31],[8,30],[14,27]],
      hi: [[11,8],[13,5],[15,4],[15,15],[13,21],[11,27]],
      sh: [[24,18],[28,23],[27,31],[22,34],[21,19]],
      feet: [[10,34,2,5],[23,33,2,4]], eyes: [[17,11],[22,11]],
    },
    {
      hood: [[11,4],[15,1],[22,1],[29,5],[30,11],[28,16],[21,18],[14,17],[10,12]],
      face: [[16,7],[25,7],[28,10],[26,14],[17,14],[13,11]],
      cloak: [[14,17],[27,17],[30,26],[28,31],[23,33],[17,34],[9,31],[8,24]],
      tail: [[9,19],[4,22],[1,27],[7,28],[15,24]],
      hi: [[12,7],[14,4],[16,3],[16,14],[14,20],[12,25]],
      sh: [[25,17],[29,21],[28,29],[23,32],[22,18]],
      feet: [[13,32,2,4],[24,30,3,3]], eyes: [[18,10],[23,10]],
    },
  ],
  sprint: [
    {
      hood: [[15,7],[19,4],[26,4],[32,9],[32,14],[29,18],[22,19],[16,17],[13,12]],
      face: [[20,10],[29,10],[30,13],[28,16],[20,16],[17,13]],
      cloak: [[17,18],[29,18],[33,27],[31,32],[26,33],[20,35],[11,32],[10,25]],
      tail: [[11,21],[4,23],[0,28],[6,30],[16,26]],
      hi: [[16,10],[18,7],[20,6],[20,16],[18,22],[16,27]],
      sh: [[28,18],[32,23],[31,30],[26,32],[25,20]],
      feet: [[13,32,3,3],[28,29,3,3]], eyes: [[22,13],[27,13]],
    },
    {
      hood: [[16,5],[20,2],[27,3],[33,8],[33,13],[30,17],[23,19],[17,18],[14,12]],
      face: [[21,8],[30,9],[31,12],[29,15],[21,15],[18,12]],
      cloak: [[18,18],[30,18],[34,26],[32,30],[27,32],[21,34],[12,30],[11,24]],
      tail: [[12,20],[4,21],[0,25],[7,27],[17,24]],
      hi: [[17,8],[19,5],[21,4],[21,15],[19,21],[17,25]],
      sh: [[29,18],[33,22],[32,29],[27,31],[26,19]],
      feet: [[16,32,2,4],[29,31,2,4]], eyes: [[23,11],[28,12]],
    },
    {
      hood: [[16,4],[20,1],[27,2],[33,7],[34,12],[31,16],[24,18],[17,17],[14,11]],
      face: [[21,7],[30,8],[32,11],[30,14],[21,14],[18,11]],
      cloak: [[18,17],[31,17],[34,25],[31,29],[26,31],[20,33],[11,29],[10,23]],
      tail: [[11,19],[3,20],[0,23],[7,25],[17,22]],
      hi: [[17,7],[19,4],[21,3],[21,14],[19,20],[17,24]],
      sh: [[30,17],[33,21],[32,28],[27,30],[26,18]],
      feet: [[17,30,2,4],[28,29,3,3]], eyes: [[23,10],[28,11]],
    },
    {
      hood: [[14,7],[18,4],[25,4],[31,8],[32,14],[29,18],[22,20],[15,19],[12,13]],
      face: [[19,10],[28,10],[30,13],[28,16],[19,16],[16,13]],
      cloak: [[16,19],[29,19],[33,28],[30,33],[25,34],[19,36],[10,33],[9,26]],
      tail: [[10,22],[4,25],[0,30],[7,31],[16,28]],
      hi: [[15,10],[17,7],[19,6],[19,17],[17,23],[15,28]],
      sh: [[27,19],[32,24],[30,32],[25,33],[24,20]],
      feet: [[12,29,3,3],[27,34,2,5]], eyes: [[21,13],[26,13]],
    },
    {
      hood: [[15,5],[19,2],[26,3],[32,7],[33,13],[30,17],[23,19],[16,18],[13,12]],
      face: [[20,8],[29,9],[31,12],[29,15],[20,15],[17,12]],
      cloak: [[17,18],[30,18],[34,27],[31,31],[26,33],[20,35],[11,31],[10,24]],
      tail: [[11,20],[3,22],[0,26],[6,28],[17,25]],
      hi: [[16,8],[18,5],[20,4],[20,15],[18,21],[16,26]],
      sh: [[29,18],[33,23],[31,30],[26,32],[25,19]],
      feet: [[14,33,2,4],[29,31,2,4]], eyes: [[22,11],[27,12]],
    },
    {
      hood: [[15,4],[19,1],[26,2],[32,6],[33,12],[30,16],[23,18],[16,17],[13,11]],
      face: [[20,7],[29,8],[31,11],[29,14],[20,14],[17,11]],
      cloak: [[17,17],[30,17],[33,25],[31,29],[26,31],[20,33],[11,29],[10,23]],
      tail: [[11,19],[3,20],[0,24],[7,26],[17,23]],
      hi: [[16,7],[18,4],[20,3],[20,14],[18,20],[16,24]],
      sh: [[29,17],[32,21],[31,28],[26,30],[25,18]],
      feet: [[16,31,2,4],[28,28,3,3]], eyes: [[22,10],[27,11]],
    },
  ],
  jump: [
    {
      hood: [[11,8],[15,5],[23,5],[29,9],[30,15],[27,19],[20,21],[13,20],[9,15]],
      face: [[16,11],[26,11],[28,14],[26,17],[17,17],[13,14]],
      cloak: [[13,20],[27,20],[30,31],[27,36],[21,36],[16,38],[8,36],[8,29]],
      tail: [[9,24],[6,29],[4,35],[10,34],[14,31]],
      hi: [[12,11],[14,8],[16,7],[16,18],[14,24],[12,30]],
      sh: [[25,20],[29,25],[27,34],[22,36],[21,21]],
      feet: [[11,35,3,3],[24,35,3,3]], eyes: [[18,14],[23,14]],
    },
    {
      hood: [[13,4],[17,1],[24,1],[30,5],[31,11],[28,16],[21,18],[14,17],[10,12]],
      face: [[18,7],[27,7],[29,10],[27,14],[18,14],[15,11]],
      cloak: [[15,17],[28,17],[31,27],[29,31],[24,32],[18,34],[10,31],[9,24]],
      tail: [[10,20],[6,22],[3,27],[9,28],[15,24]],
      hi: [[14,7],[16,4],[18,3],[18,14],[16,20],[14,25]],
      sh: [[26,17],[30,22],[29,29],[24,31],[23,18]],
      feet: [[14,34,2,3],[25,34,2,3]], eyes: [[20,10],[25,10]],
    },
    {
      hood: [[14,2],[18,0],[25,0],[31,4],[32,10],[29,15],[22,17],[15,16],[11,10]],
      face: [[19,5],[28,5],[30,9],[28,13],[19,13],[16,9]],
      cloak: [[16,16],[29,16],[32,25],[29,29],[24,31],[18,32],[10,29],[9,22]],
      tail: [[10,18],[5,19],[2,23],[8,25],[16,22]],
      hi: [[15,5],[17,2],[19,2],[19,13],[17,19],[15,23]],
      sh: [[27,16],[31,20],[30,27],[25,30],[24,17]],
      feet: [[14,31,2,3],[26,31,2,3]], eyes: [[21,8],[26,8]],
    },
    {
      hood: [[13,3],[17,1],[24,1],[30,5],[31,11],[28,16],[21,18],[14,17],[10,11]],
      face: [[18,6],[27,6],[29,10],[27,14],[18,14],[15,10]],
      cloak: [[15,17],[28,17],[31,27],[29,31],[24,33],[18,34],[10,31],[9,24]],
      tail: [[10,20],[5,21],[2,26],[8,28],[15,24]],
      hi: [[14,6],[16,3],[18,3],[18,14],[16,20],[14,25]],
      sh: [[26,17],[30,22],[29,30],[24,32],[23,18]],
      feet: [[13,32,2,3],[26,32,2,3]], eyes: [[20,9],[25,9]],
    },
    {
      hood: [[12,6],[16,3],[23,3],[29,7],[30,13],[27,18],[20,20],[13,19],[9,14]],
      face: [[17,9],[26,9],[28,12],[26,16],[17,16],[14,13]],
      cloak: [[14,19],[27,19],[30,30],[27,35],[21,35],[16,38],[8,36],[8,28]],
      tail: [[9,23],[6,27],[3,33],[9,33],[14,30]],
      hi: [[13,9],[15,6],[17,5],[17,17],[15,23],[13,29]],
      sh: [[25,19],[29,24],[27,33],[22,35],[21,20]],
      feet: [[12,35,3,3],[24,35,3,3]], eyes: [[19,12],[24,12]],
    },
    {
      hood: [[10,9],[14,6],[22,6],[28,10],[29,16],[26,20],[19,22],[12,21],[8,16]],
      face: [[15,12],[25,12],[27,15],[25,18],[16,18],[12,15]],
      cloak: [[12,21],[26,21],[29,32],[27,37],[21,37],[15,39],[7,37],[7,30]],
      tail: [[8,25],[5,30],[3,36],[9,35],[13,32]],
      hi: [[11,12],[13,9],[15,8],[15,19],[13,25],[11,31]],
      sh: [[24,21],[28,26],[27,35],[22,37],[20,22]],
      feet: [[10,36,4,3],[24,36,4,3]], eyes: [[17,15],[22,15]],
    },
  ],
  fall: [
    {
      hood: [[13,3],[17,1],[24,2],[30,6],[31,12],[28,16],[21,18],[14,17],[10,11]],
      face: [[18,6],[27,7],[29,10],[27,14],[18,14],[15,10]],
      cloak: [[15,17],[28,17],[30,26],[28,31],[23,32],[17,33],[9,30],[9,23]],
      tail: [[9,20],[4,18],[1,22],[7,26],[15,24]],
      hi: [[14,6],[16,3],[18,3],[18,14],[16,20],[14,25]],
      sh: [[26,17],[29,21],[28,29],[23,31],[22,18]],
      feet: [[13,29,2,4],[25,30,2,4]], eyes: [[20,9],[25,10]],
    },
    {
      hood: [[15,4],[19,2],[26,4],[31,9],[30,15],[27,19],[20,20],[14,18],[11,12]],
      face: [[20,8],[28,10],[28,14],[25,17],[17,15],[16,11]],
      cloak: [[14,18],[27,19],[29,28],[26,33],[21,34],[15,33],[8,29],[9,22]],
      tail: [[9,20],[4,17],[1,19],[5,25],[14,26]],
      hi: [[15,7],[17,4],[19,4],[18,16],[15,21],[13,25]],
      sh: [[25,19],[28,23],[27,31],[22,33],[21,20]],
      feet: [[11,26,2,4],[25,29,2,4]], eyes: [[21,11],[25,12]],
    },
    {
      hood: [[12,6],[16,3],[23,3],[29,8],[29,14],[26,19],[19,20],[12,18],[9,13]],
      face: [[17,9],[26,9],[27,13],[24,16],[16,15],[13,12]],
      cloak: [[12,18],[25,19],[28,29],[26,34],[20,35],[14,33],[7,29],[8,22]],
      tail: [[8,21],[4,16],[1,17],[4,24],[12,27]],
      hi: [[13,9],[15,6],[17,5],[16,17],[13,22],[11,26]],
      sh: [[23,19],[27,24],[26,32],[21,34],[20,20]],
      feet: [[10,25,2,4],[23,27,2,4]], eyes: [[19,12],[23,12]],
    },
    {
      hood: [[10,5],[14,2],[21,2],[28,6],[29,12],[27,17],[20,19],[13,18],[9,13]],
      face: [[15,8],[24,8],[27,11],[25,15],[16,15],[12,12]],
      cloak: [[13,18],[26,18],[29,28],[27,33],[22,35],[16,36],[8,33],[8,26]],
      tail: [[8,21],[3,18],[0,20],[4,26],[13,29]],
      hi: [[11,8],[13,5],[15,4],[15,15],[13,21],[11,27]],
      sh: [[24,18],[28,23],[27,31],[22,34],[21,19]],
      feet: [[10,27,2,4],[22,25,2,4]], eyes: [[17,11],[22,11]],
    },
  ],
  tag: [
    {
      hood: [[12,5],[16,2],[23,2],[29,7],[30,13],[27,18],[20,20],[13,18],[10,13]],
      face: [[17,8],[26,8],[28,11],[26,15],[17,15],[14,12]],
      cloak: [[14,18],[26,18],[29,31],[27,36],[21,35],[17,38],[10,36],[9,27]],
      tail: [[10,22],[8,29],[4,35],[10,34],[15,30]],
      hi: [[13,8],[15,5],[17,4],[17,16],[15,22],[13,29]],
      sh: [[25,18],[28,24],[27,34],[22,35],[22,20]],
      feet: [[14,36,2,5],[24,35,2,5]], eyes: [[19,11],[24,11]],
    },
    {
      hood: [[8,8],[12,5],[20,5],[26,9],[27,15],[24,20],[17,22],[10,20],[6,15]],
      face: [[13,11],[22,11],[24,14],[22,18],[13,18],[10,15]],
      cloak: [[10,20],[24,20],[28,31],[25,36],[19,35],[13,38],[5,34],[6,27]],
      tail: [[6,23],[3,28],[1,34],[7,33],[11,30]],
      hi: [[9,11],[11,8],[13,7],[13,18],[11,24],[9,29]],
      sh: [[22,20],[27,25],[25,34],[20,35],[19,21]],
      feet: [[7,34,3,3],[23,35,3,3]], eyes: [[15,14],[20,14]],
    },
    {
      hood: [[15,3],[19,1],[26,2],[32,7],[33,13],[30,17],[23,19],[16,17],[13,11]],
      face: [[20,6],[29,7],[31,10],[29,14],[20,14],[17,10]],
      cloak: [[17,17],[30,17],[34,27],[31,31],[26,33],[20,35],[11,31],[10,24]],
      tail: [[11,20],[4,21],[0,26],[7,28],[17,25]],
      hi: [[16,7],[18,4],[20,3],[20,14],[18,20],[16,25]],
      sh: [[29,17],[33,22],[31,30],[26,32],[25,18]],
      feet: [[17,33,2,4],[29,31,2,4]], eyes: [[22,9],[27,10]],
    },
    {
      hood: [[10,6],[14,3],[21,3],[28,7],[29,13],[27,18],[20,20],[13,19],[9,14]],
      face: [[15,9],[24,9],[27,12],[25,16],[16,16],[12,13]],
      cloak: [[13,19],[26,19],[29,30],[27,35],[22,35],[16,37],[8,35],[8,28]],
      tail: [[9,22],[5,27],[2,33],[8,32],[14,29]],
      hi: [[11,9],[13,6],[15,5],[15,17],[13,23],[11,29]],
      sh: [[24,19],[28,24],[27,33],[22,35],[21,20]],
      feet: [[10,35,2,5],[24,34,2,5]], eyes: [[17,12],[22,12]],
    },
    {
      hood: [[12,5],[16,2],[23,2],[29,7],[30,13],[27,18],[20,20],[13,18],[10,13]],
      face: [[17,8],[26,8],[28,11],[26,15],[17,15],[14,12]],
      cloak: [[14,18],[26,18],[29,31],[27,36],[21,35],[17,38],[10,36],[9,27]],
      tail: [[10,22],[8,29],[4,35],[10,34],[15,30]],
      hi: [[13,8],[15,5],[17,4],[17,16],[15,22],[13,29]],
      sh: [[25,18],[28,24],[27,34],[22,35],[22,20]],
      feet: [[14,36,2,5],[24,35,2,5]], eyes: [[19,11],[24,11]],
    },
  ],
};

const pixelBuffer = () => new Uint8Array(SPRITE_W * SPRITE_H);
const indexOf = (x: number, y: number) => y * SPRITE_W + x;

const putPixel = (buffer: Uint8Array, x: number, y: number, value: number) => {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= SPRITE_W || py < 0 || py >= SPRITE_H) return;
  buffer[indexOf(px, py)] = value;
};

const fillRect = (buffer: Uint8Array, rectSpec: RectSpec, value: number) => {
  const [x, y, w, h] = rectSpec;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) putPixel(buffer, px, py, value);
  }
};

const fillPolygon = (buffer: Uint8Array, points: readonly Point[], value: number) => {
  if (points.length < 3) return;
  const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
  const maxY = Math.min(SPRITE_H - 1, Math.ceil(Math.max(...points.map(point => point[1]))));
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        intersections.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x++) {
        putPixel(buffer, x, y, value);
      }
    }
  }
};

const rasterizeFrame = (frame: SpriteFrameGeometry) => {
  const clothMask = pixelBuffer();
  fillPolygon(clothMask, frame.tail, PIXEL_MAIN);
  fillPolygon(clothMask, frame.cloak, PIXEL_MAIN);
  fillPolygon(clothMask, frame.hood, PIXEL_MAIN);

  const output = pixelBuffer();
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      if (!clothMask[indexOf(x, y)]) continue;
      output[indexOf(x, y)] = PIXEL_MAIN;
      const neighbors = [[1,0],[-1,0],[0,1],[0,-1]] as const;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= SPRITE_W || ny < 0 || ny >= SPRITE_H || !clothMask[indexOf(nx, ny)]) {
          putPixel(output, nx, ny, PIXEL_OUTLINE);
        }
      }
    }
  }

  fillPolygon(output, frame.hi, PIXEL_LIGHT);
  fillPolygon(output, frame.sh, PIXEL_DARK);
  fillPolygon(output, frame.face, PIXEL_INK);
  frame.feet.forEach(foot => fillRect(output, foot, PIXEL_INK));
  frame.eyes.forEach(([x, y]) => fillRect(output, [x, y, 1, 2], PIXEL_EYE));
  return output;
};

const rasterFrames: Record<SpriteAnimation, readonly Uint8Array[]> = {
  idle: frames.idle.map(rasterizeFrame),
  run: frames.run.map(rasterizeFrame),
  sprint: frames.sprint.map(rasterizeFrame),
  jump: frames.jump.map(rasterizeFrame),
  fall: frames.fall.map(rasterizeFrame),
  tag: frames.tag.map(rasterizeFrame),
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
};

const mixRgb = (rgb: { r: number; g: number; b: number }, target: number, amount: number) => {
  const blend = (value: number) => Math.round(value + (target - value) * amount);
  return `rgb(${blend(rgb.r)}, ${blend(rgb.g)}, ${blend(rgb.b)})`;
};

const paletteFor = (agent: AgentState) => {
  const rgb = hexToRgb(agent.color);
  return {
    main: agent.color,
    light: mixRgb(rgb, 255, 0.24),
    dark: mixRgb(rgb, 0, 0.42),
    ink: '#0b1017',
    eye: '#f5f4e8',
  };
};

const getVisualRuntime = (agent: AgentState, nowMs: number) => {
  let runtime = visualRuntime.get(agent.id);
  if (!runtime) {
    runtime = {
      facing: agent.velocity.x < -0.15 ? -1 : 1,
      lastGrounded: agent.isOnGround,
      landingStartedAt: -Infinity,
    };
    visualRuntime.set(agent.id, runtime);
  }
  if (Math.abs(agent.velocity.x) > 0.18) runtime.facing = agent.velocity.x < 0 ? -1 : 1;
  if (agent.isOnGround && !runtime.lastGrounded) runtime.landingStartedAt = nowMs;
  runtime.lastGrounded = agent.isOnGround;
  return runtime;
};

const isRecentTagTransition = (agent: AgentState) => {
  if (agent.status === AgentStatus.Cooldown && agent.cooldownTimer > TAG_COOLDOWN - 560) return true;
  if (agent.status === AgentStatus.It && agent.cooldownTimer > 0 && agent.cooldownTimer <= NEW_CHASER_TAG_DELAY_MS) return true;
  return false;
};

const pickAnimation = (agent: AgentState, runtime: AgentVisualRuntime, nowMs: number): SpriteAnimation => {
  if (isRecentTagTransition(agent)) return 'tag';
  if (!agent.isOnGround) return agent.velocity.y < 1.25 ? 'jump' : 'fall';
  if (nowMs - runtime.landingStartedAt < LANDING_HOLD_MS) return 'jump';
  if ((agent.sprintIntensity || 0) >= POLICY_CONTROL_ACTIVE_THRESHOLD && Math.abs(agent.velocity.x) > 0.8) return 'sprint';
  if (Math.abs(agent.velocity.x) > 0.35) return 'run';
  return 'idle';
};

const pickJumpFrame = (agent: AgentState, runtime: AgentVisualRuntime, nowMs: number) => {
  if (agent.isOnGround && nowMs - runtime.landingStartedAt < LANDING_HOLD_MS) return 5;
  const vy = agent.velocity.y;
  if (vy < -8) return 1;
  if (vy < -3) return 2;
  if (vy < 1.25) return 3;
  if (vy < 6) return 4;
  return 5;
};

const pickTagFrame = (agent: AgentState, nowMs: number) => {
  if (agent.status === AgentStatus.Cooldown) {
    const age = Math.max(0, TAG_COOLDOWN - agent.cooldownTimer);
    return Math.min(rasterFrames.tag.length - 1, Math.floor(age / 95));
  }
  const age = Math.max(0, NEW_CHASER_TAG_DELAY_MS - agent.cooldownTimer);
  return Math.min(rasterFrames.tag.length - 1, Math.floor(age / 95));
};

const pickFrame = (
  animation: SpriteAnimation,
  agent: AgentState,
  runtime: AgentVisualRuntime,
  nowMs: number,
) => {
  if (animation === 'jump') return pickJumpFrame(agent, runtime, nowMs);
  if (animation === 'tag') return pickTagFrame(agent, nowMs);
  const speed = Math.abs(agent.velocity.x);
  const duration = animation === 'sprint'
    ? Math.max(58, 88 - speed * 3)
    : animation === 'run'
      ? Math.max(82, 135 - speed * 5)
      : animation === 'fall'
        ? 145
        : 280;
  return Math.floor(nowMs / duration) % rasterFrames[animation].length;
};

const drawRaster = (
  ctx: CanvasRenderingContext2D,
  raster: Uint8Array,
  palette: ReturnType<typeof paletteFor>,
  alpha = 1,
) => {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const colors: Record<number, string> = {
    [PIXEL_MAIN]: palette.main,
    [PIXEL_LIGHT]: palette.light,
    [PIXEL_DARK]: palette.dark,
    [PIXEL_INK]: palette.ink,
    [PIXEL_EYE]: palette.eye,
    [PIXEL_OUTLINE]: palette.ink,
  };
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const value = raster[indexOf(x, y)];
      if (value === PIXEL_TRANSPARENT) continue;
      ctx.fillStyle = colors[value] || palette.main;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
};

const drawSprintEffects = (
  ctx: CanvasRenderingContext2D,
  raster: Uint8Array,
  palette: ReturnType<typeof paletteFor>,
  intensity: number,
) => {
  const strength = Math.max(0, Math.min(1, intensity));
  if (strength <= 0.1) return;
  ctx.save();
  ctx.globalAlpha *= 0.16 * strength;
  for (let i = 3; i >= 1; i--) {
    ctx.save();
    ctx.translate(-i * 3.2, i * 0.2);
    drawRaster(ctx, raster, palette, 0.42 / i);
    ctx.restore();
  }
  ctx.fillStyle = palette.main;
  for (let i = 0; i < 3; i++) {
    const length = 7 + i * 3;
    const x = -6 - i * 5;
    const y = 18 + i * 5;
    ctx.fillRect(x, y, length, 1);
  }
  ctx.restore();
};

const drawFallEffects = (
  ctx: CanvasRenderingContext2D,
  palette: ReturnType<typeof paletteFor>,
  velocityY: number,
) => {
  const strength = Math.max(0, Math.min(1, (velocityY - 2) / 12));
  if (strength <= 0) return;
  ctx.save();
  ctx.globalAlpha *= 0.20 * strength;
  ctx.fillStyle = palette.light;
  const streaks = [[5,-7,8],[12,-11,5],[27,-8,10],[33,-4,6]] as const;
  streaks.forEach(([x, y, h]) => ctx.fillRect(x, y, 1, h));
  ctx.restore();
};

export const drawPixelAgent = (
  ctx: CanvasRenderingContext2D,
  agent: AgentState,
  nowMs: number,
) => {
  const runtime = getVisualRuntime(agent, nowMs);
  const animation = pickAnimation(agent, runtime, nowMs);
  const frameIndex = pickFrame(animation, agent, runtime, nowMs);
  const raster = rasterFrames[animation][frameIndex] || rasterFrames.idle[0];
  const palette = paletteFor(agent);
  const isBlinking = agent.cooldownTimer > 0 && Math.floor(agent.cooldownTimer / 100) % 2 === 0;

  ctx.save();
  ctx.translate(agent.position.x, agent.position.y);
  ctx.globalAlpha = isBlinking ? 0.62 : 1;

  // The animation is presentation-only. Its bottom is pinned to the physical collision body's
  // bottom edge so the tiny black feet remain the first pixels to touch a platform.
  ctx.translate(VISUAL_X, VISUAL_Y);
  ctx.scale(VISUAL_SCALE, VISUAL_SCALE);
  if (runtime.facing < 0) {
    ctx.translate(SPRITE_W, 0);
    ctx.scale(-1, 1);
  }

  if (animation === 'sprint') {
    drawSprintEffects(ctx, raster, palette, agent.sprintIntensity || 0);
  } else if (animation === 'fall') {
    drawFallEffects(ctx, palette, agent.velocity.y);
  }

  drawRaster(ctx, raster, palette);
  ctx.restore();
};
