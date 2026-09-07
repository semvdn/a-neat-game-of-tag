import type { ActiveUpgradeState, AgentState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import { getFairRespawn } from './respawn';
import {
  AGENT_ACCELERATION,
  AGENT_HEIGHT,
  AGENT_WIDTH,
  CONTROLLED_JUMP_MIN_ENERGY_COST,
  CONTROLLED_JUMP_MIN_POWER_RATIO,
  ENERGY_REGEN_RATE,
  FALL_BOUNDARY,
  FRICTION,
  GRAVITY,
  JUMP_ENERGY_COST,
  JUMP_STRENGTH,
  JUMP_PRESS_THRESHOLD,
  JUMP_RELEASE_THRESHOLD,
  MAX_SPEED,
  MIN_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_Y,
  PLATFORM_HEIGHT,
  PLATFORM_MAX_WIDTH,
  PLATFORM_MIN_WIDTH,
  PLATFORM_SPAWN_BUFFER,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
  BRANCH_STRUCTURE_MIN_X,
  BRANCH_STRUCTURE_BASE_CHANCE,
  BRANCH_STRUCTURE_MAX_CHANCE,
  SPRINT_ACCELERATION_MULTIPLIER,
  TAG_COOLDOWN,
  NEW_CHASER_TAG_DELAY_MS,
} from '../constants';

/** The short re-arm delay given to the newly tagged chaser in the visual game. */

export interface SimulationActionDecision {
  /** Primary label for diagnostics only. Physics uses the factorized controls below when supplied. */
  action?: string;
  /** Legacy/scripted strength fallback. */
  strength?: number;
  moveLeft?: number;
  moveRight?: number;
  jump?: number;
  sprint?: number;
}

export interface AgentPhysicsStepResult {
  agent: AgentState;
  fell: boolean;
  jumped: boolean;
  jumpVelocity: number;
  roleAtStep: 'chaser' | 'evader';
}

export interface TagTransition {
  taggerId: number;
  taggedId: number;
  survivalTimeMs: number;
  timeToTagMs: number;
  position: { x: number; y: number };
}

export function advanceRoleTimers(agents: AgentState[], deltaTime: number): void {
  for (const agent of agents) {
    if (agent.status === AgentStatus.It) {
      agent.timeSinceBecameIt = (agent.timeSinceBecameIt || 0) + deltaTime;
      agent.survivalTime = 0;
    } else {
      agent.survivalTime = (agent.survivalTime || 0) + deltaTime;
      agent.timeSinceBecameIt = 0;
    }
  }
}

/**
 * Pure per-body physics step used by both the champion view and headless training.
 * `allAgentsBeforePhysics` deliberately contains the pre-physics positions of every body,
 * matching the old visual Array.map semantics used by fair respawn collision avoidance.
 */
export interface MutableAgentPhysicsStepResult {
  fell: boolean;
  jumped: boolean;
  jumpVelocity: number;
  roleAtStep: 'chaser' | 'evader';
}

/**
 * Allocation-light training physics path. It executes the same equations and collision order as
 * `stepAgentPhysics`, but mutates the supplied AgentState and optional result buffer in place.
 * `allAgentsBeforePhysics` must contain pre-step positions for every body so fair respawn remains
 * identical to the visual Array.map semantics.
 */
export function stepAgentPhysicsInPlace(
  agent: AgentState,
  allAgentsBeforePhysics: AgentState[],
  platforms: PlatformState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  deltaTime: number,
  decision: SimulationActionDecision,
  upgrades: ActiveUpgradeState,
  resultBuffer?: MutableAgentPhysicsStepResult
): MutableAgentPhysicsStepResult {
  let velocityX = agent.velocity.x;
  let velocityY = agent.velocity.y;
  let positionX = agent.position.x;
  let positionY = agent.position.y;
  let cooldownTimer = Math.max(0, (agent.cooldownTimer || 0) - deltaTime);
  let energy = agent.energy;
  let status = agent.status;

  if (status === AgentStatus.Cooldown && cooldownTimer === 0) status = AgentStatus.Normal;

  const action = decision.action || agent.lastAction || 'idle';
  const isChaserRole = agent.status === AgentStatus.It;
  const roleAtStep: 'chaser' | 'evader' = isChaserRole ? 'chaser' : 'evader';

  const sprintEnabledForRole = upgrades.sprint && (isChaserRole ? upgrades.sprintChaser : upgrades.sprintRunner);
  const controlledJumpEnabledForRole = upgrades.controlledJump &&
    (isChaserRole ? upgrades.controlledJumpChaser : upgrades.controlledJumpRunner);
  const roleBaseMaxSpeed = isChaserRole
    ? (upgrades.chaserBaseMaxSpeed ?? MAX_SPEED)
    : (upgrades.runnerBaseMaxSpeed ?? MAX_SPEED);
  const roleSprintMaxSpeed = isChaserRole ? upgrades.sprintChaserMaxSpeed : upgrades.sprintRunnerMaxSpeed;
  const roleSprintStaminaCost = isChaserRole
    ? upgrades.sprintChaserStaminaCostPerSec
    : upgrades.sprintRunnerStaminaCostPerSec;

  // Factorized policy controls. Scripted pre-roll callers may still provide only the legacy action
  // label; those are converted to full-strength base controls so the scripted world remains valid.
  const hasFactorizedControls =
    decision.moveLeft !== undefined || decision.moveRight !== undefined ||
    decision.jump !== undefined || decision.sprint !== undefined;
  let moveLeft = 0;
  let moveRight = 0;
  let jumpControl = 0;
  let sprintControl = 0;
  if (hasFactorizedControls) {
    moveLeft = Math.max(0, Math.min(1, decision.moveLeft || 0));
    moveRight = Math.max(0, Math.min(1, decision.moveRight || 0));
    jumpControl = Math.max(0, Math.min(1, decision.jump || 0));
    sprintControl = Math.max(0, Math.min(1, decision.sprint || 0));
  } else {
    if (action === 'move_left') moveLeft = 1;
    else if (action === 'move_right') moveRight = 1;
    else if (action === 'jump') jumpControl = Math.max(POLICY_CONTROL_ACTIVE_THRESHOLD, decision.strength ?? 1);
  }

  const horizontalDrive = Math.max(-1, Math.min(1, moveRight - moveLeft));
  const sprintHeld = sprintEnabledForRole && sprintControl >= POLICY_CONTROL_ACTIVE_THRESHOLD;
  // Releasing Sprint is what permits stamina recovery. A saturated Sprint output while standing
  // still no longer has a free neutral effect: it blocks regeneration, giving temporal control of
  // sprint a real purpose without charging stamina for acceleration that was never produced.
  if (!sprintHeld) {
    energy = Math.min(agent.maxEnergy, energy + ENERGY_REGEN_RATE * (deltaTime / 1000));
  }
  const sprintIntensity =
    sprintHeld && Math.abs(horizontalDrive) >= POLICY_CONTROL_ACTIVE_THRESHOLD && energy > 0
      ? sprintControl
      : 0;
  const accelerationScale = 1 + (SPRINT_ACCELERATION_MULTIPLIER - 1) * sprintIntensity;
  const accelerationX = AGENT_ACCELERATION * horizontalDrive * accelerationScale;

  if (Math.abs(accelerationX) < 0.1) velocityX *= FRICTION;
  velocityX += accelerationX;
  const maxHorizontalSpeed = roleBaseMaxSpeed + (roleSprintMaxSpeed - roleBaseMaxSpeed) * sprintIntensity;
  velocityX = Math.max(-maxHorizontalSpeed, Math.min(maxHorizontalSpeed, velocityX));
  if (sprintIntensity > 0) {
    energy = Math.max(0, energy - roleSprintStaminaCost * sprintIntensity * (deltaTime / 1000));
  }

  let jumpPower = 0;
  let jumped = false;
  let jumpVelocity = 0;
  let jumpArmed = agent.jumpArmed !== false;
  if (jumpControl <= JUMP_RELEASE_THRESHOLD) jumpArmed = true;
  if (jumpArmed && jumpControl >= JUMP_PRESS_THRESHOLD && agent.isOnGround) {
    jumpPower = controlledJumpEnabledForRole
      ? CONTROLLED_JUMP_MIN_POWER_RATIO + (1 - CONTROLLED_JUMP_MIN_POWER_RATIO) * jumpControl
      : 1;
    const jumpCost = controlledJumpEnabledForRole
      ? CONTROLLED_JUMP_MIN_ENERGY_COST +
        (JUMP_ENERGY_COST - CONTROLLED_JUMP_MIN_ENERGY_COST) * jumpPower * jumpPower
      : JUMP_ENERGY_COST;
    if (energy >= jumpCost) {
      velocityY = JUMP_STRENGTH * jumpPower;
      jumpVelocity = velocityY;
      energy -= jumpCost;
      jumped = true;
      jumpArmed = false;
    }
  }

  velocityY += GRAVITY;
  positionX += velocityX;
  positionY += velocityY;

  // Horizontal camera bounds are presentation-only. World-space motion is never clamped to the viewport.
  let grounded = false;
  let landedPlatformId = agent.lastPlatformId;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const prevBottom = agent.position.y + AGENT_HEIGHT;
    const newBottom = positionY + AGENT_HEIGHT;
    const aligned =
      positionX + AGENT_WIDTH > platform.position.x &&
      positionX < platform.position.x + platform.width;
    if (aligned && prevBottom <= platform.position.y + 8 && newBottom >= platform.position.y && velocityY >= 0) {
      positionY = platform.position.y - AGENT_HEIGHT;
      velocityY = 0;
      grounded = true;
      landedPlatformId = platform.id;
      break;
    }
  }

  let checkpointX = agent.positionAtLastTakeoff.x;
  let checkpointY = agent.positionAtLastTakeoff.y;
  let checkpointEnergy = agent.energyAtLastTakeoff;
  if (grounded) {
    checkpointX = positionX;
    checkpointY = positionY;
    checkpointEnergy = energy;
  }

  let fell = false;
  if (positionY > FALL_BOUNDARY) {
    fell = true;
    const respawn = getFairRespawn(agent, platforms, allAgentsBeforePhysics);
    positionX = respawn.position.x;
    positionY = respawn.position.y;
    velocityX = 0;
    velocityY = 0;
    grounded = true;
    landedPlatformId = respawn.platformId;
    checkpointX = positionX;
    checkpointY = positionY;
    checkpointEnergy = energy;
    // In pursuit-balance experiments, a Runner fall is already a full competitive failure.
    // Give the fairly-respawned Runner a brief non-stacking recovery window so the Chaser cannot
    // immediately turn the same mistake into a second event simply by standing on the checkpoint.
    if (roleAtStep === 'evader' && (upgrades.postFallRunnerTagProtectionMs || 0) > 0) {
      cooldownTimer = Math.max(cooldownTimer, upgrades.postFallRunnerTagProtectionMs || 0);
    }
  }

  // Mutate existing nested objects rather than replacing them; these are the hot allocations
  // eliminated by the headless training path.
  agent.position.x = positionX;
  agent.position.y = positionY;
  agent.velocity.x = velocityX;
  agent.velocity.y = velocityY;
  agent.acceleration.x = accelerationX;
  agent.isOnGround = grounded;
  agent.energy = energy;
  agent.status = status;
  agent.cooldownTimer = cooldownTimer;
  const horizontalLabel = horizontalDrive > POLICY_CONTROL_ACTIVE_THRESHOLD
    ? 'move_right'
    : horizontalDrive < -POLICY_CONTROL_ACTIVE_THRESHOLD
      ? 'move_left'
      : '';
  const jumpLabel = jumpControl >= POLICY_CONTROL_ACTIVE_THRESHOLD ? 'jump' : '';
  const sprintLabel = sprintIntensity >= POLICY_CONTROL_ACTIVE_THRESHOLD ? 'sprint' : '';
  agent.lastAction = [horizontalLabel, jumpLabel, sprintLabel].filter(Boolean).join('+') || 'idle';
  agent.lastPlatformId = landedPlatformId;
  agent.positionAtLastTakeoff.x = checkpointX;
  agent.positionAtLastTakeoff.y = checkpointY;
  agent.energyAtLastTakeoff = checkpointEnergy;
  agent.sprintIntensity = sprintIntensity;
  agent.jumpPower = jumpPower;
  agent.jumpArmed = jumpArmed;
  agent.survivalTime = agent.survivalTime || 0;
  agent.timeSinceBecameIt = agent.timeSinceBecameIt || 0;

  const result = resultBuffer || { fell: false, jumped: false, jumpVelocity: 0, roleAtStep };
  result.fell = fell;
  result.jumped = jumped;
  result.jumpVelocity = jumpVelocity;
  result.roleAtStep = roleAtStep;
  return result;
}

