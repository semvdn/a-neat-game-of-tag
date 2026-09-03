import { GRAVITY, JUMP_STRENGTH, MAX_SPEED } from '../constants';
import type { PlatformState } from '../types';

const EPS = 1e-6;

export interface ReachabilityOptions {
  /** Fraction of the theoretical flight range we permit the generator to use. */
  safetyRatio: number;
  /** Conservatively assume less than perfect jump output. */
  jumpPowerRatio?: number;
  /** Conservatively assume the agent is not already at exact peak horizontal speed. */
  speedRatio?: number;
  /** Extra landing margin in pixels. */
  landingMargin?: number;
}

export function jumpFlightFrames(
  deltaY: number,
  jumpPowerRatio = 0.92,
): number | null {
  const initialVy = JUMP_STRENGTH * jumpPowerRatio;
  // deltaY = v0*t + 0.5*g*t^2. We want the later (descending) positive root.
  const discriminant = initialVy * initialVy + 2 * GRAVITY * deltaY;
  if (discriminant < 0) return null;
  const t = (-initialVy + Math.sqrt(discriminant)) / Math.max(EPS, GRAVITY);
  return t > 0 ? t : null;
}

export function maxHorizontalJumpDistance(
  deltaY: number,
  options: ReachabilityOptions,
): number {
  const frames = jumpFlightFrames(deltaY, options.jumpPowerRatio ?? 0.92);
  if (frames === null) return 0;
  return frames * MAX_SPEED * (options.speedRatio ?? 0.88) * options.safetyRatio;
}

function motionAmplitude(platform: PlatformState, axis: 'x' | 'y'): number {
  if (platform.kind !== 'moving' || !platform.motion || platform.motion.axis !== axis) return 0;
  return Math.max(0, platform.motion.amplitude);
}

/**
 * Conservative +X reachability test. It evaluates the worst relative phase of movers:
 * source furthest left/down and target furthest right/up. If this passes, the jump is
 * available throughout the complete movement cycle rather than only at a lucky instant.
 */
export function canTraverseForward(
  from: PlatformState,
  to: PlatformState,
  options: ReachabilityOptions,
): boolean {
  const sourceX = from.basePosition?.x ?? from.position.x;
  const sourceY = from.basePosition?.y ?? from.position.y;
  const targetX = to.basePosition?.x ?? to.position.x;
  const targetY = to.basePosition?.y ?? to.position.y;

  const worstSourceRight = sourceX - motionAmplitude(from, 'x') + from.width;
  const worstTargetLeft = targetX + motionAmplitude(to, 'x');
  const worstGap = Math.max(0, worstTargetLeft - worstSourceRight);

  // Smaller y is higher. Worst upward demand is source at its lowest and target at its highest.
  const worstSourceTop = sourceY + motionAmplitude(from, 'y');
  const worstTargetTop = targetY - motionAmplitude(to, 'y');
  const worstDeltaY = worstTargetTop - worstSourceTop;

  const maxDistance = maxHorizontalJumpDistance(worstDeltaY, options);
  const landingMargin = options.landingMargin ?? 12;
  return worstGap + landingMargin <= maxDistance;
}

export function maxSafeForwardGap(
  from: PlatformState,
  targetY: number,
  targetMotionX: number,
  targetMotionY: number,
  options: ReachabilityOptions,
): number {
  const sourceY = from.basePosition?.y ?? from.position.y;
  const worstSourceTop = sourceY + motionAmplitude(from, 'y');
  const worstTargetTop = targetY - targetMotionY;
  const deltaY = worstTargetTop - worstSourceTop;
  const range = maxHorizontalJumpDistance(deltaY, options);
  const motionPenalty = motionAmplitude(from, 'x') + Math.max(0, targetMotionX);
  return Math.max(0, range - motionPenalty - (options.landingMargin ?? 12));
}
