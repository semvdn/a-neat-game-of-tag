import type { ActiveUpgradeState, AgentState, PlatformState, TerrainRuntimeConfig } from '../types';
import { AgentStatus } from '../types';
import { getFairRespawn } from './respawn';
import { applyPlatformRoute, canAgentUsePlatform, canAgentsPhysicallyInteract } from './terrainRoutes';
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
  CAMERA_FRAME_PADDING_REFERENCE_PX,
  CAMERA_MIN_USEFUL_AUTO_ZOOM,
  CHASE_ESCAPE_MAX_GROUP_SPAN_X,
  CHASE_ESCAPE_MAX_GROUP_SPAN_Y,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
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

export interface ChaseEscapeEvaluation {
  escaped: boolean;
  chaserId: number | null;
  runnerCount: number;
  groupSpanX: number;
  groupSpanY: number;
  maxChaserRunnerDistancePx: number;
  /** Reference-view zoom needed to keep the full chase group inside the safe camera frame. */
  requiredReferenceZoom: number;
}

/**
 * Detect when the active Chaser has lost the Runner group beyond the minimum useful camera frame.
 * This deliberately uses the invariant 1200x800 world reference rather than DOM dimensions, so
 * the exact same separation is an escape in workers, benchmarks and the champion view.
 */
export function evaluateChaseEscape(agents: AgentState[]): ChaseEscapeEvaluation {
  const chaser = agents.find(agent => agent.status === AgentStatus.It) || null;
  const runners = chaser ? agents.filter(agent => agent.id !== chaser.id && agent.status !== AgentStatus.It) : [];
  if (!chaser || runners.length === 0) {
    return {
      escaped: false,
      chaserId: chaser?.id ?? null,
      runnerCount: runners.length,
      groupSpanX: 0,
      groupSpanY: 0,
      maxChaserRunnerDistancePx: 0,
      requiredReferenceZoom: Infinity,
    };
  }

  const chaseGroup = [chaser, ...runners];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const agent of chaseGroup) {
    minX = Math.min(minX, agent.position.x);
    maxX = Math.max(maxX, agent.position.x + AGENT_WIDTH);
    minY = Math.min(minY, agent.position.y);
    maxY = Math.max(maxY, agent.position.y + AGENT_HEIGHT);
  }

  const groupSpanX = Math.max(AGENT_WIDTH, maxX - minX);
  const groupSpanY = Math.max(AGENT_HEIGHT, maxY - minY);
  const safeReferenceWidth = Math.max(1, WORLD_REF_WIDTH - CAMERA_FRAME_PADDING_REFERENCE_PX * 2);
  const safeReferenceHeight = Math.max(1, WORLD_REF_HEIGHT - CAMERA_FRAME_PADDING_REFERENCE_PX * 2);
  const requiredReferenceZoom = Math.min(
    safeReferenceWidth / groupSpanX,
    safeReferenceHeight / groupSpanY
  );

  const cx = chaser.position.x + AGENT_WIDTH / 2;
  const cy = chaser.position.y + AGENT_HEIGHT / 2;
  let maxChaserRunnerDistancePx = 0;
  for (const runner of runners) {
    const rx = runner.position.x + AGENT_WIDTH / 2;
    const ry = runner.position.y + AGENT_HEIGHT / 2;
    maxChaserRunnerDistancePx = Math.max(maxChaserRunnerDistancePx, Math.hypot(rx - cx, ry - cy));
  }

  return {
    escaped:
      groupSpanX > CHASE_ESCAPE_MAX_GROUP_SPAN_X ||
      groupSpanY > CHASE_ESCAPE_MAX_GROUP_SPAN_Y ||
      requiredReferenceZoom < CAMERA_MIN_USEFUL_AUTO_ZOOM,
    chaserId: chaser.id,
    runnerCount: runners.length,
    groupSpanX,
    groupSpanY,
    maxChaserRunnerDistancePx,
    requiredReferenceZoom,
  };
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
    if (!canAgentUsePlatform(agent, platform)) continue;
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
      applyPlatformRoute(agent, platform);
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
    applyPlatformRoute(agent, platforms.find(platform => platform.id === respawn.platformId));
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
      (otherAgent.cooldownTimer || 0) > 0 ||
      !canAgentsPhysicallyInteract(itAgent, otherAgent)
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