/**
 * Pure per-body wrapper retained for the visual React path. It clones one body, then delegates to
 * the same in-place implementation used by training, ensuring physics equations cannot drift.
 */
export function stepAgentPhysics(
  agent: AgentState,
  allAgentsBeforePhysics: AgentState[],
  platforms: PlatformState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  deltaTime: number,
  decision: SimulationActionDecision,
  upgrades: ActiveUpgradeState
): AgentPhysicsStepResult {
  const nextAgent: AgentState = {
    ...agent,
    position: { ...agent.position },
    velocity: { ...agent.velocity },
    acceleration: { ...agent.acceleration },
    positionAtLastTakeoff: { ...agent.positionAtLastTakeoff },
  };
  const physics = stepAgentPhysicsInPlace(
    nextAgent,
    allAgentsBeforePhysics,
    platforms,
    cameraX,
    viewportSize,
    deltaTime,
    decision,
    upgrades
  );
  return { agent: nextAgent, ...physics };
}

/** Detect the first valid physical contact and apply the visual game's role/cooldown swap in place. */
export function resolveTagSwap(agents: AgentState[]): TagTransition | null {
  const itAgent = agents.find(a => a.status === AgentStatus.It);
  if (!itAgent || (itAgent.cooldownTimer || 0) > 0) return null;

  const taggedAgent = agents.find(otherAgent => {
    if (
      otherAgent.id === itAgent.id ||
      otherAgent.status === AgentStatus.It ||
      (otherAgent.cooldownTimer || 0) > 0
    ) return false;

    const dx = itAgent.position.x + AGENT_WIDTH / 2 - (otherAgent.position.x + AGENT_WIDTH / 2);
    const dy = itAgent.position.y + AGENT_HEIGHT / 2 - (otherAgent.position.y + AGENT_HEIGHT / 2);
    return Math.hypot(dx, dy) < (AGENT_WIDTH + AGENT_HEIGHT) / 2;
  });
  if (!taggedAgent) return null;

  const transition: TagTransition = {
    taggerId: itAgent.id,
    taggedId: taggedAgent.id,
    survivalTimeMs: Math.max(taggedAgent.survivalTime || 0, 100),
    timeToTagMs: Math.max(itAgent.timeSinceBecameIt || 0, 100),
    position: { ...taggedAgent.position },
  };

  taggedAgent.status = AgentStatus.It;
  taggedAgent.role = 'chaser';
  taggedAgent.cooldownTimer = NEW_CHASER_TAG_DELAY_MS;
  taggedAgent.survivalTime = 0;
  taggedAgent.timeSinceBecameIt = 0;
  taggedAgent.modelId = 'current_chaser';

  itAgent.status = AgentStatus.Cooldown;
  itAgent.role = 'evader';
  itAgent.cooldownTimer = TAG_COOLDOWN;
  itAgent.survivalTime = 0;
  itAgent.timeSinceBecameIt = 0;
  itAgent.modelId = 'current_evader';

  return transition;
}

