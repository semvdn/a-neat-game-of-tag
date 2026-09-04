import { AGENT_HEIGHT, AGENT_WIDTH } from '../constants';
import type { AgentState, PlatformState, Vector2D } from '../types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Store a respawn anchor only from confirmed ground contact. The X coordinate is clamped so the
 * complete agent body is supported by the platform; this prevents an edge-overlap landing from
 * becoming an immediate repeat fall after respawn.
 */
export function setSafeGroundAnchor(agent: AgentState, platform: PlatformState, x: number): void {
  const minX = platform.position.x;
  const maxX = Math.max(minX, minX + platform.width - AGENT_WIDTH);
  const safeX = x < minX ? minX : x > maxX ? maxX : x;
  agent.respawnPlatformId = platform.id;
  // Mutate the existing vector instead of allocating one on every grounded training frame.
  agent.respawnPosition.x = safeX;
  agent.respawnPosition.y = platform.position.y - AGENT_HEIGHT;
}

/**
 * Resolve a fall back to the agent's own last confirmed safe ground contact.
 *
 * The exact platform id is preferred. The fallback is based on the stored safe anchor rather than
 * the body's X after a long fall, so horizontal drift while falling can never select a more useful
 * platform. In the visual world anchor platforms are retained during platform pruning, so this
 * fallback is mainly defensive for malformed/legacy state.
 */
export function resolveRespawnTarget(agent: AgentState, platforms: PlatformState[]): {
  platform: PlatformState;
  position: Vector2D;
} | null {
  if (platforms.length === 0) return null;

  let platform = agent.respawnPlatformId == null
    ? null
    : platforms.find(candidate => candidate.id === agent.respawnPlatformId) || null;

  if (!platform) {
    const anchor = agent.respawnPosition || agent.position;
    let bestScore = Infinity;
    for (const candidate of platforms) {
      const maxX = Math.max(candidate.position.x, candidate.position.x + candidate.width - AGENT_WIDTH);
      const supportedX = clamp(anchor.x, candidate.position.x, maxX);
      const supportedY = candidate.position.y - AGENT_HEIGHT;
      const dx = supportedX - anchor.x;
      const dy = supportedY - anchor.y;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        platform = candidate;
      }
    }
  }

  if (!platform) return null;
  const anchorX = agent.respawnPosition?.x ?? agent.position.x;
  const maxX = Math.max(platform.position.x, platform.position.x + platform.width - AGENT_WIDTH);
  return {
    platform,
    position: {
      x: clamp(anchorX, platform.position.x, maxX),
      y: platform.position.y - AGENT_HEIGHT,
    },
  };
}
