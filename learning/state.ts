import type { AgentState, GameState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  MAX_SPEED,
  JUMP_STRENGTH,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
  PLATFORM_MAX_WIDTH,
  FALL_BOUNDARY,
} from '../constants';

const clamp01Fast = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;

/**
 * Computes the enhanced 31-dimensional state vector for an agent:
 * - 6 Self Kinematics & Status
 * - 3 Explicit Boundary Distances (Left Screen, Right Screen, Fall Boundary)
 * - 4 Explicit Platform Ledge Distances (Left Ledge, Right Ledge, Closest Ledge, Ledge Proximity Alert)
 * - 9 Nearby Platforms Features (3 closest platforms * [dx, dy, width])
 * - 4 Target / Threat Dynamics ([dx, dy, vx, vy])
 * - 4 Closest Teammate Dynamics ([dx, dy, vx, vy])
 * - 1 Opponent Energy Reserve
 * Total: 31 Features
 */
export function getAgentStateVector(
  agent: AgentState,
  gameState: GameState,
  viewportSize: { width: number; height: number },
  captureDebug = false
): number[] {
  const itAgent = gameState.agents.find(a => a.status === AgentStatus.It);
  const otherAgents = gameState.agents.filter(a => a.id !== agent.id);

  // --- 1. Target / Threat Selection ---
  let targetOrThreat: AgentState | null = null;
  if (agent.status === AgentStatus.It) {
    // Target is the closest evader
    const evaders = otherAgents.filter(a => a.status !== AgentStatus.It);
    if (evaders.length > 0) {
      targetOrThreat = evaders.reduce((closest, other) => {
        const d1 = Math.hypot(agent.position.x - closest.position.x, agent.position.y - closest.position.y);
        const d2 = Math.hypot(agent.position.x - other.position.x, agent.position.y - other.position.y);
        return d2 < d1 ? other : closest;
      });
    }
  } else {
    // Threat is the 'It' agent
    targetOrThreat = itAgent || null;
  }

  // --- 2. Closest Teammate (for evaders) ---
  let closestTeammate: AgentState | null = null;
  if (agent.status !== AgentStatus.It) {
    const teammates = otherAgents.filter(a => a.status !== AgentStatus.It);
    if (teammates.length > 0) {
      closestTeammate = teammates.reduce((closest, other) => {
        const d1 = Math.hypot(agent.position.x - closest.position.x, agent.position.y - closest.position.y);
        const d2 = Math.hypot(agent.position.x - other.position.x, agent.position.y - other.position.y);
        return d2 < d1 ? other : closest;
      });
    }
  }

  const agentCenterX = agent.position.x + AGENT_WIDTH / 2;
  const agentCenterY = agent.position.y + AGENT_HEIGHT / 2;

  // --- 3. Explicit Boundary Distances ---
  const screenLeft = gameState.cameraPosition.x;
  const screenRight = gameState.cameraPosition.x + viewportSize.width;

  const distToLeftBoundary = Math.max(0, Math.min(1, (agentCenterX - screenLeft) / WORLD_REF_WIDTH));
  const distToRightBoundary = Math.max(0, Math.min(1, (screenRight - agentCenterX) / WORLD_REF_WIDTH));
  const distToFallBoundary = Math.max(
    0,
    Math.min(1, (FALL_BOUNDARY - (agent.position.y + AGENT_HEIGHT)) / WORLD_REF_HEIGHT)
  );

  // --- 4. Explicit Platform Ledge Distances ---
  const onPlatform = gameState.platforms.find(p => p.id === agent.lastPlatformId);
  let referencePlatform = onPlatform || null;
  let distToLeftLedge = 0.5;
  let distToRightLedge = 0.5;
  let distToClosestLedge = 0.5;
  let isNearLedge = 0;

  if (onPlatform) {
    distToLeftLedge = Math.max(0, Math.min(1, (agentCenterX - onPlatform.position.x) / onPlatform.width));
    distToRightLedge = Math.max(
      0,
      Math.min(1, (onPlatform.position.x + onPlatform.width - agentCenterX) / onPlatform.width)
    );
    distToClosestLedge = Math.min(distToLeftLedge, distToRightLedge);
    // Continuous activation when agent is in the dangerous outer 20% margin of the platform
    isNearLedge = Math.max(0, 1.0 - distToClosestLedge / 0.2);
  } else {
    // When airborne, locate the nearest platform below or nearby
    let closestPlat = gameState.platforms[0];
    let minDist = Infinity;
    for (const p of gameState.platforms) {
      const pCenter = p.position.x + p.width / 2;
      const d = Math.hypot(pCenter - agentCenterX, p.position.y - agent.position.y);
      if (d < minDist) {
        minDist = d;
        closestPlat = p;
      }
    }
    if (closestPlat) {
      referencePlatform = closestPlat;
      distToLeftLedge = Math.max(0, Math.min(1, (agentCenterX - closestPlat.position.x) / closestPlat.width));
      distToRightLedge = Math.max(
        0,
        Math.min(1, (closestPlat.position.x + closestPlat.width - agentCenterX) / closestPlat.width)
      );
      distToClosestLedge = Math.min(distToLeftLedge, distToRightLedge);
      isNearLedge = 0;
    }
  }

  // --- 5. Nearby Platforms Info (3 closest) ---
  const sortedPlatforms = gameState.platforms
    .filter(p => !onPlatform || p.id !== onPlatform.id)
    .map(p => {
      const platformCenter = { x: p.position.x + p.width / 2, y: p.position.y + p.height / 2 };
      const distance = Math.hypot(platformCenter.x - agentCenterX, platformCenter.y - agentCenterY);
      return { platform: p, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  const nearbyPlatformsFeatures: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (sortedPlatforms[i]) {
      const p = sortedPlatforms[i].platform;
      const platformCenter = { x: p.position.x + p.width / 2, y: p.position.y + p.height / 2 };
      nearbyPlatformsFeatures.push(
        (platformCenter.x - agent.position.x) / WORLD_REF_WIDTH, // dx
        (platformCenter.y - agent.position.y) / WORLD_REF_HEIGHT, // dy
        p.width / PLATFORM_MAX_WIDTH // width
      );
    } else {
      nearbyPlatformsFeatures.push(0, 0, 0);
    }
  }

  // --- Assemble Full 31-D State Vector ---
  const state: number[] = [
    // Self Kinematics & Status (6)
    agent.velocity.x / MAX_SPEED,
    agent.velocity.y / Math.abs(JUMP_STRENGTH),
    agent.energy / agent.maxEnergy,
    agent.isOnGround ? 1 : 0,
    agent.status === AgentStatus.It ? 1 : 0,
    agent.status === AgentStatus.Cooldown ? 1 : 0,

    // Explicit Boundary Distances (3)
    distToLeftBoundary,
    distToRightBoundary,
    distToFallBoundary,

    // Explicit Platform & Ledge Distances (4)
    distToLeftLedge,
    distToRightLedge,
    distToClosestLedge,
    isNearLedge,

    // Nearby Platforms (3 platforms * 3 features = 9)
    ...nearbyPlatformsFeatures,

    // Target / Threat Dynamics (4)
    targetOrThreat ? (targetOrThreat.position.x - agent.position.x) / WORLD_REF_WIDTH : 0,
    targetOrThreat ? (targetOrThreat.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0,
    targetOrThreat ? targetOrThreat.velocity.x / MAX_SPEED : 0,
    targetOrThreat ? targetOrThreat.velocity.y / Math.abs(JUMP_STRENGTH) : 0,

    // Closest Teammate Dynamics (4)
    closestTeammate ? (closestTeammate.position.x - agent.position.x) / WORLD_REF_WIDTH : 0,
    closestTeammate ? (closestTeammate.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0,
    closestTeammate ? closestTeammate.velocity.x / MAX_SPEED : 0,
    closestTeammate ? closestTeammate.velocity.y / Math.abs(JUMP_STRENGTH) : 0,

    // Opponent Energy Reserve (1)
    targetOrThreat ? targetOrThreat.energy / Math.max(1, targetOrThreat.maxEnergy) : 0,
  ];

  // Debug/visualization data is produced by the exact same observation pass that feeds NEAT.
  // The senses overlay consumes this instead of re-implementing target/platform selection.
  if (captureDebug) {
    agent.sensesDebug = {
      self: {
        vx: state[0],
        vy: state[1],
        energy: state[2],
        grounded: state[3],
        isIt: state[4],
        cooldown: state[5],
      },
      boundaries: {
        left: distToLeftBoundary,
        right: distToRightBoundary,
        fall: distToFallBoundary,
      },
      ledges: {
        referencePlatformId: referencePlatform?.id ?? null,
        left: distToLeftLedge,
        right: distToRightLedge,
        closest: distToClosestLedge,
        alert: isNearLedge,
      },
      nearbyPlatforms: sortedPlatforms.map(({ platform }) => {
        const platformCenter = {
          x: platform.position.x + platform.width / 2,
          y: platform.position.y + platform.height / 2,
        };
        return {
          id: platform.id,
          dx: (platformCenter.x - agent.position.x) / WORLD_REF_WIDTH,
          dy: (platformCenter.y - agent.position.y) / WORLD_REF_HEIGHT,
          width: platform.width / PLATFORM_MAX_WIDTH,
        };
      }),
      target: targetOrThreat ? {
        id: targetOrThreat.id,
        dx: (targetOrThreat.position.x - agent.position.x) / WORLD_REF_WIDTH,
        dy: (targetOrThreat.position.y - agent.position.y) / WORLD_REF_HEIGHT,
        vx: targetOrThreat.velocity.x / MAX_SPEED,
        vy: targetOrThreat.velocity.y / Math.abs(JUMP_STRENGTH),
        energy: targetOrThreat.energy / Math.max(1, targetOrThreat.maxEnergy),
      } : null,
      teammate: closestTeammate ? {
        id: closestTeammate.id,
        dx: (closestTeammate.position.x - agent.position.x) / WORLD_REF_WIDTH,
        dy: (closestTeammate.position.y - agent.position.y) / WORLD_REF_HEIGHT,
        vx: closestTeammate.velocity.x / MAX_SPEED,
        vy: closestTeammate.velocity.y / Math.abs(JUMP_STRENGTH),
      } : null,
    };
  }

  return state;
}

/**
 * Allocation-light training variant of getAgentStateVector(). It produces the exact same 31 inputs
 * but writes into a caller-owned Float64Array and selects nearest objects with linear scans instead
 * of allocating/sorting temporary arrays every physics frame.
 */
export function fillAgentStateVectorFast(
  agent: AgentState,
  gameState: GameState,
  viewportSize: { width: number; height: number },
  out: Float64Array
): Float64Array {
  if (out.length < 31) throw new Error(`State scratch buffer must contain at least 31 values, received ${out.length}`);

  const agents = gameState.agents;
  let itAgent: AgentState | null = null;
  for (let i = 0; i < agents.length; i++) {
    if (agents[i].status === AgentStatus.It) {
      itAgent = agents[i];
      break;
    }
  }

  let targetOrThreat: AgentState | null = null;
  let closestTeammate: AgentState | null = null;

  if (agent.status === AgentStatus.It) {
    let bestD2 = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const other = agents[i];
      if (other.id === agent.id || other.status === AgentStatus.It) continue;
      const dx = agent.position.x - other.position.x;
      const dy = agent.position.y - other.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        targetOrThreat = other;
      }
    }
  } else {
    targetOrThreat = itAgent;
    let bestD2 = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const other = agents[i];
      if (other.id === agent.id || other.status === AgentStatus.It) continue;
      const dx = agent.position.x - other.position.x;
      const dy = agent.position.y - other.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        closestTeammate = other;
      }
    }
  }

  const agentCenterX = agent.position.x + AGENT_WIDTH / 2;
  const agentCenterY = agent.position.y + AGENT_HEIGHT / 2;
  const screenLeft = gameState.cameraPosition.x;
  const screenRight = screenLeft + viewportSize.width;

  const distToLeftBoundary = clamp01Fast((agentCenterX - screenLeft) / WORLD_REF_WIDTH);
  const distToRightBoundary = clamp01Fast((screenRight - agentCenterX) / WORLD_REF_WIDTH);
  const distToFallBoundary = clamp01Fast((FALL_BOUNDARY - (agent.position.y + AGENT_HEIGHT)) / WORLD_REF_HEIGHT);

  const platforms = gameState.platforms;
  let onPlatform: typeof platforms[number] | null = null;
  // Generated training platforms use stable integer ids, so the common case is O(1).
  const directPlatform = platforms[agent.lastPlatformId];
  if (directPlatform?.id === agent.lastPlatformId) onPlatform = directPlatform;
  else {
    for (let i = 0; i < platforms.length; i++) {
      if (platforms[i].id === agent.lastPlatformId) {
        onPlatform = platforms[i];
        break;
      }
    }
  }

  let referencePlatform = onPlatform;
  let distToLeftLedge = 0.5;
  let distToRightLedge = 0.5;
  let distToClosestLedge = 0.5;
  let isNearLedge = 0;

  if (!referencePlatform) {
    let bestD2 = Infinity;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const dx = p.position.x + p.width / 2 - agentCenterX;
      const dy = p.position.y - agent.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        referencePlatform = p;
      }
    }
  }

  if (referencePlatform) {
    distToLeftLedge = clamp01Fast((agentCenterX - referencePlatform.position.x) / referencePlatform.width);
    distToRightLedge = clamp01Fast(
      (referencePlatform.position.x + referencePlatform.width - agentCenterX) / referencePlatform.width
    );
    distToClosestLedge = Math.min(distToLeftLedge, distToRightLedge);
    if (onPlatform) isNearLedge = Math.max(0, 1 - distToClosestLedge / 0.2);
  }

  // Track the three nearest non-current platforms without allocating and sorting the whole platform list.
  let p0: typeof platforms[number] | null = null;
  let p1: typeof platforms[number] | null = null;
  let p2: typeof platforms[number] | null = null;
  let d0 = Infinity;
  let d1 = Infinity;
  let d2 = Infinity;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (onPlatform && p.id === onPlatform.id) continue;
    const dx = p.position.x + p.width / 2 - agentCenterX;
    const dy = p.position.y + p.height / 2 - agentCenterY;
    const distance2 = dx * dx + dy * dy;
    if (distance2 < d0) {
      p2 = p1; d2 = d1;
      p1 = p0; d1 = d0;
      p0 = p; d0 = distance2;
    } else if (distance2 < d1) {
      p2 = p1; d2 = d1;
      p1 = p; d1 = distance2;
    } else if (distance2 < d2) {
      p2 = p; d2 = distance2;
    }
  }

  out[0] = agent.velocity.x / MAX_SPEED;
  out[1] = agent.velocity.y / Math.abs(JUMP_STRENGTH);
  out[2] = agent.energy / agent.maxEnergy;
  out[3] = agent.isOnGround ? 1 : 0;
  out[4] = agent.status === AgentStatus.It ? 1 : 0;
  out[5] = agent.status === AgentStatus.Cooldown ? 1 : 0;
  out[6] = distToLeftBoundary;
  out[7] = distToRightBoundary;
  out[8] = distToFallBoundary;
  out[9] = distToLeftLedge;
  out[10] = distToRightLedge;
  out[11] = distToClosestLedge;
  out[12] = isNearLedge;

  if (p0) {
    out[13] = (p0.position.x + p0.width / 2 - agent.position.x) / WORLD_REF_WIDTH;
    out[14] = (p0.position.y + p0.height / 2 - agent.position.y) / WORLD_REF_HEIGHT;
    out[15] = p0.width / PLATFORM_MAX_WIDTH;
  } else {
    out[13] = 0; out[14] = 0; out[15] = 0;
  }
  if (p1) {
    out[16] = (p1.position.x + p1.width / 2 - agent.position.x) / WORLD_REF_WIDTH;
    out[17] = (p1.position.y + p1.height / 2 - agent.position.y) / WORLD_REF_HEIGHT;
    out[18] = p1.width / PLATFORM_MAX_WIDTH;
  } else {
    out[16] = 0; out[17] = 0; out[18] = 0;
  }
  if (p2) {
    out[19] = (p2.position.x + p2.width / 2 - agent.position.x) / WORLD_REF_WIDTH;
    out[20] = (p2.position.y + p2.height / 2 - agent.position.y) / WORLD_REF_HEIGHT;
    out[21] = p2.width / PLATFORM_MAX_WIDTH;
  } else {
    out[19] = 0; out[20] = 0; out[21] = 0;
  }

  out[22] = targetOrThreat ? (targetOrThreat.position.x - agent.position.x) / WORLD_REF_WIDTH : 0;
  out[23] = targetOrThreat ? (targetOrThreat.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0;
  out[24] = targetOrThreat ? targetOrThreat.velocity.x / MAX_SPEED : 0;
  out[25] = targetOrThreat ? targetOrThreat.velocity.y / Math.abs(JUMP_STRENGTH) : 0;
  out[26] = closestTeammate ? (closestTeammate.position.x - agent.position.x) / WORLD_REF_WIDTH : 0;
  out[27] = closestTeammate ? (closestTeammate.position.y - agent.position.y) / WORLD_REF_HEIGHT : 0;
  out[28] = closestTeammate ? closestTeammate.velocity.x / MAX_SPEED : 0;
  out[29] = closestTeammate ? closestTeammate.velocity.y / Math.abs(JUMP_STRENGTH) : 0;
  out[30] = targetOrThreat ? targetOrThreat.energy / Math.max(1, targetOrThreat.maxEnergy) : 0;
  return out;
}