/**
 * Presentation/rolling-world camera rule centered on the active chase pair. The camera is
 * observational only: physics and policy inputs never depend on this value.
 */
export function updateChaseCameraX(agents: AgentState[], currentCameraX: number, viewportWidth: number): number {
  if (agents.length === 0) return currentCameraX;

  let chaser: AgentState | null = null;
  for (let i = 0; i < agents.length; i++) {
    if (agents[i].status === AgentStatus.It) {
      chaser = agents[i];
      break;
    }
  }

  let centerX = 0;
  if (chaser) {
    const chaserCenter = chaser.position.x + AGENT_WIDTH / 2;
    let nearestRunner: AgentState | null = null;
    let nearestDistanceSq = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const candidate = agents[i];
      if (candidate.id === chaser.id || candidate.status === AgentStatus.It) continue;
      const dx = candidate.position.x - chaser.position.x;
      const dy = candidate.position.y - chaser.position.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestRunner = candidate;
      }
    }
    if (nearestRunner) {
      const runnerCenter = nearestRunner.position.x + AGENT_WIDTH / 2;
      centerX = (chaserCenter + runnerCenter) / 2;
    } else {
      centerX = chaserCenter;
    }
  } else {
    for (let i = 0; i < agents.length; i++) centerX += agents[i].position.x + AGENT_WIDTH / 2;
    centerX /= agents.length;
  }

  const desiredCameraX = centerX - viewportWidth / 2;
  return currentCameraX + (desiredCameraX - currentCameraX) * 0.12;
}