const DEFAULT_TERRAIN_RUNTIME: TerrainRuntimeConfig = {
  branchingEnabled: true,
  branchSpawnChance: BRANCH_STRUCTURE_BASE_CHANCE,
  guaranteeBranchExposure: true,
  movingPlatformsEnabled: false,
  movingSpawnChance: 0,
  guaranteeMovingExposure: false,
  movingPlatformMaxSpeed: 0,
  maxPlatformsPerBranch: 3,
  subBranchingEnabled: false,
  maxBranchDepth: 1,
  movingPlatformsInBranches: false,
};

function resolvedTerrainRuntime(value?: TerrainRuntimeConfig): TerrainRuntimeConfig {
  return value || DEFAULT_TERRAIN_RUNTIME;
}

function maybeMakeMoving(
  platform: PlatformState,
  viewportHeight: number,
  rng: () => number,
  terrain: TerrainRuntimeConfig,
  inBranch: boolean,
  force = false
): PlatformState {
  if (!terrain.movingPlatformsEnabled || terrain.movingPlatformMaxSpeed <= 0) return platform;
  if (inBranch && !terrain.movingPlatformsInBranches) return platform;
  if (!force && rng() >= terrain.movingSpawnChance) return platform;

  const maxSpeed = Math.max(0, terrain.movingPlatformMaxSpeed);
  const minSpeed = Math.min(24, maxSpeed);
  const speed = minSpeed + rng() * Math.max(0, maxSpeed - minSpeed);
  let axis: 'x' | 'y' = rng() < 0.6 ? 'x' : 'y';
  let range = axis === 'x' ? 35 + rng() * 85 : 28 + rng() * 62;

  if (axis === 'y') {
    const minAllowed = 230;
    const maxAllowed = viewportHeight - 105;
    const min = Math.max(minAllowed, platform.position.y - range);
    const max = Math.min(maxAllowed, platform.position.y + range);
    if (max - min < 35) {
      axis = 'x';
      range = 35 + rng() * 85;
    } else {
      platform.motion = { axis, min, max, speed, direction: rng() < 0.5 ? -1 : 1 };
      return platform;
    }
  }

  platform.motion = {
    axis: 'x',
    min: platform.position.x - range,
    max: platform.position.x + range,
    speed,
    direction: rng() < 0.5 ? -1 : 1,
  };
  return platform;
}

function generatePlatform(
  baseX: number,
  baseY: number,
  viewportHeight: number,
  id: number,
  rng: () => number,
  toLeft = false,
  terrain: TerrainRuntimeConfig = DEFAULT_TERRAIN_RUNTIME,
  forceMoving = false
): PlatformState {
  let gapX = MIN_PLATFORM_GAP_X + rng() * (MAX_PLATFORM_GAP_X - MIN_PLATFORM_GAP_X);
  const gapY = (rng() - 0.5) * MAX_PLATFORM_GAP_Y * 1.5;
  const newY = baseY + gapY;
  const clampedY = Math.min(viewportHeight - 120, Math.max(250, newY));
  const verticalDifference = clampedY - baseY;

  if (verticalDifference < -100) gapX = Math.max(MIN_PLATFORM_GAP_X, Math.min(gapX, 90));
  else if (verticalDifference > 80) gapX = Math.max(gapX, 140);

  const newWidth = rng() * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH) + PLATFORM_MIN_WIDTH;
  return maybeMakeMoving({
    id,
    width: newWidth,
    height: PLATFORM_HEIGHT,
    structureType: 'normal',
    position: {
      x: toLeft ? baseX - newWidth - gapX : baseX + gapX,
      y: clampedY,
    },
  }, viewportHeight, rng, terrain, false, forceMoving);
}

function clampPlatformY(y: number, viewportHeight: number): number {
  return Math.min(viewportHeight - 120, Math.max(250, y));
}

function branchChanceAtX(x: number, branchMinX: number, terrain: TerrainRuntimeConfig): number {
  if (!terrain.branchingEnabled || x < branchMinX) return 0;
  const configured = Math.max(0, Math.min(1, terrain.branchSpawnChance));
  if (!terrain.guaranteeBranchExposure) return configured;
  if (x <= branchMinX + 800) return Math.max(configured, 0.45);
  if (x >= 1150 && x <= 1750) return Math.max(configured, 0.38);
  const t = Math.max(0, Math.min(1, (x - branchMinX) / 7000));
  return Math.min(BRANCH_STRUCTURE_MAX_CHANCE, configured + 0.08 * t);
}

