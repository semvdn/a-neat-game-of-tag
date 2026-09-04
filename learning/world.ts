import type { PlatformState } from '../types';
import {
  MAX_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_Y,
  MIN_PLATFORM_GAP_X,
  PLATFORM_HEIGHT,
  PLATFORM_MAX_WIDTH,
  PLATFORM_MIN_WIDTH,
  WORLD_REF_HEIGHT,
} from '../constants';

export type RandomSource = () => number;

/**
 * Shared platform-generation rule used by both the visible infinite arena and headless training.
 * `difficulty=1` is the full game. Lower values keep the same generator family but bias toward
 * wider platforms, smaller gaps and gentler height changes for the early locomotion curriculum.
 */
export function createAdjacentPlatform(
  baseEdgeX: number,
  baseY: number,
  toLeft: boolean,
  id: number,
  rng: RandomSource,
  difficulty = 1,
): PlatformState {
  const d = Math.max(0, Math.min(1, difficulty));
  const easyMinGap = 35;
  const easyMaxGap = 95;
  const gapMin = easyMinGap + (MIN_PLATFORM_GAP_X - easyMinGap) * d;
  const gapMax = easyMaxGap + (MAX_PLATFORM_GAP_X - easyMaxGap) * d;
  let gapX = gapMin + rng() * Math.max(1, gapMax - gapMin);

  const heightScale = 0.35 + 0.65 * d;
  const gapY = (rng() - 0.5) * MAX_PLATFORM_GAP_Y * 1.5 * heightScale;
  const clampedY = Math.min(WORLD_REF_HEIGHT - 120, Math.max(250, baseY + gapY));
  const verticalDifference = clampedY - baseY;
  if (verticalDifference < -100) gapX = Math.max(gapMin, Math.min(gapX, 90));
  else if (verticalDifference > 80) gapX = Math.max(gapX, 140);

  const easyMinWidth = 280;
  const minWidth = easyMinWidth + (PLATFORM_MIN_WIDTH - easyMinWidth) * d;
  const width = minWidth + rng() * Math.max(1, PLATFORM_MAX_WIDTH - minWidth);
  return {
    id,
    width,
    height: PLATFORM_HEIGHT,
    position: {
      x: toLeft ? baseEdgeX - width - gapX : baseEdgeX + gapX,
      y: clampedY,
    },
  };
}