function generatePlatform(
  baseX: number,
  baseY: number,
  viewportHeight: number,
  id: number,
  rng: () => number,
  toLeft = false
): PlatformState {
  let gapX = MIN_PLATFORM_GAP_X + rng() * (MAX_PLATFORM_GAP_X - MIN_PLATFORM_GAP_X);
  const gapY = (rng() - 0.5) * MAX_PLATFORM_GAP_Y * 1.5;
  const newY = baseY + gapY;
  const clampedY = Math.min(viewportHeight - 120, Math.max(250, newY));
  const verticalDifference = clampedY - baseY;

  if (verticalDifference < -100) gapX = Math.max(MIN_PLATFORM_GAP_X, Math.min(gapX, 90));
  else if (verticalDifference > 80) gapX = Math.max(gapX, 140);

  const newWidth = rng() * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH) + PLATFORM_MIN_WIDTH;
  return {
    id,
    width: newWidth,
    height: PLATFORM_HEIGHT,
    structureType: 'normal',
    position: {
      x: toLeft ? baseX - newWidth - gapX : baseX + gapX,
      y: clampedY,
    },
  };
}

function clampPlatformY(y: number, viewportHeight: number): number {
  return Math.min(viewportHeight - 120, Math.max(250, y));
}

function branchChanceAtX(x: number, branchMinX = BRANCH_STRUCTURE_MIN_X): number {
  if (x < branchMinX) return 0;
  // Front-load meaningful route choice so agents encounter it during early training, then keep a
  // gradually increasing background probability farther into the infinite level. The two early
  // windows intentionally overlap the ~600–800px and ~1200–1500px regions identified by the
  // pursuit experiments as the right exposure points.
  if (x <= branchMinX + 250) return Math.max(0.55, BRANCH_STRUCTURE_BASE_CHANCE);
  if (x >= 1150 && x <= 1550) return Math.max(0.45, BRANCH_STRUCTURE_BASE_CHANCE);
  const t = Math.max(0, Math.min(1, (x - branchMinX) / 7000));
  return BRANCH_STRUCTURE_BASE_CHANCE + (BRANCH_STRUCTURE_MAX_CHANCE - BRANCH_STRUCTURE_BASE_CHANCE) * t;
}