function routeLanePair(baseY: number, depth: number, viewportHeight: number, rng: () => number): [number, number] {
  const minY = 250;
  const maxY = viewportHeight - 120;
  const available = Math.max(140, maxY - minY);
  const separation = Math.min(available - 20, Math.max(135, 190 - (depth - 1) * 12));
  const half = separation / 2;
  const centerMin = minY + half;
  const centerMax = maxY - half;
  const center = centerMax > centerMin
    ? Math.min(centerMax, Math.max(centerMin, baseY + (rng() - 0.5) * 50))
    : (minY + maxY) / 2;
  return [clampPlatformY(center - half, viewportHeight), clampPlatformY(center + half, viewportHeight)];
}

function branchSpan(terrain: TerrainRuntimeConfig, depth: number): number {
  const localSpan = 280 + Math.max(1, terrain.maxPlatformsPerBranch) * 135;
  if (terrain.subBranchingEnabled && depth < terrain.maxBranchDepth) {
    return localSpan + branchSpan(terrain, depth + 1);
  }
  return localSpan;
}

interface BranchBuildResult {
  merge: PlatformState;
  nextPlatformId: number;
}

function addRoutePlatforms(
  platforms: PlatformState[],
  count: number,
  startX: number,
  endX: number,
  laneY: number,
  side: 'upper' | 'lower',
  routePath: string,
  groupId: number,
  rootGroupId: number,
  depth: number,
  viewportHeight: number,
  nextPlatformId: number,
  rng: () => number,
  terrain: TerrainRuntimeConfig,
  forceFirstMoving = false
): { last: PlatformState; nextPlatformId: number } {
  const safeCount = Math.max(1, count);
  const span = Math.max(180, endX - startX);
  const preferredWidth = Math.max(125, Math.min(220, span / safeCount - 55));
  let last: PlatformState | null = null;

  for (let i = 0; i < safeCount; i++) {
    const slotStart = startX + (span * i) / safeCount;
    const slotEnd = startX + (span * (i + 1)) / safeCount;
    const slotWidth = slotEnd - slotStart;
    const width = Math.max(115, Math.min(preferredWidth + (rng() - 0.5) * 35, slotWidth - 28));
    const x = slotStart + Math.max(14, (slotWidth - width) * 0.5);
    const y = clampPlatformY(laneY + (rng() - 0.5) * 34, viewportHeight);
    const platform = maybeMakeMoving({
      id: nextPlatformId++,
      width,
      height: PLATFORM_HEIGHT,
      position: { x, y },
      structureType: side === 'upper' ? 'branch-upper' : 'branch-lower',
      branchGroupId: groupId,
      branchDepth: depth,
      routePath,
      rootBranchGroupId: rootGroupId,
    }, viewportHeight, rng, terrain, true, forceFirstMoving && i === 0);
    platforms.push(platform);
    last = platform;
  }

  return { last: last!, nextPlatformId };
}

/** Build a full binary branch tree. Every route at a level gets the same horizontal allocation,
 * so recursively branching siblings still arrive at the same outer merge. Collision route locks,
 * not merely vertical spacing, make sibling paths truly mutually exclusive. */
