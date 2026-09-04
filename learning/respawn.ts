import type { AgentState, PlatformState, Vector2D } from '../types';
import { AGENT_HEIGHT, AGENT_WIDTH, RESPAWN_MIN_AGENT_SEPARATION } from '../constants';

export interface RespawnBounds {
  minX: number;
  maxX: number;
}

export interface RespawnPlacement {
  platform: PlatformState;
  position: Vector2D;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function platformSafeInterval(platform: PlatformState): { minX: number; maxX: number } {
  // Keep respawns comfortably away from ledges while still allowing narrow platforms.
  const desiredInset = Math.min(52, Math.max(18, platform.width * 0.14));
  const maxInset = Math.max(0, (platform.width - AGENT_WIDTH) / 2);
  const inset = Math.min(desiredInset, maxInset);
  const minX = platform.position.x + inset;
  const maxX = platform.position.x + platform.width - AGENT_WIDTH - inset;
  return maxX >= minX
    ? { minX, maxX }
    : {
        minX: platform.position.x + Math.max(0, (platform.width - AGENT_WIDTH) / 2),
        maxX: platform.position.x + Math.max(0, (platform.width - AGENT_WIDTH) / 2),
      };
}

function intersectsBounds(platform: PlatformState, bounds?: RespawnBounds): boolean {
  if (!bounds) return true;
  return platform.position.x + platform.width >= bounds.minX && platform.position.x <= bounds.maxX;
}

function candidateXs(platform: PlatformState, desiredX: number): number[] {
  const { minX, maxX } = platformSafeInterval(platform);
  const clampedDesired = clamp(desiredX, minX, maxX);
  const values = new Set<number>([clampedDesired, minX, maxX]);
  const step = Math.max(20, AGENT_WIDTH * 0.5);
  for (let x = minX; x <= maxX + 0.001; x += step) values.add(Math.min(x, maxX));
  return [...values].sort((a, b) => a - b);
}

function minimumAgentDistance(x: number, y: number, others: AgentState[]): number {
  if (others.length === 0) return Infinity;
  const cx = x + AGENT_WIDTH / 2;
  const cy = y + AGENT_HEIGHT / 2;
  return Math.min(
    ...others.map(other =>
      Math.hypot(
        cx - (other.position.x + AGENT_WIDTH / 2),
        cy - (other.position.y + AGENT_HEIGHT / 2)
      )
    )
  );
}

function chooseSpawnX(platform: PlatformState, desiredX: number, others: AgentState[]): number {
  const y = platform.position.y - AGENT_HEIGHT;
  const xs = candidateXs(platform, desiredX);
  const clampedDesired = clamp(desiredX, xs[0], xs[xs.length - 1]);

  // First try positions at-or-behind the checkpoint so falling never becomes a free
  // forward teleport. Pick the closest collision-safe option to the real takeoff point.
  const nonForward = xs
    .filter(x => x <= clampedDesired + 0.001)
    .sort((a, b) => (clampedDesired - a) - (clampedDesired - b));
  for (const x of nonForward) {
    if (minimumAgentDistance(x, y, others) >= RESPAWN_MIN_AGENT_SEPARATION) return x;
  }

  // If another agent blocks that side, allow the smallest necessary displacement.
  const allByDisplacement = [...xs].sort((a, b) => {
    const aCost = Math.abs(a - clampedDesired) + Math.max(0, a - clampedDesired) * 0.5;
    const bCost = Math.abs(b - clampedDesired) + Math.max(0, b - clampedDesired) * 0.5;
    return aCost - bCost || a - b;
  });
  for (const x of allByDisplacement) {
    if (minimumAgentDistance(x, y, others) >= RESPAWN_MIN_AGENT_SEPARATION) return x;
  }

  // Very crowded/narrow platform: choose the least-overlapping deterministic point.
  return [...xs].sort((a, b) => {
    const da = minimumAgentDistance(a, y, others);
    const db = minimumAgentDistance(b, y, others);
    return db - da || Math.abs(a - clampedDesired) - Math.abs(b - clampedDesired) || a - b;
  })[0];
}

/**
 * Symmetric, deterministic respawn selection shared by visible and headless simulations.
 *
 * Rules:
 * 1. Prefer the platform the agent last safely stood on, but only if it is still usable
 *    inside the active camera frame.
 * 2. Otherwise choose the closest usable platform, preferring one that does not move the
 *    agent forward relative to its takeoff/checkpoint X.
 * 3. Spawn at the checkpoint X (clamped away from ledges), not platform center.
 * 4. Avoid spawning on top of another agent with the smallest possible displacement.
 */
export function chooseFairRespawn(
  agent: AgentState,
  platforms: PlatformState[],
  others: AgentState[],
  bounds?: RespawnBounds
): RespawnPlacement {
  if (platforms.length === 0) {
    return {
      platform: {
        id: agent.lastPlatformId ?? -1,
        position: { x: agent.position.x, y: agent.position.y + AGENT_HEIGHT },
        width: AGENT_WIDTH,
        height: 1,
      },
      position: { x: agent.position.x, y: agent.position.y },
    };
  }

  const checkpoint = agent.positionAtLastTakeoff || agent.position;
  const checkpointCenterX = checkpoint.x + AGENT_WIDTH / 2;
  const usable = platforms.filter(p => intersectsBounds(p, bounds));
  const pool = usable.length > 0 ? usable : platforms;

  let platform = pool.find(p => p.id === agent.lastPlatformId);
  if (!platform) {
    const nonForward = pool.filter(p => p.position.x + p.width / 2 <= checkpointCenterX + 0.001);
    const candidates = nonForward.length > 0 ? nonForward : pool;
    platform = [...candidates].sort((a, b) => {
      const ac = a.position.x + a.width / 2;
      const bc = b.position.x + b.width / 2;
      return Math.abs(ac - checkpointCenterX) - Math.abs(bc - checkpointCenterX) || a.id - b.id;
    })[0];
  }

  const x = chooseSpawnX(platform, checkpoint.x, others);
  return {
    platform,
    position: { x, y: platform.position.y - AGENT_HEIGHT },
  };
}