function appendForwardSegment(
  platforms: PlatformState[],
  rightmostPlatform: PlatformState,
  viewportHeight: number,
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X
): { rightmost: PlatformState; nextPlatformId: number } {
  const baseRight = rightmostPlatform.position.x + rightmostPlatform.width;
  let latestBranchX = -Infinity;
  let visibleEarlyBranchCount = 0;
  for (let i = platforms.length - 1; i >= 0; i--) {
    const candidate = platforms[i];
    if (candidate.structureType === 'merge') {
      latestBranchX = Math.max(latestBranchX, candidate.position.x);
      if (candidate.position.x < 1700 && candidate.position.x >= branchMinX) visibleEarlyBranchCount++;
    }
  }
  // Every branch group has exactly one merge platform. Guarantee exposure if the RNG misses the
  // early curriculum windows, and later prevent very long stretches of featureless terrain.
  const branchGroupsSeenEarly = visibleEarlyBranchCount;
  const forceFirstEarlyBranch = branchGroupsSeenEarly === 0 && baseRight >= branchMinX + 200 && baseRight <= 1150;
  const forceSecondEarlyBranch = branchGroupsSeenEarly === 1 && baseRight >= 1450 && baseRight <= 1850;
  const forceRecurringBranch = baseRight > 1850 && (!Number.isFinite(latestBranchX) || baseRight - latestBranchX >= 1400);
  const shouldBranch = forceFirstEarlyBranch || forceSecondEarlyBranch || forceRecurringBranch || rng() < branchChanceAtX(baseRight, branchMinX);
  if (!shouldBranch) {
    const p = generatePlatform(baseRight, rightmostPlatform.position.y, viewportHeight, nextPlatformId++, rng);
    platforms.push(p);
    return { rightmost: p, nextPlatformId };
  }

  const groupId = nextPlatformId;
  const entryGap = 70 + rng() * 55;
  const upperWidth = 200 + rng() * 90;
  const lowerWidth = 230 + rng() * 100;
  const upperX = baseRight + entryGap;
  const lowerX = baseRight + entryGap + 20 + rng() * 35;
  const upperY = clampPlatformY(rightmostPlatform.position.y - (75 + rng() * 55), viewportHeight);
  const lowerY = clampPlatformY(rightmostPlatform.position.y + (55 + rng() * 65), viewportHeight);
  const upper: PlatformState = {
    id: nextPlatformId++, width: upperWidth, height: PLATFORM_HEIGHT,
    position: { x: upperX, y: upperY }, structureType: 'branch-upper', branchGroupId: groupId,
  };
  const lower: PlatformState = {
    id: nextPlatformId++, width: lowerWidth, height: PLATFORM_HEIGHT,
    position: { x: lowerX, y: lowerY }, structureType: 'branch-lower', branchGroupId: groupId,
  };
  const branchEnd = Math.max(upperX + upperWidth, lowerX + lowerWidth);
  const mergeGap = 75 + rng() * 55;
  const mergeWidth = 250 + rng() * 100;
  const mergeY = clampPlatformY(rightmostPlatform.position.y + (rng() - 0.5) * 60, viewportHeight);
  const merge: PlatformState = {
    id: nextPlatformId++, width: mergeWidth, height: PLATFORM_HEIGHT,
    position: { x: branchEnd + mergeGap, y: mergeY }, structureType: 'merge', branchGroupId: groupId,
  };

  // Keep x-order because rolling generation relies on the last entry being the forward-most segment.
  if (upper.position.x <= lower.position.x) platforms.push(upper, lower, merge);
  else platforms.push(lower, upper, merge);
  return { rightmost: merge, nextPlatformId };
}