function buildBranchTree(
  platforms: PlatformState[],
  entryPlatform: PlatformState,
  viewportHeight: number,
  nextPlatformId: number,
  rng: () => number,
  terrain: TerrainRuntimeConfig,
  depth: number,
  parentRoutePath: string | null,
  rootGroupId: number,
  forcedMergeRightX?: number,
  forceMovingExposure = false
): BranchBuildResult {
  const groupId = nextPlatformId;
  const [upperY, lowerY] = routeLanePair(entryPlatform.position.y, depth, viewportHeight, rng);
  const entryRight = entryPlatform.position.x + entryPlatform.width;
  const totalSpan = Math.max(420, forcedMergeRightX !== undefined ? forcedMergeRightX - entryRight : branchSpan(terrain, depth));
  const mergeWidth = 240;
  const mergeRightX = forcedMergeRightX ?? entryRight + totalSpan;
  const mergeLeftX = mergeRightX - mergeWidth;
  const entryGap = 65;
  const mergeGap = 75;
  const routeCount = Math.max(1, 1 + Math.floor(rng() * Math.max(1, terrain.maxPlatformsPerBranch)));
  const hasNested = terrain.subBranchingEnabled && depth < terrain.maxBranchDepth;
  const preCount = hasNested ? Math.max(1, Math.ceil(routeCount / 2)) : routeCount;
  const postCount = hasNested ? Math.max(0, routeCount - preCount) : 0;
  const childSpan = hasNested ? branchSpan(terrain, depth + 1) : 0;
  const availableLocal = Math.max(260, totalSpan - childSpan - mergeWidth);
  const beforeLocal = hasNested ? availableLocal * 0.54 : availableLocal;
  const afterLocal = hasNested ? availableLocal - beforeLocal : 0;

  const branchBaseToken = `g${groupId}`;
  const upperPath = parentRoutePath ? `${parentRoutePath}/${branchBaseToken}U` : `${branchBaseToken}U`;
  const lowerPath = parentRoutePath ? `${parentRoutePath}/${branchBaseToken}L` : `${branchBaseToken}L`;

  const preStart = entryRight + entryGap;
  const preEnd = Math.min(mergeLeftX - mergeGap - 120, entryRight + beforeLocal);
  const upperPre = addRoutePlatforms(platforms, preCount, preStart, preEnd, upperY, 'upper', upperPath, groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain, forceMovingExposure);
  nextPlatformId = upperPre.nextPlatformId;
  const lowerPre = addRoutePlatforms(platforms, preCount, preStart, preEnd, lowerY, 'lower', lowerPath, groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain, forceMovingExposure);
  nextPlatformId = lowerPre.nextPlatformId;

  let upperLast = upperPre.last;
  let lowerLast = lowerPre.last;

  if (hasNested) {
    // Both sibling routes recursively split. Giving both child trees the same merge-right target
    // preserves reachability while still allowing their internal geometry to differ vertically.
    const childEntryRight = Math.max(
      upperLast.position.x + upperLast.width,
      lowerLast.position.x + lowerLast.width
    );
    const childMergeRight = Math.min(mergeLeftX - mergeGap - 90, childEntryRight + childSpan);

    const upperChild = buildBranchTree(platforms, upperLast, viewportHeight, nextPlatformId, rng, terrain, depth + 1, upperPath, rootGroupId, childMergeRight);
    nextPlatformId = upperChild.nextPlatformId;
    upperLast = upperChild.merge;

    const lowerChild = buildBranchTree(platforms, lowerLast, viewportHeight, nextPlatformId, rng, terrain, depth + 1, lowerPath, rootGroupId, childMergeRight);
    nextPlatformId = lowerChild.nextPlatformId;
    lowerLast = lowerChild.merge;

    if (postCount > 0) {
      const postStart = childMergeRight + 55;
      const postEnd = Math.max(postStart + 160, mergeLeftX - mergeGap);
      const upperPost = addRoutePlatforms(platforms, postCount, postStart, postEnd, upperY, 'upper', upperPath, groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain);
      nextPlatformId = upperPost.nextPlatformId;
      upperLast = upperPost.last;
      const lowerPost = addRoutePlatforms(platforms, postCount, postStart, postEnd, lowerY, 'lower', lowerPath, groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain);
      nextPlatformId = lowerPost.nextPlatformId;
      lowerLast = lowerPost.last;
    }
  }

  // Merge platforms stay stationary even when branch moving-platform integration is enabled. This
  // keeps the rejoin point a reliable route-unlock checkpoint while the route itself can move.
  const mergeY = clampPlatformY((upperLast.position.y + lowerLast.position.y) / 2 + (rng() - 0.5) * 24, viewportHeight);
  const merge: PlatformState = {
    id: nextPlatformId++,
    width: mergeWidth,
    height: PLATFORM_HEIGHT,
    position: { x: mergeLeftX, y: mergeY },
    structureType: 'merge',
    branchGroupId: groupId,
    branchDepth: depth,
    mergeToRoutePath: parentRoutePath,
    rootBranchGroupId: rootGroupId,
  };
  platforms.push(merge);
  return { merge, nextPlatformId };
}

