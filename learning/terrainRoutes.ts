import type { AgentState, PlatformState } from '../types';

function groupToken(groupId: number | undefined, side: 'U' | 'L'): string | null {
  return groupId == null ? null : `g${groupId}${side}`;
}

/**
 * Branch platforms are intentionally mutually exclusive. A body with no route lock may choose
 * either side of the next split. Once a branch platform is landed, only that route (or one of its
 * descendants) remains collidable until the matching merge platform is reached.
 */
export function canAgentUsePlatform(agent: AgentState, platform: PlatformState): boolean {
  if (agent.lastPlatformId === platform.id) return true;
  const active = agent.activeRoutePath || '';

  if (platform.structureType === 'merge') {
    if (!active || platform.branchGroupId == null) return false;
    const upper = groupToken(platform.branchGroupId, 'U');
    const lower = groupToken(platform.branchGroupId, 'L');
    const segments = active.split('/');
    return (!!upper && segments.includes(upper)) || (!!lower && segments.includes(lower));
  }

  const route = platform.routePath || '';
  if (!route) return !active;
  if (!active) {
    // At the shared trunk, the next landing must be one of the two first-level fork routes.
    // This prevents an agent from skipping the branch point and committing directly to a nested
    // descendant that happens to pass nearby.
    return !route.includes('/');
  }
  return route === active || route.startsWith(`${active}/`);
}


/**
 * Route-lock interaction rule. Agents may still see and pursue one another across a split, but
 * physical tag contact is valid only while their committed routes have not diverged. A parent
 * route and one of its descendants remain compatible so contact can resume naturally at nested
 * merge points; two sibling descendants are isolated until one/both agents return to their shared
 * parent route.
 */
export function canAgentsPhysicallyInteract(a: AgentState, b: AgentState): boolean {
  const aPath = (a.activeRoutePath || '').split('/').filter(Boolean);
  const bPath = (b.activeRoutePath || '').split('/').filter(Boolean);
  if (aPath.length === 0 || bPath.length === 0) return true;

  const sharedDepth = Math.min(aPath.length, bPath.length);
  for (let i = 0; i < sharedDepth; i++) {
    if (aPath[i] !== bPath[i]) return false;
  }
  return true;
}

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
