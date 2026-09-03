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
