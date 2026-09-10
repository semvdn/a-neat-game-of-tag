import assert from 'node:assert/strict';
import { maintainPlatformsForCameraInPlace } from '../learning/simulationCore.ts';
import { continuousTerrainRuntime, DEFAULT_TERRAIN_VARIETY_CONFIG } from '../learning/terrainConfig.ts';
import { GRAVITY, JUMP_STRENGTH, MAX_SPEED, PLATFORM_HEIGHT } from '../constants.ts';

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jumpHorizontalReach(deltaY) {
  // stepAgentPhysics integrates gravity before position, so after n frames:
  // y(n) = n * JUMP_STRENGTH + GRAVITY * n * (n + 1) / 2.
  const a = GRAVITY / 2;
  const b = JUMP_STRENGTH + GRAVITY / 2;
  const discriminant = b * b + 4 * a * deltaY;
  if (discriminant < 0) return -1;
  return MAX_SPEED * ((-b + Math.sqrt(discriminant)) / (2 * a));
}

function horizontalSweep(platform) {
  if (platform.motion?.axis === 'x') {
    return [
      Math.min(platform.position.x, platform.motion.min),
      Math.max(platform.position.x + platform.width, platform.motion.max + platform.width),
    ];
  }
  return [platform.position.x, platform.position.x + platform.width];
}

function verticalPositions(platform) {
  return platform.motion?.axis === 'y'
    ? [platform.position.y, platform.motion.min, platform.motion.max]
    : [platform.position.y];
}

function bridgeability(source, target) {
  // Use the most favorable points in each moving platform's legal sweep. This is deliberately
  // lenient: if a transition fails even here, no timing of the platform cycle can make it bridgeable.
  const sourceSweep = horizontalSweep(source);
  const targetSweep = horizontalSweep(target);
  const gap = Math.max(0, targetSweep[0] - sourceSweep[1]);
  let bestReach = -1;
  for (const sourceY of verticalPositions(source)) {
    for (const targetY of verticalPositions(target)) {
      bestReach = Math.max(bestReach, jumpHorizontalReach(targetY - sourceY));
    }
  }
  return { gap, bestReach, reachable: gap <= bestReach + 1e-6 };
}

function assertReachable(source, target, label) {
  const result = bridgeability(source, target);
  assert(
    result.reachable,
    `${label}: edge gap ${result.gap.toFixed(1)}px exceeds best base jump reach ${result.bestReach.toFixed(1)}px`,
  );
}

function generatedWorld(seed, maxCameraX = 42000) {
  const rng = seededRng(seed);
  const terrain = continuousTerrainRuntime(DEFAULT_TERRAIN_VARIETY_CONFIG);
  let platforms = [{ id: 0, position: { x: 0, y: 700 }, width: 1200, height: PLATFORM_HEIGHT }];
  let nextPlatformId = 10;
  const history = new Map([[0, structuredClone(platforms[0])]]);

  for (let cameraX = 0; cameraX <= maxCameraX; cameraX += 700) {
    nextPlatformId = maintainPlatformsForCameraInPlace(
      platforms,
      [],
      cameraX,
      { width: 1200, height: 800 },
      nextPlatformId,
      rng,
      650,
      terrain,
    );
    for (const platform of platforms) {
      if (!history.has(platform.id)) history.set(platform.id, structuredClone(platform));
    }
  }
  return [...history.values()];
}