function appendForwardSegment(
  platforms: PlatformState[],
  rightmostPlatform: PlatformState,
  viewportHeight: number,
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X,
  terrainValue?: TerrainRuntimeConfig
): { rightmost: PlatformState; nextPlatformId: number } {
  const terrain = resolvedTerrainRuntime(terrainValue);
  const baseRight = rightmostPlatform.position.x + rightmostPlatform.width;
  let latestBranchX = -Infinity;
  let visibleEarlyBranchCount = 0;
  for (let i = platforms.length - 1; i >= 0; i--) {
    const candidate = platforms[i];
    if (candidate.structureType === 'merge' && (candidate.branchDepth || 1) === 1) {
      latestBranchX = Math.max(latestBranchX, candidate.position.x);
      if (candidate.position.x < 1800 && candidate.position.x >= branchMinX) visibleEarlyBranchCount++;
    }
  }

  const forceFirstEarlyBranch = terrain.branchingEnabled && terrain.guaranteeBranchExposure && visibleEarlyBranchCount === 0 && baseRight >= branchMinX && baseRight <= 1750;
  const forceSecondEarlyBranch = terrain.branchingEnabled && terrain.guaranteeBranchExposure && visibleEarlyBranchCount === 1 && baseRight >= 1750 && baseRight <= 2600;
  const forceRecurringBranch = terrain.branchingEnabled && terrain.guaranteeBranchExposure && baseRight > 2600 && (!Number.isFinite(latestBranchX) || baseRight - latestBranchX >= 1500);
  const shouldBranch = terrain.branchingEnabled && (
    forceFirstEarlyBranch || forceSecondEarlyBranch || forceRecurringBranch || rng() < branchChanceAtX(baseRight, branchMinX, terrain)
  );
  const hasMovingPlatform = terrain.guaranteeMovingExposure && platforms.some(platform => !!platform.motion);
  const needsGuaranteedMoving = terrain.movingPlatformsEnabled && terrain.guaranteeMovingExposure && !hasMovingPlatform;

  // A training episode selected for moving terrain must actually expose both policies to it. If
  // moving platforms are disallowed inside branches, emit one guaranteed moving trunk platform
  // before a forced branch rather than letting the feature percentage become merely probabilistic.
  if (needsGuaranteedMoving && shouldBranch && !terrain.movingPlatformsInBranches) {
    const p = generatePlatform(baseRight, rightmostPlatform.position.y, viewportHeight, nextPlatformId++, rng, false, terrain, true);
    platforms.push(p);
    return { rightmost: p, nextPlatformId };
  }

  if (!shouldBranch) {
    const p = generatePlatform(baseRight, rightmostPlatform.position.y, viewportHeight, nextPlatformId++, rng, false, terrain, needsGuaranteedMoving);
    platforms.push(p);
    return { rightmost: p, nextPlatformId };
  }

  const rootGroupId = nextPlatformId;
  const built = buildBranchTree(
    platforms,
    rightmostPlatform,
    viewportHeight,
    nextPlatformId,
    rng,
    terrain,
    1,
    null,
    rootGroupId,
    undefined,
    needsGuaranteedMoving && terrain.movingPlatformsInBranches
  );
  return { rightmost: built.merge, nextPlatformId: built.nextPlatformId };
}

/** Move oscillating platforms and carry bodies that were grounded on them. This runs before policy
 * decisions so recurrent policies observe the platform's current geometry, not its previous frame. */
export function stepMovingPlatformsInPlace(
  platforms: PlatformState[],
  agents: AgentState[],
  deltaTimeMs: number,
  allowBranchMotion = true
): void {
  const dt = Math.max(0, deltaTimeMs) / 1000;
  if (dt <= 0) return;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const motion = platform.motion;
    if (!allowBranchMotion && platform.rootBranchGroupId != null) continue;
    if (!motion || motion.speed <= 0 || motion.max <= motion.min) continue;
    const oldX = platform.position.x;
    const oldY = platform.position.y;
    const coordinate = motion.axis === 'x' ? oldX : oldY;
    let next = coordinate + motion.speed * motion.direction * dt;
    let direction = motion.direction;

    // Reflect overshoot so movement is deterministic even if a frame is unusually long.
    for (let guard = 0; guard < 4 && (next < motion.min || next > motion.max); guard++) {
      if (next > motion.max) {
        next = motion.max - (next - motion.max);
        direction = -1;
      } else if (next < motion.min) {
        next = motion.min + (motion.min - next);
        direction = 1;
      }
    }
    next = Math.max(motion.min, Math.min(motion.max, next));
    motion.direction = direction as -1 | 1;
    if (motion.axis === 'x') platform.position.x = next;
    else platform.position.y = next;

    const dx = platform.position.x - oldX;
    const dy = platform.position.y - oldY;
    if (dx === 0 && dy === 0) continue;
    for (let j = 0; j < agents.length; j++) {
      const agent = agents[j];
      if (!agent.isOnGround || agent.lastPlatformId !== platform.id) continue;
      agent.position.x += dx;
      agent.position.y += dy;
      agent.positionAtLastTakeoff.x += dx;
      agent.positionAtLastTakeoff.y += dy;
    }
  }
}