/**
 * Allocation-light rolling platform maintenance for headless training. The same x-ordered retention
 * and generation rules are applied directly to the supplied array. Returns the next platform id.
 */
export function maintainPlatformsForCameraInPlace(
  platforms: PlatformState[],
  agents: AgentState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X
): number {
  let leftmostAgentX = cameraX;
  let rightmostAgentX = cameraX + viewportSize.width;
  if (agents.length > 0) {
    leftmostAgentX = Infinity;
    rightmostAgentX = -Infinity;
    for (let i = 0; i < agents.length; i++) {
      leftmostAgentX = Math.min(leftmostAgentX, agents[i].position.x);
      rightmostAgentX = Math.max(rightmostAgentX, agents[i].position.x + AGENT_WIDTH);
    }
  }
  const rightGenerationEdge = Math.max(
    cameraX + viewportSize.width + PLATFORM_SPAWN_BUFFER,
    rightmostAgentX + PLATFORM_SPAWN_BUFFER
  );
  const leftGenerationEdge = Math.min(cameraX - PLATFORM_SPAWN_BUFFER, leftmostAgentX - PLATFORM_SPAWN_BUFFER);
  const despawnMargin = PLATFORM_SPAWN_BUFFER * 2;
  const minKeepX = Math.min(cameraX - despawnMargin, leftmostAgentX - despawnMargin);
  const maxKeepX = Math.max(cameraX + viewportSize.width + despawnMargin, rightmostAgentX + despawnMargin);

  let write = 0;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    let protectedPlatform = false;
    for (let j = 0; j < agents.length; j++) {
      if (agents[j].lastPlatformId === platform.id) {
        protectedPlatform = true;
        break;
      }
    }
    if (protectedPlatform || (platform.position.x + platform.width > minKeepX && platform.position.x < maxKeepX)) {
      if (write !== i) platforms[write] = platform;
      write++;
    }
  }
  platforms.length = write;

  if (platforms.length > 0) {
    let rightmostPlatform = platforms[platforms.length - 1];
    while (rightmostPlatform.position.x + rightmostPlatform.width < rightGenerationEdge) {
      const generated = appendForwardSegment(platforms, rightmostPlatform, viewportSize.height, nextPlatformId, rng, branchMinX);
      rightmostPlatform = generated.rightmost;
      nextPlatformId = generated.nextPlatformId;
    }
  }

  if (platforms.length > 0) {
    let leftmostPlatform = platforms[0];
    while (leftmostPlatform.position.x > leftGenerationEdge) {
      const newPlatform = generatePlatform(
        leftmostPlatform.position.x,
        leftmostPlatform.position.y,
        viewportSize.height,
        nextPlatformId++,
        rng,
        true
      );
      platforms.unshift(newPlatform);
      leftmostPlatform = newPlatform;
    }
  }

  return nextPlatformId;
}

