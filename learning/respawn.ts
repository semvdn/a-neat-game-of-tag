import type { AgentState, PlatformState, Vector2D } from '../types';
import { AGENT_HEIGHT, AGENT_WIDTH } from '../constants';

// Respawning is a recovery from a mistake, not a source of positional advantage.
// The policy therefore restores the agent to its most recent grounded checkpoint,
// keeps that checkpoint platform preferred, and only shifts horizontally when needed
// to avoid spawning directly on top of another agent.
const EDGE_MARGIN = 10;
const CONTACT_CLEARANCE = (AGENT_WIDTH + AGENT_HEIGHT) / 2 + 8;

export interface FairRespawnResult {
  position: Vector2D;
  platformId: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function platformDistanceToX(platform: PlatformState, x: number): number {
  if (x < platform.position.x) return platform.position.x - x;
  if (x > platform.position.x + platform.width) return x - (platform.position.x + platform.width);
  return 0;
}

function candidateIsClear(
  x: number,
  y: number,
  agentId: number,
  otherAgents: AgentState[]
): boolean {
  const cx = x + AGENT_WIDTH / 2;
  const cy = y + AGENT_HEIGHT / 2;
  return otherAgents.every(other => {
    if (other.id === agentId) return true;
    const ox = other.position.x + AGENT_WIDTH / 2;
    const oy = other.position.y + AGENT_HEIGHT / 2;
    return Math.hypot(cx - ox, cy - oy) >= CONTACT_CLEARANCE;
  });
}

function chooseXOnPlatform(
  platform: PlatformState,
  preferredX: number,
  agent: AgentState,
  otherAgents: AgentState[]
): number | null {
  const minX = platform.position.x + EDGE_MARGIN;
  const maxX = platform.position.x + platform.width - AGENT_WIDTH - EDGE_MARGIN;
  if (maxX < minX) return null;

  const base = clamp(preferredX, minX, maxX);
  const spawnY = platform.position.y - AGENT_HEIGHT;

  // Deterministic nearest-first search. It changes position only as much as needed to
  // prevent an immediate free tag caused solely by the respawn placement.
  const candidates = new Set<number>([base, minX, maxX]);
  for (const other of otherAgents) {
    if (other.id === agent.id) continue;
    candidates.add(clamp(other.position.x - CONTACT_CLEARANCE, minX, maxX));
    candidates.add(clamp(other.position.x + CONTACT_CLEARANCE, minX, maxX));
  }

  const ordered = [...candidates].sort((a, b) => {
    const da = Math.abs(a - base);
    const db = Math.abs(b - base);
    return da === db ? a - b : da - db;
  });

  return ordered.find(x => candidateIsClear(x, spawnY, agent.id, otherAgents)) ?? null;
}

/**
 * Choose a fair deterministic respawn.
 *
 * Priority:
 * 1) the exact last grounded platform/checkpoint;
 * 2) the nearest platform to that checkpoint, strongly preferring one that does not
 *    move the agent forward;
 * 3) minimal horizontal adjustment needed to avoid spawning in tag contact.
 *
 * Stamina, cooldowns, role, and all other gameplay state are intentionally untouched.
 */
export function getFairRespawn(
  agent: AgentState,
  platforms: PlatformState[],
  allAgents: AgentState[]
): FairRespawnResult {
  if (platforms.length === 0) {
    // This should never occur in normal gameplay, but keep the function total and safe.
    return {
      position: { x: agent.positionAtLastTakeoff.x, y: agent.positionAtLastTakeoff.y },
      platformId: agent.lastPlatformId ?? 0,
    };
  }

  const checkpointX = Number.isFinite(agent.positionAtLastTakeoff?.x)
    ? agent.positionAtLastTakeoff.x
    : agent.position.x;
  const checkpointCenterX = checkpointX + AGENT_WIDTH / 2;
  const checkpointPlatform = agent.lastPlatformId == null
    ? undefined
    : platforms.find(p => p.id === agent.lastPlatformId);

  const ranked = [...platforms].sort((a, b) => {
    if (checkpointPlatform) {
      if (a.id === checkpointPlatform.id) return -1;
      if (b.id === checkpointPlatform.id) return 1;
    }

    // A fallback should not reward a fall with forward progress. Only if no suitable
    // behind/overlapping platform exists will an ahead platform win on distance.
    const aAhead = a.position.x > checkpointCenterX ? 1 : 0;
    const bAhead = b.position.x > checkpointCenterX ? 1 : 0;
    if (aAhead !== bAhead) return aAhead - bAhead;

    const da = platformDistanceToX(a, checkpointCenterX);
    const db = platformDistanceToX(b, checkpointCenterX);
    if (da !== db) return da - db;
    return a.id - b.id;
  });

  for (const platform of ranked) {
    const spawnX = chooseXOnPlatform(platform, checkpointX, agent, allAgents);
    if (spawnX == null) continue;
    return {
      position: { x: spawnX, y: platform.position.y - AGENT_HEIGHT },
      platformId: platform.id,
    };
  }

  // If every safe point is occupied, use the closest platform extent. This permits contact
  // only as a last resort rather than placing the agent over empty space.
  for (const platform of ranked) {
    const minX = platform.position.x + EDGE_MARGIN;
    const maxX = platform.position.x + platform.width - AGENT_WIDTH - EDGE_MARGIN;
    if (maxX < minX) continue;
    return {
      position: { x: clamp(checkpointX, minX, maxX), y: platform.position.y - AGENT_HEIGHT },
      platformId: platform.id,
    };
  }

  // Extremely defensive fallback for a malformed world. Generated game worlds should never
  // reach this branch.
  const platform = checkpointPlatform || ranked[0];
  const minX = platform.position.x + EDGE_MARGIN;
  const maxX = Math.max(minX, platform.position.x + platform.width - AGENT_WIDTH - EDGE_MARGIN);
  return {
    position: { x: clamp(checkpointX, minX, maxX), y: platform.position.y - AGENT_HEIGHT },
    platformId: platform.id,
  };
}