function activeRootBranchIds(platforms: PlatformState[], protectedIds: number[], minKeepX: number, maxKeepX: number): Set<number> {
  const active = new Set<number>();
  for (const platform of platforms) {
    if (platform.rootBranchGroupId == null) continue;
    const protectedPlatform = protectedIds.includes(platform.id);
    const inWindow = platform.position.x + platform.width > minKeepX && platform.position.x < maxKeepX;
    if (protectedPlatform || inWindow) active.add(platform.rootBranchGroupId);
  }
  return active;
}

/** Allocation-light rolling platform maintenance for headless training. */
export function maintainPlatformsForCameraInPlace(
  platforms: PlatformState[],
  agents: AgentState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X,
  terrainValue?: TerrainRuntimeConfig
): number {
  const terrain = resolvedTerrainRuntime(terrainValue);
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
  const rightGenerationEdge = Math.max(cameraX + viewportSize.width + PLATFORM_SPAWN_BUFFER, rightmostAgentX + PLATFORM_SPAWN_BUFFER);
  const leftGenerationEdge = Math.min(cameraX - PLATFORM_SPAWN_BUFFER, leftmostAgentX - PLATFORM_SPAWN_BUFFER);
  const despawnMargin = PLATFORM_SPAWN_BUFFER * 2;
  const minKeepX = Math.min(cameraX - despawnMargin, leftmostAgentX - despawnMargin);
  const maxKeepX = Math.max(cameraX + viewportSize.width + despawnMargin, rightmostAgentX + despawnMargin);
  const protectedIds = agents.map(a => a.lastPlatformId).filter((id): id is number => id != null);
  const activeRoots = activeRootBranchIds(platforms, protectedIds, minKeepX, maxKeepX);

  let write = 0;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const protectedPlatform = protectedIds.includes(platform.id);
    const preserveBranchTree = platform.rootBranchGroupId != null && activeRoots.has(platform.rootBranchGroupId);
    if (protectedPlatform || preserveBranchTree || (platform.position.x + platform.width > minKeepX && platform.position.x < maxKeepX)) {
      if (write !== i) platforms[write] = platform;
      write++;
    }
  }
  platforms.length = write;

  if (platforms.length > 0) {
    // Route arrays are deliberately not ordered by x (all of one sibling is emitted before the
    // other), and moving platforms can change their physical ordering. Extend only from the
    // forward trunk: normal platforms and top-level merge checkpoints.
    let rightmostPlatform = platforms
      .filter(platform => !platform.routePath && (platform.structureType !== 'merge' || (platform.branchDepth || 1) === 1))
      .reduce((best, platform) =>
        platform.position.x + platform.width > best.position.x + best.width ? platform : best, platforms[0]);
    while (rightmostPlatform.position.x + rightmostPlatform.width < rightGenerationEdge) {
      const generated = appendForwardSegment(platforms, rightmostPlatform, viewportSize.height, nextPlatformId, rng, branchMinX, terrain);
      rightmostPlatform = generated.rightmost;
      nextPlatformId = generated.nextPlatformId;
    }
  }

  if (platforms.length > 0) {
    let leftmostPlatform = platforms.reduce((best, platform) =>
      platform.position.x < best.position.x ? platform : best, platforms[0]);
    while (leftmostPlatform.position.x > leftGenerationEdge) {
      const newPlatform = generatePlatform(leftmostPlatform.position.x, leftmostPlatform.position.y, viewportSize.height, nextPlatformId++, rng, true, terrain);
      platforms.unshift(newPlatform);
      leftmostPlatform = newPlatform;
    }
  }
  return nextPlatformId;
}

/** Exact rolling rule used by the visible simulation. */
export function maintainPlatformsForCamera(
  platforms: PlatformState[],
  agents: AgentState[],
  cameraX: number,
  viewportSize: { width: number; height: number },
  nextPlatformId: number,
  rng: () => number,
  branchMinX = BRANCH_STRUCTURE_MIN_X,
  terrainValue?: TerrainRuntimeConfig
): { platforms: PlatformState[]; nextPlatformId: number } {
  const retained = platforms.map(platform => ({ ...platform, position: { ...platform.position }, motion: platform.motion ? { ...platform.motion } : undefined }));
  nextPlatformId = maintainPlatformsForCameraInPlace(retained, agents, cameraX, viewportSize, nextPlatformId, rng, branchMinX, terrainValue);
  return { platforms: retained, nextPlatformId };
}
