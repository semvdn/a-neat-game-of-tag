import { AGENT_HEIGHT, AGENT_WIDTH } from '../constants';
import type { AgentState, PlatformState, Vector2D } from '../types';
import { applyPlatformRoute } from './terrainRoutes';

/**
 * Visual-simulation-only safety valve.
 *
 * These values are intentionally much looser than normal chase spacing. The watchdog should never
 * shape ordinary play; it exists only to recover a champion showcase that has fragmented badly
 * enough that following the agents is no longer useful.
 */
export const VISUAL_SEPARATION_FAILSAFE_DISTANCE_PX = 1800;
export const VISUAL_SEPARATION_FAILSAFE_DURATION_MS = 5000;

const PLATFORM_EDGE_MARGIN = 12;
const DESIRED_CENTER_SPACING = 100;
const MIN_BODY_GAP = 16;
const MOVING_PLATFORM_SCORE_PENALTY = 220;

export interface VisualSeparationPair {
  firstAgentId: number;
  secondAgentId: number;
  distance: number;
  midpoint: Vector2D;
}

export interface VisualGroupRecoveryPlacement {
  agentId: number;
  position: Vector2D;
  platformId: number;
  activeRoutePath: string | null;
}

export interface VisualGroupRecovery {
  pair: VisualSeparationPair;
  platformId: number;
  platformCenterX: number;
  placements: VisualGroupRecoveryPlacement[];
}

const agentCenter = (agent: AgentState): Vector2D => ({
  x: agent.position.x + AGENT_WIDTH * 0.5,
  y: agent.position.y + AGENT_HEIGHT * 0.5,
});

/** Return the widest pair in the group. */
export function getMaxVisualAgentSeparation(agents: AgentState[]): VisualSeparationPair | null {
  if (agents.length < 2) return null;

  let best: VisualSeparationPair | null = null;
  for (let i = 0; i < agents.length - 1; i++) {
    const a = agentCenter(agents[i]);
    for (let j = i + 1; j < agents.length; j++) {
      const b = agentCenter(agents[j]);
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (!best || distance > best.distance) {
        best = {
          firstAgentId: agents[i].id,
          secondAgentId: agents[j].id,
          distance,
          midpoint: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 },
        };
      }
    }
  }
  return best;
}

const platformCenter = (platform: PlatformState): Vector2D => ({
  x: platform.position.x + platform.width * 0.5,
  y: platform.position.y + platform.height * 0.5,
});

const minimumRecoveryPlatformWidth = (agentCount: number): number =>
  AGENT_WIDTH * agentCount + MIN_BODY_GAP * Math.max(0, agentCount - 1) + PLATFORM_EDGE_MARGIN * 2;

/**
 * Pick one reasonably wide platform nearest the midpoint of the two most separated bodies, then
 * spread every agent across it in their existing left-to-right order. This preserves roles and
 * avoids creating an immediate tag contact solely because the fail-safe fired.
 */
export function getVisualGroupSeparationRecovery(
  agents: AgentState[],
  platforms: PlatformState[],
): VisualGroupRecovery | null {
  const pair = getMaxVisualAgentSeparation(agents);
  if (!pair || agents.length === 0 || platforms.length === 0) return null;

  const minWidth = minimumRecoveryPlatformWidth(agents.length);
  const viable = platforms.filter(platform =>
    Number.isFinite(platform.position.x) &&
    Number.isFinite(platform.position.y) &&
    Number.isFinite(platform.width) &&
    platform.width >= minWidth
  );
  if (viable.length === 0) return null;

  const ranked = [...viable].sort((a, b) => {
    const ca = platformCenter(a);
    const cb = platformCenter(b);
    const scoreA = Math.abs(ca.x - pair.midpoint.x)
      + Math.abs(ca.y - pair.midpoint.y) * 0.35
      + (a.motion ? MOVING_PLATFORM_SCORE_PENALTY : 0);
    const scoreB = Math.abs(cb.x - pair.midpoint.x)
      + Math.abs(cb.y - pair.midpoint.y) * 0.35
      + (b.motion ? MOVING_PLATFORM_SCORE_PENALTY : 0);
    if (scoreA !== scoreB) return scoreA - scoreB;
    // When two choices are equivalent, prefer the wider and then the stable id order.
    if (a.width !== b.width) return b.width - a.width;
    return a.id - b.id;
  });

  const platform = ranked[0];
  const safeLeftCenter = platform.position.x + PLATFORM_EDGE_MARGIN + AGENT_WIDTH * 0.5;
  const safeRightCenter = platform.position.x + platform.width - PLATFORM_EDGE_MARGIN - AGENT_WIDTH * 0.5;
  const availableCenterSpan = Math.max(0, safeRightCenter - safeLeftCenter);
  const maxSpacing = agents.length > 1 ? availableCenterSpan / (agents.length - 1) : 0;
  const centerSpacing = agents.length > 1
    ? Math.max(AGENT_WIDTH + MIN_BODY_GAP, Math.min(DESIRED_CENTER_SPACING, maxSpacing))
    : 0;
  const groupHalfSpan = centerSpacing * Math.max(0, agents.length - 1) * 0.5;
  const minGroupCenter = safeLeftCenter + groupHalfSpan;
  const maxGroupCenter = safeRightCenter - groupHalfSpan;
  const clampedGroupCenter = Math.max(
    minGroupCenter,
    Math.min(maxGroupCenter, pair.midpoint.x)
  );

  const orderedAgents = [...agents].sort((a, b) => {
    const ax = a.position.x + AGENT_WIDTH * 0.5;
    const bx = b.position.x + AGENT_WIDTH * 0.5;
    return ax === bx ? a.id - b.id : ax - bx;
  });

  const placements = orderedAgents.map((agent, index): VisualGroupRecoveryPlacement => {
    const centerX = clampedGroupCenter + (index - (orderedAgents.length - 1) * 0.5) * centerSpacing;
    const staged: AgentState = { ...agent };
    applyPlatformRoute(staged, platform);
    return {
      agentId: agent.id,
      position: {
        x: centerX - AGENT_WIDTH * 0.5,
        y: platform.position.y - AGENT_HEIGHT,
      },
      platformId: platform.id,
      activeRoutePath: staged.activeRoutePath || null,
    };
  });

  return {
    pair,
    platformId: platform.id,
    platformCenterX: platform.position.x + platform.width * 0.5,
    placements,
  };
}
