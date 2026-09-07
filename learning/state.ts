import type { AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import { canAgentUsePlatform } from './terrainRoutes';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  MAX_SPEED,
  JUMP_STRENGTH,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
  PLATFORM_MAX_WIDTH,
  TAG_COOLDOWN,
  NEW_CHASER_TAG_DELAY_MS,
  STATE_VECTOR_SIZE,
} from '../constants';

export type StateVectorBuffer = number[] | Float64Array;


export const STATE_VECTOR_LABELS = [
  'Self horizontal velocity',
  'Self vertical velocity',
  'Energy / stamina',
  'Grounded state',
  'Self tag cooldown',
  'Target / threat tag cooldown',
  'Distance to left platform ledge',
  'Distance to right platform ledge',
  'Next platform horizontal offset',
  'Next platform vertical offset',
  'Next platform width',
  'Second-ahead platform horizontal offset',
  'Second-ahead platform vertical offset',
  'Second-ahead platform width',
  'Previous platform horizontal offset',
  'Previous platform vertical offset',
  'Previous platform width',
  'Target / threat horizontal offset',
  'Target / threat vertical offset',
  'Target / threat horizontal velocity',
  'Target / threat vertical velocity',
  'Closest Runner teammate horizontal offset',
  'Closest Runner teammate vertical offset',
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function cooldownScaleFor(subject: AgentState): number {
  return subject.status === AgentStatus.It ? NEW_CHASER_TAG_DELAY_MS : TAG_COOLDOWN;
}

function normalizedCooldown(subject: AgentState | null): number {
  if (!subject || (subject.cooldownTimer || 0) <= 0) return 0;
  return clamp01((subject.cooldownTimer || 0) / cooldownScaleFor(subject));
}

function platformCenterX(platform: PlatformState): number {
  return platform.position.x + platform.width / 2;
}

function writePlatformFeatures(
  out: StateVectorBuffer,
  offset: number,
  platform: PlatformState | null,
  agentX: number,
  agentY: number
): void {
  if (!platform) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    return;
  }
  out[offset] = (platformCenterX(platform) - agentX) / WORLD_REF_WIDTH;
  out[offset + 1] = (platform.position.y + platform.height / 2 - agentY) / WORLD_REF_HEIGHT;
  out[offset + 2] = platform.width / PLATFORM_MAX_WIDTH;
}

/**
 * Writes the compact 23-dimensional policy state into a caller-owned buffer.
 *
 * The layout deliberately avoids derived/duplicated channels and expensive LiDAR:
 *  0..4   self: vx, vy, energy, grounded, remaining cooldown
 *  5      target/threat remaining cooldown
 *  6..7   left/right ledge distance on the current/reference platform
 *  8..16  semantic platforms: next-ahead, second-ahead, previous-behind [dx,dy,width]
 * 17..20  target/threat [dx,dy,vx,vy]
 * 21..22  closest teammate [dx,dy] (zero for the chaser)
 *
 * Important removals from the old 39-D vector:
 * - Is-It bit: role-specific networks already imply it.
 * - closest-ledge and ledge-alert: both were deterministic functions of left/right ledges.
 * - teammate velocity: lower-value duplicate dynamics; relative position is retained.
 * - 8 LiDAR rays: nearby-platform + ledge senses already encode the relevant geometry.
 * - camera-boundary distances: the presentation camera is observational only and must not affect policy.
 * - constant bias: every NEAT non-input node already has an evolvable bias.
 */
