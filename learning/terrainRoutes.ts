import type { AgentState, PlatformState } from '../types';

/** Every generated surface is physical, including unsensed and sibling-route platforms.
 * Route paths describe terrain; geometry alone determines access in the solid-group rules. */
export function canAgentUsePlatform(_agent: AgentState, _platform: PlatformState): boolean { return true; }
export function canAgentsPhysicallyInteract(_a: AgentState, _b: AgentState): boolean { return true; }

export function applyPlatformRoute(agent: AgentState, platform: PlatformState | undefined): void {
  if (!platform) return;
  if (platform.structureType === 'merge') {
    agent.activeRoutePath = platform.mergeToRoutePath || null;
  } else if (platform.routePath) {
    agent.activeRoutePath = platform.routePath;
  } else {
    agent.activeRoutePath = null;
  }
}
