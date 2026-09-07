import type { AgentState, PlatformState } from '../types';
import { AGENT_HEIGHT, WORLD_REF_HEIGHT } from '../constants';

// Ignore bodies only once they have clearly left the playable platform band. This is deliberately
// much deeper than an ordinary jump or the largest normal platform step, so the camera still follows
// legitimate airborne traversal but does not dive after an agent that has missed the level.
export const CAMERA_FALL_IGNORE_DROP_PX = 220;

export function isAgentCameraRelevant(agent: AgentState, platforms: PlatformState[]): boolean {
  if (agent.isOnGround || agent.velocity.y <= 0) return true;

  const support = agent.lastPlatformId == null
    ? undefined
    : platforms.find(platform => platform.id === agent.lastPlatformId);
  if (support) {
    const lastGroundedTopY = support.position.y - AGENT_HEIGHT;
    return agent.position.y - lastGroundedTopY <= CAMERA_FALL_IGNORE_DROP_PX;
  }

  // A support platform can be culled from the rolling world after the body has already fallen away.
  // In that case use the live terrain band as a conservative fallback instead of following it down.
  if (platforms.length > 0) {
    const ys = platforms.map(platform => platform.position.y).sort((a, b) => a - b);
    const medianPlatformY = ys[Math.floor(ys.length / 2)];
    return agent.position.y + AGENT_HEIGHT <= medianPlatformY + CAMERA_FALL_IGNORE_DROP_PX;
  }

  return agent.position.y + AGENT_HEIGHT <= WORLD_REF_HEIGHT + CAMERA_FALL_IGNORE_DROP_PX;
}

export function cameraRelevantAgents(agents: AgentState[], platforms: PlatformState[]): AgentState[] {
  // An empty result is intentional: camera callers hold their previous framing until at least one
  // body is back in the playable band. This prevents an all-agent fall from dragging the view down.
  return agents.filter(agent => isAgentCameraRelevant(agent, platforms));
}