/**
 * Exact rolling platform retention/generation rule from the visual simulation. The caller supplies
 * Math.random for the visible game and a seeded RNG for deterministic/common-random-number training.
 */
export function maintainPlatformsForCamera(
  platforms: PlatformState[],
  agents: AgentState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X
): { platforms: PlatformState[]; nextPlatformId: number } {
  let leftmostAgentX = cameraX;
  let rightmostAgentX = cameraX + viewportSize.width;
  if (agents.length > 0) {
    leftmostAgentX = Infinity;
    rightmostAgentX = -Infinity;
    for (let i = 0; i < agents.length; i++) {
      leftmostAgentX = Math.min(leftmostAgentX, agents[i].position.x);
      rightmostAgentX = Math.max(rightmostAgentX, agents[i].position.x + AGENT_WIDTH);
    }
  }
  const rightGenerationEdge = Math.max(
    cameraX + viewportSize.width + PLATFORM_SPAWN_BUFFER,
    rightmostAgentX + PLATFORM_SPAWN_BUFFER
  );
  const leftGenerationEdge = Math.min(cameraX - PLATFORM_SPAWN_BUFFER, leftmostAgentX - PLATFORM_SPAWN_BUFFER);
  const despawnMargin = PLATFORM_SPAWN_BUFFER * 2;
  const minKeepX = Math.min(cameraX - despawnMargin, leftmostAgentX - despawnMargin);
  const maxKeepX = Math.max(cameraX + viewportSize.width + despawnMargin, rightmostAgentX + despawnMargin);
  // At most three platform ids are protected. Avoid Set/map/filter/sort allocations in this
  // per-physics-step path. `platforms` is already maintained in x-order by push/unshift, and
  // filtering preserves that order exactly.
  const protectedIds: number[] = [];
  for (let i = 0; i < agents.length; i++) {
    const id = agents[i].lastPlatformId;
    if (id !== null && id !== undefined && !protectedIds.includes(id)) protectedIds.push(id);
  }
  const retained: PlatformState[] = [];
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    let protectedPlatform = false;
    for (let j = 0; j < protectedIds.length; j++) {
      if (protectedIds[j] === p.id) {
        protectedPlatform = true;
        break;
      }
    }
    if (protectedPlatform || (p.position.x + p.width > minKeepX && p.position.x < maxKeepX)) {
      retained.push(p);
    }
  }

  if (retained.length > 0) {
    let rightmostPlatform = retained[retained.length - 1];
    while (rightmostPlatform.position.x + rightmostPlatform.width < rightGenerationEdge) {
      const generated = appendForwardSegment(retained, rightmostPlatform, viewportSize.height, nextPlatformId, rng, branchMinX);
      rightmostPlatform = generated.rightmost;
      nextPlatformId = generated.nextPlatformId;
    }
  }

  if (retained.length > 0) {
    let leftmostPlatform = retained[0];
    while (leftmostPlatform.position.x > leftGenerationEdge) {
      const newPlatform = generatePlatform(
        leftmostPlatform.position.x,
        leftmostPlatform.position.y,
        viewportSize.height,
        nextPlatformId++,
        rng,
        true
      );
      retained.unshift(newPlatform);
      leftmostPlatform = newPlatform;
    }
  }

  return { platforms: retained, nextPlatformId };
}