function verifyIntendedRouteGraph(platforms, seed) {
  const merges = new Map(
    platforms
      .filter(platform => platform.structureType === 'merge' && platform.branchGroupId != null)
      .map(platform => [platform.branchGroupId, platform]),
  );
  const groupIds = [...merges.keys()];
  const firstX = new Map();

  for (const groupId of groupIds) {
    const merge = merges.get(groupId);
    const parentPath = merge.mergeToRoutePath ?? '';
    const prefix = parentPath ? `${parentPath}/g${groupId}` : `g${groupId}`;
    const directRoutePlatforms = platforms.filter(platform =>
      platform.branchGroupId === groupId &&
      (platform.routePath === `${prefix}U` || platform.routePath === `${prefix}L`),
    );
    assert(directRoutePlatforms.length > 0, `seed ${seed}: branch ${groupId} has no direct route platforms`);
    firstX.set(groupId, Math.min(...directRoutePlatforms.map(platform => platform.position.x)));
  }

  const childrenByParentPath = new Map();
  for (const groupId of groupIds) {
    const parentPath = merges.get(groupId).mergeToRoutePath ?? '';
    const children = childrenByParentPath.get(parentPath) ?? [];
    children.push(groupId);
    childrenByParentPath.set(parentPath, children);
  }
  for (const children of childrenByParentPath.values()) {
    children.sort((a, b) => firstX.get(a) - firstX.get(b));
  }

  const firstDirectPlatform = (groupId, side) => {
    const merge = merges.get(groupId);
    const parentPath = merge.mergeToRoutePath ?? '';
    const path = `${parentPath ? `${parentPath}/` : ''}g${groupId}${side}`;
    return platforms
      .filter(platform => platform.branchGroupId === groupId && platform.routePath === path)
      .sort((a, b) => a.position.x - b.position.x)[0] ?? null;
  };

  const processBranch = (groupId, entryPlatform) => {
    const merge = merges.get(groupId);
    const parentPath = merge.mergeToRoutePath ?? '';
    const prefix = parentPath ? `${parentPath}/g${groupId}` : `g${groupId}`;

    for (const side of ['U', 'L']) {
      const routePath = `${prefix}${side}`;
      const direct = platforms
        .filter(platform => platform.branchGroupId === groupId && platform.routePath === routePath)
        .sort((a, b) => a.position.x - b.position.x);
      if (direct.length === 0) continue;

      const childIds = [...(childrenByParentPath.get(routePath) ?? [])];
      let childIndex = 0;
      let current = entryPlatform;

      for (const next of direct) {
        // Nested branches replace the direct parent-route transition that spans them. Walk through
        // each child first, then continue from its merge instead of incorrectly jumping across it.
        while (childIndex < childIds.length && firstX.get(childIds[childIndex]) < next.position.x) {
          const childId = childIds[childIndex++];
          const upper = firstDirectPlatform(childId, 'U');
          const lower = firstDirectPlatform(childId, 'L');
          if (upper) assertReachable(current, upper, `seed ${seed} branch ${childId} upper entry`);
          if (lower) assertReachable(current, lower, `seed ${seed} branch ${childId} lower entry`);
          processBranch(childId, current);
          current = merges.get(childId);
        }

        assertReachable(current, next, `seed ${seed} route ${routePath}`);
        current = next;
      }

      while (childIndex < childIds.length) {
        const childId = childIds[childIndex++];
        const upper = firstDirectPlatform(childId, 'U');
        const lower = firstDirectPlatform(childId, 'L');
        if (upper) assertReachable(current, upper, `seed ${seed} branch ${childId} upper entry`);
        if (lower) assertReachable(current, lower, `seed ${seed} branch ${childId} lower entry`);
        processBranch(childId, current);
        current = merges.get(childId);
      }

      assertReachable(current, merge, `seed ${seed} branch ${groupId} ${side} merge`);
    }
  };

  // Walk the top-level trunk, expanding each root branch between its entry and merge. This checks
  // ordinary terrain, both branch entrances, nested route continuity and both merge approaches.
  const rootIds = [...(childrenByParentPath.get('') ?? [])];
  const trunk = platforms
    .filter(platform => !platform.routePath && !(platform.structureType === 'merge' && platform.mergeToRoutePath != null))
    .sort((a, b) => a.position.x - b.position.x);
  let rootIndex = 0;

  for (let i = 1; i < trunk.length; i++) {
    let current = trunk[i - 1];
    const next = trunk[i];
    while (rootIndex < rootIds.length && firstX.get(rootIds[rootIndex]) < next.position.x) {
      const groupId = rootIds[rootIndex++];
      const merge = merges.get(groupId);
      if (merge.position.x <= current.position.x) continue;
      const upper = firstDirectPlatform(groupId, 'U');
      const lower = firstDirectPlatform(groupId, 'L');
      if (upper) assertReachable(current, upper, `seed ${seed} branch ${groupId} upper entry`);
      if (lower) assertReachable(current, lower, `seed ${seed} branch ${groupId} lower entry`);
      processBranch(groupId, current);
      current = merge;
    }
    if (current.id !== next.id) assertReachable(current, next, `seed ${seed} trunk`);
  }
}

export function verifyTerrainReachability() {
  // Seed 54 reproduces an oversized direct route gap in the old generator. Seed 302 and seed 2
  // exercise nested-return/sibling-merge geometry. The fourth seed broadens the deterministic CI
  // coverage without turning the normal validation job into a long fuzz run.
  for (const seed of [2, 54, 302, 777]) {
    verifyIntendedRouteGraph(generatedWorld(seed), seed);
  }
  console.log('Terrain reachability regressions passed: trunk, branch entries, nested routes and merges remain bridgeable');
}
