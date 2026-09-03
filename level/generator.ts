import {
  PLATFORM_HEIGHT,
  PLATFORM_MAX_WIDTH,
  PLATFORM_MIN_WIDTH,
} from '../constants';
import type { CourseEdge, CourseGraph, PlatformState, PlatformKind } from '../types';
import { BRANCH_UNLOCK_DIFFICULTY, CRUMBLING_UNLOCK_DIFFICULTY, MOVING_UNLOCK_DIFFICULTY } from './curriculum';
import { canTraverseForward, maxSafeForwardGap, type ReachabilityOptions } from './reachability';
import { mulberry32, randomInt, randomRange, type RandomSource } from './random';

export interface CourseGenerationOptions {
  seed: number;
  difficulty: number;
  viewport: { width: number; height: number };
  length?: number;
  mirrored?: boolean;
}

export interface GeneratedCourse {
  graph: CourseGraph;
  platforms: PlatformState[];
  flowDirection: 1 | -1;
  startXs: number[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const ramp = (difficulty: number, start: number, end: number, max: number) => {
  if (difficulty <= start) return 0;
  return clamp01((difficulty - start) / Math.max(1e-6, end - start)) * max;
};

function reachabilityFor(difficulty: number): ReachabilityOptions {
  return {
    safetyRatio: 0.68 + difficulty * 0.22,
    jumpPowerRatio: 0.92,
    speedRatio: 0.88,
    landingMargin: 14,
  };
}

function createModifier(
  rng: RandomSource,
  difficulty: number,
  routeRole: 'backbone' | 'branch',
): Pick<PlatformState, 'kind' | 'motion' | 'crumble' | 'crumblePhase' | 'active'> {
  const movingChance = ramp(difficulty, MOVING_UNLOCK_DIFFICULTY, 0.85, routeRole === 'branch' ? 0.40 : 0.25);
  // Phase 1 keeps the guaranteed backbone permanently present. Crumbling is a branch/shortcut
  // mechanic, so disappearing terrain can create tactics without deleting the only valid route.
  const crumbleChance = routeRole === 'branch'
    ? ramp(difficulty, CRUMBLING_UNLOCK_DIFFICULTY, 0.95, 0.34)
    : 0;
  const roll = rng();

  if (roll < crumbleChance) {
    return {
      kind: 'crumbling',
      active: true,
      crumblePhase: 'stable',
      crumble: {
        disappearDelayMs: randomRange(rng, 850, 1450 - difficulty * 300),
        respawnDelayMs: randomRange(rng, 2200, 3400),
      },
    };
  }

  if (roll < crumbleChance + movingChance) {
    const axis: 'x' | 'y' = rng() < 0.58 ? 'x' : 'y';
    return {
      kind: 'moving',
      active: true,
      motion: {
        axis,
        amplitude: axis === 'x'
          ? randomRange(rng, 16, 28 + difficulty * 52)
          : randomRange(rng, 12, 24 + difficulty * 42),
        speed: randomRange(rng, 0.12, 0.22 + difficulty * 0.30),
        phase: randomRange(rng, 0, Math.PI * 2),
      },
    };
  }

  return { kind: 'static', active: true };
}

function makePlatform(
  id: number,
  x: number,
  y: number,
  width: number,
  routeRole: 'start' | 'backbone' | 'branch',
  routeId: string,
  modifier: Pick<PlatformState, 'kind' | 'motion' | 'crumble' | 'crumblePhase' | 'active'> = { kind: 'static', active: true },
): PlatformState {
  return {
    id,
    position: { x, y },
    basePosition: { x, y },
    width,
    height: PLATFORM_HEIGHT,
    routeRole,
    routeId,
    ...modifier,
  };
}

function widthFor(rng: RandomSource, difficulty: number, branch = false): number {
  const minWidth = branch
    ? Math.max(130, PLATFORM_MIN_WIDTH - 35 - difficulty * 20)
    : Math.max(150, PLATFORM_MIN_WIDTH - difficulty * 20);
  const maxWidth = branch
    ? Math.max(minWidth + 40, PLATFORM_MAX_WIDTH - 100 - difficulty * 45)
    : Math.max(minWidth + 60, PLATFORM_MAX_WIDTH - difficulty * 70);
  return randomRange(rng, minWidth, maxWidth);
}

function generateNextBackbone(
  rng: RandomSource,
  id: number,
  previous: PlatformState,
  difficulty: number,
  viewportHeight: number,
): PlatformState {
  const reachability = reachabilityFor(difficulty);
  const minY = 220;
  const maxY = viewportHeight - 115;

  for (let attempt = 0; attempt < 24; attempt++) {
    const verticalRange = 55 + difficulty * 105;
    const targetY = Math.max(minY, Math.min(maxY, (previous.basePosition?.y ?? previous.position.y) + randomRange(rng, -verticalRange, verticalRange)));
    const modifier = createModifier(rng, difficulty, 'backbone');
    const motionX = modifier.motion?.axis === 'x' ? modifier.motion.amplitude : 0;
    const motionY = modifier.motion?.axis === 'y' ? modifier.motion.amplitude : 0;
    const maxReachableGap = maxSafeForwardGap(previous, targetY, motionX, motionY, reachability);
    const desiredMaxGap = 95 + difficulty * 135;
    const maxGap = Math.min(maxReachableGap, desiredMaxGap);
    const minGap = 34 + difficulty * 30;
    if (maxGap < minGap) continue;

    const gapBias = Math.pow(rng(), 0.85 + difficulty * 0.8);
    const gap = minGap + (maxGap - minGap) * gapBias;
    const width = widthFor(rng, difficulty);
    const x = (previous.basePosition?.x ?? previous.position.x) + previous.width + gap;
    const candidate = makePlatform(id, x, targetY, width, 'backbone', 'backbone', modifier);
    if (canTraverseForward(previous, candidate, reachability)) return candidate;
  }

  // Guaranteed conservative fallback.
  const y = previous.basePosition?.y ?? previous.position.y;
  const x = (previous.basePosition?.x ?? previous.position.x) + previous.width + 55;
  return makePlatform(id, x, y, widthFor(rng, Math.min(difficulty, 0.4)), 'backbone', 'backbone');
}

function buildBranch(
  rng: RandomSource,
  anchor: PlatformState,
  rejoin: PlatformState,
  nextId: () => number,
  branchIndex: number,
  difficulty: number,
  viewportHeight: number,
): { nodes: PlatformState[]; edges: CourseEdge[] } | null {
  const reachability = reachabilityFor(difficulty);
  const anchorX = (anchor.basePosition?.x ?? anchor.position.x) + anchor.width;
  const rejoinX = rejoin.basePosition?.x ?? rejoin.position.x;
  const span = rejoinX - anchorX;
  if (span < 360) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const count = Math.max(2, Math.min(5, Math.ceil(span / randomRange(rng, 210, 285))));
    const sign = rng() < 0.58 ? -1 : 1;
    const offset = sign * randomRange(rng, 70, 105 + difficulty * 115) * (1 - attempt * 0.07);
    const routeId = `branch_${branchIndex}`;
    const nodes: PlatformState[] = [];

    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const width = widthFor(rng, difficulty, true);
      const centerX = anchorX + span * t;
      const baseY = (anchor.basePosition?.y ?? anchor.position.y) * (1 - t) + (rejoin.basePosition?.y ?? rejoin.position.y) * t;
      const y = Math.max(210, Math.min(viewportHeight - 115, baseY + Math.sin(Math.PI * t) * offset));
      const modifier = createModifier(rng, Math.min(1, difficulty + 0.10), 'branch');
      nodes.push(makePlatform(nextId(), centerX - width / 2, y, width, 'branch', routeId, modifier));
    }

    const path = [anchor, ...nodes, rejoin];
    if (path.slice(0, -1).every((node, index) => canTraverseForward(node, path[index + 1], reachability))) {
      const edges: CourseEdge[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        edges.push({ from: path[i].id, to: path[i + 1].id, routeId, kind: 'branch' });
      }
      return { nodes, edges };
    }
  }