export function writeAgentStateVector(
  agent: AgentState,
  gameState: GameState,
  viewportSize: { width: number; height: number },
  out: StateVectorBuffer
): StateVectorBuffer {
  if (out.length !== STATE_VECTOR_SIZE) {
    throw new Error(`State vector buffer must have ${STATE_VECTOR_SIZE} entries, received ${out.length}`);
  }

  const agentCenterX = agent.position.x + AGENT_WIDTH / 2;
  const agentCenterY = agent.position.y + AGENT_HEIGHT / 2;

  // Resolve target/threat and teammate without allocating filtered agent arrays.
  let itAgent: AgentState | null = null;
  let closestEvader: AgentState | null = null;
  let closestEvaderDistSq = Infinity;
  let closestTeammate: AgentState | null = null;
  let closestTeammateDistSq = Infinity;

  for (let i = 0; i < gameState.agents.length; i++) {
    const other = gameState.agents[i];
    if (other.status === AgentStatus.It) itAgent = other;
    if (other.id === agent.id) continue;

    const dx = other.position.x - agent.position.x;
    const dy = other.position.y - agent.position.y;
    const distSq = dx * dx + dy * dy;

    if (agent.status === AgentStatus.It) {
      if (other.status !== AgentStatus.It && distSq < closestEvaderDistSq) {
        closestEvader = other;
        closestEvaderDistSq = distSq;
      }
    } else if (other.status !== AgentStatus.It && distSq < closestTeammateDistSq) {
      closestTeammate = other;
      closestTeammateDistSq = distSq;
    }
  }
  const targetOrThreat = agent.status === AgentStatus.It ? closestEvader : itAgent;

  // Current platform if known; otherwise nearest platform becomes the ledge reference.
  let referencePlatform: PlatformState | null = null;
  let referenceDistanceSq = Infinity;
  for (let i = 0; i < gameState.platforms.length; i++) {
    const platform = gameState.platforms[i];
    if (platform.id === agent.lastPlatformId) {
      referencePlatform = platform;
      referenceDistanceSq = -1;
      break;
    }
    const dx = platformCenterX(platform) - agentCenterX;
    const dy = platform.position.y - agent.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < referenceDistanceSq) {
      referencePlatform = platform;
      referenceDistanceSq = distSq;
    }
  }

  let distToLeftLedge = 0.5;
  let distToRightLedge = 0.5;
  if (referencePlatform) {
    distToLeftLedge = clamp01((agentCenterX - referencePlatform.position.x) / referencePlatform.width);
    distToRightLedge = clamp01(
      (referencePlatform.position.x + referencePlatform.width - agentCenterX) / referencePlatform.width
    );
  }

  // Stable platform slots: nearest ahead, second ahead, nearest behind. This avoids the old
  // Euclidean-distance sort where platform identities could abruptly swap input slots.
  let ahead1: PlatformState | null = null;
  let ahead2: PlatformState | null = null;
  let ahead1Dx = Infinity;
  let ahead2Dx = Infinity;
  let behind: PlatformState | null = null;
  let behindDx = Infinity;

  for (let i = 0; i < gameState.platforms.length; i++) {
    const platform = gameState.platforms[i];
    if (referencePlatform && platform.id === referencePlatform.id) continue;
    if (!canAgentUsePlatform(agent, platform)) continue;
    const dx = platformCenterX(platform) - agentCenterX;
    if (dx >= 0) {
      if (dx < ahead1Dx) {
        ahead2 = ahead1;
        ahead2Dx = ahead1Dx;
        ahead1 = platform;
        ahead1Dx = dx;
      } else if (dx < ahead2Dx) {
        ahead2 = platform;
        ahead2Dx = dx;
      }
    } else {
      const absDx = -dx;
      if (absDx < behindDx) {
        behind = platform;
        behindDx = absDx;
      }
    }
  }

  out[0] = agent.velocity.x / MAX_SPEED;
  out[1] = agent.velocity.y / Math.abs(JUMP_STRENGTH);
  out[2] = agent.energy / agent.maxEnergy;
  out[3] = agent.isOnGround ? 1 : 0;
  out[4] = normalizedCooldown(agent);

  out[5] = normalizedCooldown(targetOrThreat);

  out[6] = distToLeftLedge;
  out[7] = distToRightLedge;

  writePlatformFeatures(out, 8, ahead1, agentCenterX, agentCenterY);
  writePlatformFeatures(out, 11, ahead2, agentCenterX, agentCenterY);
  writePlatformFeatures(out, 14, behind, agentCenterX, agentCenterY);

  out[17] = targetOrThreat ? (targetOrThreat.position.x - agent.position.x) / WORLD_REF_WIDTH : 0;
  out[18] = targetOrThreat ? (targetOrThreat.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0;
  out[19] = targetOrThreat ? targetOrThreat.velocity.x / MAX_SPEED : 0;
  out[20] = targetOrThreat ? targetOrThreat.velocity.y / Math.abs(JUMP_STRENGTH) : 0;

  out[21] = closestTeammate ? (closestTeammate.position.x - agent.position.x) / WORLD_REF_WIDTH : 0;
  out[22] = closestTeammate ? (closestTeammate.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0;

  return out;
}

/** Convenience wrapper for the visual/debug path, where the vector is retained by React state. */
export function getAgentStateVector(
  agent: AgentState,
  gameState: GameState,
  viewportSize: { width: number; height: number }
): number[] {
  const state = new Array<number>(STATE_VECTOR_SIZE).fill(0);
  writeAgentStateVector(agent, gameState, viewportSize, state);
  return state;
}