  return null;
}

function mirrorPlatform(platform: PlatformState, axisX: number): PlatformState {
  const base = platform.basePosition ?? platform.position;
  const mirroredBaseX = axisX - (base.x + platform.width);
  const mirroredPositionX = axisX - (platform.position.x + platform.width);
  const motion = platform.motion
    ? {
        ...platform.motion,
        // sin(phase + PI) mirrors horizontal displacement exactly.
        phase: platform.motion.axis === 'x' ? platform.motion.phase + Math.PI : platform.motion.phase,
      }
    : undefined;
  return {
    ...platform,
    position: { ...platform.position, x: mirroredPositionX },
    basePosition: { ...base, x: mirroredBaseX },
    motion,
    crumble: platform.crumble ? { ...platform.crumble, triggeredAt: undefined } : undefined,
    crumblePhase: platform.kind === 'crumbling' ? 'stable' : platform.crumblePhase,
    active: true,
  };
}

export function generateCourse(options: CourseGenerationOptions): GeneratedCourse {
  const difficulty = clamp01(options.difficulty);
  const rng = mulberry32(options.seed);
  const mirrored = options.mirrored ?? ((options.seed & 1) === 1);
  const flowDirection: 1 | -1 = mirrored ? -1 : 1;
  const length = options.length ?? 7600;
  const baseY = options.viewport.height - 100;

  let idCounter = 0;
  const nextId = () => idCounter++;
  const startWidth = Math.max(options.viewport.width + 520, 1500);
  const start = makePlatform(nextId(), -260, baseY, startWidth, 'start', 'backbone');
  const backbone: PlatformState[] = [start];
  const edges: CourseEdge[] = [];

  while ((backbone[backbone.length - 1].basePosition?.x ?? backbone[backbone.length - 1].position.x) + backbone[backbone.length - 1].width < length) {
    const previous = backbone[backbone.length - 1];
    const next = generateNextBackbone(rng, nextId(), previous, difficulty, options.viewport.height);
    backbone.push(next);
    edges.push({ from: previous.id, to: next.id, routeId: 'backbone', kind: 'backbone' });
  }

  const branchNodes: PlatformState[] = [];
  const branchChance = ramp(difficulty, BRANCH_UNLOCK_DIFFICULTY, 0.75, 0.48);
  let branchIndex = 0;
  let lastRejoinIndex = 0;
  if (difficulty >= BRANCH_UNLOCK_DIFFICULTY) {
    for (let i = 2; i < backbone.length - 4; i++) {
      if (i < lastRejoinIndex + 2 || rng() > branchChance) continue;
      const rejoinOffset = randomInt(rng, 3, Math.min(5, backbone.length - i - 1));
      const rejoinIndex = i + rejoinOffset;
      const branch = buildBranch(rng, backbone[i], backbone[rejoinIndex], nextId, branchIndex, difficulty, options.viewport.height);
      if (!branch) continue;
      branchNodes.push(...branch.nodes);
      edges.push(...branch.edges);
      branchIndex++;
      lastRejoinIndex = rejoinIndex;
    }
  }

  let platforms = [...backbone, ...branchNodes];
  const graph: CourseGraph = {
    seed: options.seed >>> 0,
    difficulty,
    edges,
    branchCount: branchIndex,
  };

  // Starting spread/translation is seeded too, preserving fair comparisons within a round.
  const spread = 0.88 + rng() * 0.24;
  const shift = (rng() - 0.5) * 90;
  let startXs = [120 + shift, 120 + 400 * spread + shift, 120 + 670 * spread + shift];

  if (mirrored) {
    const axisX = options.viewport.width;
    platforms = platforms.map(platform => mirrorPlatform(platform, axisX));
    startXs = startXs.map(x => axisX - x - 40);
  }

  return { graph, platforms, flowDirection, startXs };
}

export function countCourseFeatures(platforms: PlatformState[]) {
  return platforms.reduce(
    (counts, platform) => {
      if (platform.routeRole === 'branch') counts.branchPlatforms++;
      if (platform.kind === 'moving') counts.moving++;
      if (platform.kind === 'crumbling') counts.crumbling++;
      return counts;
    },
    { branchPlatforms: 0, moving: 0, crumbling: 0 },
  );
}
