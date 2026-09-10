import type { ActiveUpgradeState, AgentState, PlatformState, TerrainRuntimeConfig } from '../types';
import { AgentStatus } from '../types';
import { getFairRespawn } from './respawn';
import { applyPlatformRoute, canAgentsPhysicallyInteract } from './terrainRoutes';
import { cameraRelevantAgents } from './cameraFraming';
import { hasRunnerOnHead } from './bodyContacts';
import type { TerrainBiomeProfile } from '../world/biomes';
import { terrainProfileForRuntimeAtX, terrainRuntimeForBiomeX } from '../world/biomes';
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
  MIN_PLATFORM_CLEARANCE_X,
  MIN_PLATFORM_CLEARANCE_Y,
  MAX_PLATFORM_GAP_X,
  PLATFORM_HEIGHT,
  PLATFORM_MAX_WIDTH,
  PLATFORM_MIN_WIDTH,
  PLATFORM_SPAWN_BUFFER,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
  BRANCH_STRUCTURE_MIN_X,
  BRANCH_STRUCTURE_BASE_CHANCE,
  BRANCH_STRUCTURE_MAX_CHANCE,
  BRANCH_MIN_PLATFORM_Y,
  BRANCH_BOTTOM_MARGIN,
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
  /** Best (nearest/easiest) Chaser-to-Runner pair zoom. Escape requires every Runner pair to fail. */
  requiredReferenceZoom: number;
}

function pairFrameRequirement(a: AgentState, b: AgentState): { spanX: number; spanY: number; zoom: number } {
  const minX = Math.min(a.position.x, b.position.x);
  const maxX = Math.max(a.position.x + AGENT_WIDTH, b.position.x + AGENT_WIDTH);
  const minY = Math.min(a.position.y, b.position.y);
  const maxY = Math.max(a.position.y + AGENT_HEIGHT, b.position.y + AGENT_HEIGHT);
  const spanX = Math.max(AGENT_WIDTH, maxX - minX);
  const spanY = Math.max(AGENT_HEIGHT, maxY - minY);
  const safeReferenceWidth = Math.max(1, WORLD_REF_WIDTH - CAMERA_FRAME_PADDING_REFERENCE_PX * 2);
  const safeReferenceHeight = Math.max(1, WORLD_REF_HEIGHT - CAMERA_FRAME_PADDING_REFERENCE_PX * 2);
  return {
    spanX,
    spanY,
    zoom: Math.min(safeReferenceWidth / spanX, safeReferenceHeight / spanY),
  };
}

/**
 * Detect when the active Chaser has lost every Runner beyond the minimum useful camera frame.
 * With multiple Runners, their separation from one another must never create a Chaser failure: as
 * long as the Chaser can still share a useful camera frame with at least one Runner, the chase is
 * alive. The invariant 1200x800 reference keeps worker/training and champion-view outcomes equal.
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

  let groupMinX = chaser.position.x;
  let groupMaxX = chaser.position.x + AGENT_WIDTH;
  let groupMinY = chaser.position.y;
  let groupMaxY = chaser.position.y + AGENT_HEIGHT;
  const cx = chaser.position.x + AGENT_WIDTH / 2;
  const cy = chaser.position.y + AGENT_HEIGHT / 2;
  let maxChaserRunnerDistancePx = 0;
  let bestPairZoom = 0;
  let everyRunnerOutOfFrame = true;

  for (const runner of runners) {
    groupMinX = Math.min(groupMinX, runner.position.x);
    groupMaxX = Math.max(groupMaxX, runner.position.x + AGENT_WIDTH);
    groupMinY = Math.min(groupMinY, runner.position.y);
    groupMaxY = Math.max(groupMaxY, runner.position.y + AGENT_HEIGHT);

    const rx = runner.position.x + AGENT_WIDTH / 2;
    const ry = runner.position.y + AGENT_HEIGHT / 2;
    maxChaserRunnerDistancePx = Math.max(maxChaserRunnerDistancePx, Math.hypot(rx - cx, ry - cy));

    const pair = pairFrameRequirement(chaser, runner);
    bestPairZoom = Math.max(bestPairZoom, pair.zoom);
    const pairEscaped =
      pair.spanX > CHASE_ESCAPE_MAX_GROUP_SPAN_X ||
      pair.spanY > CHASE_ESCAPE_MAX_GROUP_SPAN_Y ||
      pair.zoom < CAMERA_MIN_USEFUL_AUTO_ZOOM;
    if (!pairEscaped) everyRunnerOutOfFrame = false;
  }

  return {
    escaped: everyRunnerOutOfFrame,
    chaserId: chaser.id,
    runnerCount: runners.length,
    groupSpanX: Math.max(AGENT_WIDTH, groupMaxX - groupMinX),
    groupSpanY: Math.max(AGENT_HEIGHT, groupMaxY - groupMinY),
    maxChaserRunnerDistancePx,
    requiredReferenceZoom: bestPairZoom,
  };
}

export interface VisualChaserEscapeRecovery {
  chaserId: number;
  position: { x: number; y: number };
  platformId: number;
  activeRoutePath: string | null;
}

/**
 * Pick a conservative visual-only recovery after an escape. The Chaser is placed on a legal
 * platform roughly 220-360px behind the trailing Runner, inherits that Runner's active route, and
 * is kept clear of immediate tag contact. Training never calls this helper: escape remains terminal
 * and fully penalized there.
 */
export function getVisualChaserEscapeRecovery(
  agents: AgentState[],
  platforms: PlatformState[]
): VisualChaserEscapeRecovery | null {
  const chaser = agents.find(agent => agent.status === AgentStatus.It) || null;
  const runners = chaser ? agents.filter(agent => agent.id !== chaser.id && agent.status !== AgentStatus.It) : [];
  if (!chaser || runners.length === 0 || platforms.length === 0) return null;

  const target = runners.reduce((best, runner) => runner.position.x < best.position.x ? runner : best, runners[0]);
  const offsets = [360, 300, 240];
  let fallback: VisualChaserEscapeRecovery | null = null;

  for (const offset of offsets) {
    const desiredX = target.position.x - offset;
    const staged: AgentState = {
      ...chaser,
      activeRoutePath: target.activeRoutePath || null,
      lastPlatformId: null,
      positionAtLastTakeoff: { x: desiredX, y: target.position.y },
    };
    const respawn = getFairRespawn(staged, platforms, agents);
    const selectedPlatform = platforms.find(platform => platform.id === respawn.platformId);
    applyPlatformRoute(staged, selectedPlatform);
    const recovery: VisualChaserEscapeRecovery = {
      chaserId: chaser.id,
      position: respawn.position,
      platformId: respawn.platformId,
      activeRoutePath: staged.activeRoutePath || null,
    };
    fallback = recovery;

    const hypothetical = agents.map(agent => agent.id === chaser.id
      ? { ...agent, position: respawn.position, activeRoutePath: recovery.activeRoutePath }
      : agent
    );
    if (!evaluateChaseEscape(hypothetical).escaped) return recovery;
  }

  return fallback;
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
  if (jumpArmed && jumpControl >= JUMP_PRESS_THRESHOLD && agent.isOnGround && !hasRunnerOnHead(agent, allAgentsBeforePhysics)) {
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

  // Preserve an existing floor contact explicitly before doing swept landing detection. Moving
  // platforms are advanced first and carry grounded riders with them. A freshly respawned body is
  // also marked grounded on its selected checkpoint. In both cases gravity should not create a new
  // one-frame landing problem: if the body still overlaps the same platform after horizontal motion,
  // keep its feet pinned to the current platform top. This is especially important for vertical
  // platforms, where treating the respawn as a brand-new swept landing can occasionally let the
  // platform/body pair separate by a frame and send the body through the surface. Walking off and
  // jumping are unaffected because those cases deliberately do not retain support.
  let retainedSupport: PlatformState | undefined;
  if (!jumped && agent.isOnGround && agent.supportingAgentId == null && agent.lastPlatformId != null) {
    const candidate = platforms.find(platform => platform.id === agent.lastPlatformId);
    if (candidate) {
      const feetWereOnTop = Math.abs((agent.position.y + AGENT_HEIGHT) - candidate.position.y) <= 1;
      const stillOverlaps =
        positionX + AGENT_WIDTH > candidate.position.x &&
        positionX < candidate.position.x + candidate.width;
      if (feetWereOnTop && stillOverlaps) {
        retainedSupport = candidate;
        positionY = candidate.position.y - AGENT_HEIGHT;
        velocityY = 0;
        grounded = true;
        landedPlatformId = candidate.id;
      }
    }
  }

  const prevBottom = agent.position.y + AGENT_HEIGHT;
  const newBottom = positionY + AGENT_HEIGHT;
  let landing: PlatformState | undefined;
  let landingTime = Infinity;
  if (!retainedSupport) {
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i];
      const carried = agent.isOnGround && agent.supportingAgentId == null && agent.lastPlatformId === platform.id;
      const previous = carried ? platform.position : platform.previousPosition || platform.position;
      const platformDx = platform.position.x - previous.x;
      const platformDy = platform.position.y - previous.y;
      const relativeY = velocityY - platformDy;
      if (relativeY < 0 || prevBottom > previous.y + 0.001 || newBottom < platform.position.y) continue;
      // Test horizontal overlap when the feet cross the top, not only at the end of the frame.
      // Lower targets produce faster descents; the body can cross a corner and leave its horizontal
      // span within one physics step. Only floating-point tolerance is allowed at a resting top.
      const contactTime = relativeY > 0 ? Math.max(0, (previous.y - prevBottom) / relativeY) : 0;
      const contactX = agent.position.x + velocityX * contactTime;
      const platformX = previous.x + platformDx * contactTime;
      const aligned =
        contactX + AGENT_WIDTH > platformX &&
        contactX < platformX + platform.width;
      // A body already at the top must be able to walk off. Rewinding a t=0 edge exit to its
      // starting point every frame would turn the edge into an invisible horizontal wall.
      if (contactTime === 0 && (positionX + AGENT_WIDTH <= platform.position.x || positionX >= platform.position.x + platform.width)) continue;
      if (aligned && (contactTime < landingTime || (contactTime === landingTime && platform.id < (landing?.id ?? Infinity)))) {
        landing = platform;
        landingTime = contactTime;
      }
    }
  }
  if (landing) {
    // If this was a grazing edge contact, finish at the impact point rather than declaring a
    // grounded body beyond the ledge. Normal landings retain their full horizontal movement.
    if (positionX + AGENT_WIDTH <= landing.position.x || positionX >= landing.position.x + landing.width) {
      const dx = landing.position.x - (landing.previousPosition?.x ?? landing.position.x);
      positionX = agent.position.x + velocityX * landingTime + dx * (1 - landingTime);
    }
    positionY = landing.position.y - AGENT_HEIGHT;
    velocityY = 0;
    grounded = true;
    landedPlatformId = landing.id;
    applyPlatformRoute(agent, landing);
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
  agent.supportingAgentId = null;
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

  for (const body of agents) {
    if (body.supportingAgentId == null) continue;
    const support = agents.find(a => a.id === body.supportingAgentId);
    if (body.status === AgentStatus.It || support?.status === AgentStatus.It) {
      body.supportingAgentId = null;
      body.isOnGround = false;
    }
  }

  return transition;
}

/**
 * Presentation/rolling-world camera rule centered on the active chase pair. The camera is
 * observational only: physics and policy inputs never depend on this value.
 */
export function updateChaseCameraX(agents: AgentState[], platforms: PlatformState[], currentCameraX: number, viewportWidth: number): number {
  if (agents.length === 0) return currentCameraX;
  const cameraAgents = cameraRelevantAgents(agents, platforms);
  if (cameraAgents.length === 0) return currentCameraX;

  let chaser: AgentState | null = null;
  for (let i = 0; i < cameraAgents.length; i++) {
    if (cameraAgents[i].status === AgentStatus.It) {
      chaser = cameraAgents[i];
      break;
    }
  }

  let centerX = 0;
  if (chaser) {
    const chaserCenter = chaser.position.x + AGENT_WIDTH / 2;
    let nearestRunner: AgentState | null = null;
    let nearestDistanceSq = Infinity;
    for (let i = 0; i < cameraAgents.length; i++) {
      const candidate = cameraAgents[i];
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
    for (let i = 0; i < cameraAgents.length; i++) centerX += cameraAgents[i].position.x + AGENT_WIDTH / 2;
    centerX /= cameraAgents.length;
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
  biomeWorldOffsetX: 0,
};

function resolvedTerrainRuntime(value?: TerrainRuntimeConfig): TerrainRuntimeConfig {
  return value || DEFAULT_TERRAIN_RUNTIME;
}

interface PlatformEnvelope {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Conservative swept bounds: if two envelopes do not intersect, the platforms can never overlap
 * anywhere in their configured oscillation. */
function platformEnvelope(platform: PlatformState): PlatformEnvelope {
  let left = platform.position.x;
  let right = platform.position.x + platform.width;
  let top = platform.position.y;
  let bottom = platform.position.y + platform.height;
  if (platform.motion) {
    if (platform.motion.axis === 'x') {
      left = Math.min(left, platform.motion.min);
      right = Math.max(right, platform.motion.max + platform.width);
    } else {
      top = Math.min(top, platform.motion.min);
      bottom = Math.max(bottom, platform.motion.max + platform.height);
    }
  }
  return { left, right, top, bottom };
}

function envelopesOverlap(a: PlatformEnvelope, b: PlatformEnvelope): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function envelopeAxisGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax <= bMin) return bMin - aMax;
  if (bMax <= aMin) return aMin - bMax;
  return 0;
}

/**
 * Treat near-misses as generation conflicts as well. Exact rectangle non-overlap is not enough for
 * readable platforming: when X ranges overlap there must be at least one agent-height of vertical
 * breathing room, and platforms on nearly the same Y band need a visible horizontal gap. Moving
 * platforms are represented by their complete sweep envelope, so satisfying this predicate also
 * guarantees clearance throughout their entire motion.
 */
function envelopesViolateClearance(a: PlatformEnvelope, b: PlatformEnvelope): boolean {
  const gapX = envelopeAxisGap(a.left, a.right, b.left, b.right);
  const gapY = envelopeAxisGap(a.top, a.bottom, b.top, b.bottom);
  return gapX < MIN_PLATFORM_CLEARANCE_X && gapY < MIN_PLATFORM_CLEARANCE_Y;
}

function overlapsAnyPlatform(candidate: PlatformState, existing: PlatformState[]): boolean {
  const envelope = platformEnvelope(candidate);
  return existing.some(platform => envelopesViolateClearance(envelope, platformEnvelope(platform)));
}

/** Diagnostics/test helper for literal swept-envelope overlaps. */
export function findPlatformOverlapPairs(platforms: PlatformState[]): Array<[number, number]> {
  const overlaps: Array<[number, number]> = [];
  for (let i = 0; i < platforms.length; i++) {
    const a = platformEnvelope(platforms[i]);
    for (let j = i + 1; j < platforms.length; j++) {
      if (envelopesOverlap(a, platformEnvelope(platforms[j]))) overlaps.push([platforms[i].id, platforms[j].id]);
    }
  }
  return overlaps;
}

/**
 * Diagnostics/test helper for the stronger readability invariant. An empty result means every
 * stationary rectangle and every full moving sweep keeps the configured horizontal/vertical
 * safety clearance from every other platform.
 */
export function findPlatformClearanceViolations(platforms: PlatformState[]): Array<[number, number]> {
  const violations: Array<[number, number]> = [];
  for (let i = 0; i < platforms.length; i++) {
    const a = platformEnvelope(platforms[i]);
    for (let j = i + 1; j < platforms.length; j++) {
      if (envelopesViolateClearance(a, platformEnvelope(platforms[j]))) violations.push([platforms[i].id, platforms[j].id]);
    }
  }
  return violations;
}

function placeTrunkPlatformWithoutOverlap(
  platform: PlatformState,
  existing: PlatformState[],
  toLeft: boolean
): PlatformState {
  // Trunk geometry has no fixed slot, so the safest correction is to increase the horizontal gap.
  // Each correction moves beyond at least one conflicting swept envelope; existing.length + 2 is
  // therefore enough to converge even in a pathological imported/dense world.
  const clearance = Math.max(MIN_PLATFORM_GAP_X, MIN_PLATFORM_CLEARANCE_X);
  for (let guard = 0; guard < existing.length + 2; guard++) {
    const envelope = platformEnvelope(platform);
    const conflicts = existing.filter(other => envelopesViolateClearance(envelope, platformEnvelope(other)));
    if (conflicts.length === 0) return platform;
    if (toLeft) {
      const leftEdge = Math.min(...conflicts.map(other => platformEnvelope(other).left));
      platform.position.x = leftEdge - clearance - platform.width;
    } else {
      const rightEdge = Math.max(...conflicts.map(other => platformEnvelope(other).right));
      platform.position.x = rightEdge + clearance;
    }
  }

  // Mathematical final fallback: place completely beyond every existing swept envelope. This is
  // rarely reached, but makes the generation invariant unconditional rather than probabilistic.
  if (existing.length > 0) {
    if (toLeft) {
      const leftEdge = Math.min(...existing.map(other => platformEnvelope(other).left));
      platform.position.x = leftEdge - clearance - platform.width;
    } else {
      const rightEdge = Math.max(...existing.map(other => platformEnvelope(other).right));
      platform.position.x = rightEdge + clearance;
    }
  }
  return platform;
}

function placeBranchPlatformWithoutOverlap(
  platform: PlatformState,
  existing: PlatformState[],
  viewportHeight: number,
  slotStart: number,
  slotEnd: number,
  preferredY: number,
  corridorMinValue = BRANCH_MIN_PLATFORM_Y,
  corridorMaxValue = viewportHeight - BRANCH_BOTTOM_MARGIN
): PlatformState {
  const worldMinY = BRANCH_MIN_PLATFORM_Y;
  const worldMaxY = viewportHeight - BRANCH_BOTTOM_MARGIN;
  const minY = Math.max(worldMinY, Math.min(worldMaxY, corridorMinValue));
  const maxY = Math.max(minY, Math.min(worldMaxY, corridorMaxValue));
  const minX = slotStart + 6;
  const maxX = Math.max(minX, slotEnd - platform.width - 6);
  const preferredX = Math.max(minX, Math.min(maxX, platform.position.x));
  const clampedPreferredY = Math.max(minY, Math.min(maxY, preferredY));

  // Keep route identity geometric as well as logical. Earlier versions searched the entire vertical
  // world when a slot was crowded, which was collision-safe but could move one ledge into another
  // route's visual corridor. Search only a modest band around the designed lane; if that fails we
  // resolve the crowding horizontally instead.
  const yCandidates: number[] = [clampedPreferredY];
  for (const delta of [18, 36, 54, 72]) {
    yCandidates.push(Math.max(minY, clampedPreferredY - delta));
    yCandidates.push(Math.min(maxY, clampedPreferredY + delta));
  }

  const xCandidates: number[] = [preferredX, minX, maxX];
  for (let x = minX; x <= maxX; x += 18) xCandidates.push(x);

  const seen = new Set<string>();
  for (const x of xCandidates) {
    for (const y of yCandidates) {
      const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      platform.position.x = x;
      platform.position.y = y;
      if (!overlapsAnyPlatform(platform, existing)) return platform;
    }
  }

  // Extremely dense recursive geometry can exhaust a slot. Narrowing the platform is preferable to
  // abandoning the route lane; route reachability remains healthy above 80px width.
  for (let width = Math.min(platform.width, 110); width >= 80; width -= 10) {
    platform.width = width;
    const localMaxX = Math.max(minX, slotEnd - width - 6);
    for (let x = minX; x <= localMaxX; x += 12) {
      for (const y of yCandidates) {
        platform.position.x = x;
        platform.position.y = y;
        if (!overlapsAnyPlatform(platform, existing)) return platform;
      }
    }
  }

  // If the intended slot is genuinely full, preserve Y and advance only as far right as necessary.
  // Each pass clears at least one swept envelope. The outer merge is subsequently moved to the
  // resolved route endpoint, so this never strands a ledge beyond its own rejoin point.
  const clearance = Math.max(MIN_PLATFORM_GAP_X, MIN_PLATFORM_CLEARANCE_X);
  platform.position.x = Math.max(minX, slotEnd + clearance);
  platform.position.y = clampedPreferredY;
  for (let guard = 0; guard < existing.length + 2; guard++) {
    const envelope = platformEnvelope(platform);
    const conflicts = existing.filter(other => envelopesViolateClearance(envelope, platformEnvelope(other)));
    if (conflicts.length === 0) return platform;
    const conflictRight = Math.max(...conflicts.map(other => platformEnvelope(other).right));
    platform.position.x = conflictRight + clearance;
  }

  // Absolute final fallback. It is intentionally horizontal so route elevation is never sacrificed
  // merely to satisfy collision avoidance.
  if (existing.length > 0) {
    platform.position.x = Math.max(...existing.map(other => platformEnvelope(other).right)) + clearance;
  }
  return platform;
}

function maybeMakeMoving(
  platform: PlatformState,
  viewportHeight: number,
  rng: () => number,
  terrain: TerrainRuntimeConfig,
  inBranch: boolean,
  force = false,
  existingPlatforms: PlatformState[] = []
): PlatformState {
  if (!terrain.movingPlatformsEnabled || terrain.movingPlatformMaxSpeed <= 0) return platform;
  if (inBranch && !terrain.movingPlatformsInBranches) return platform;
  if (!force && rng() >= terrain.movingSpawnChance) return platform;

  const maxSpeed = Math.max(0, terrain.movingPlatformMaxSpeed);
  const minSpeed = Math.min(24, maxSpeed);
  const speed = minSpeed + rng() * Math.max(0, maxSpeed - minSpeed);
  // Branch routes keep a stable vertical identity so the upper/lower paths remain visually clear.
  // They may still move horizontally, while trunk platforms retain both motion axes.
  const preferredAxis: 'x' | 'y' = inBranch ? 'x' : (rng() < 0.6 ? 'x' : 'y');
  const axisOrder: Array<'x' | 'y'> = inBranch
    ? ['x']
    : (preferredAxis === 'x' ? ['x', 'y'] : ['y', 'x']);
  // Keep oscillation useful without turning ordinary transitions into extreme timing puzzles.
  // The full sweep is still validated below; these natural ranges also preserve reachability when
  // a platform happens to be at the far end of its travel.
  const baseRangeX = 18 + rng() * 32;
  const baseRangeY = 12 + rng() * 18;
  const directions: Array<-1 | 1> = rng() < 0.5 ? [-1, 1] : [1, -1];

  const tryMotion = (axis: 'x' | 'y', min: number, max: number, direction: -1 | 1): PlatformState | null => {
    if (max - min < 10) return null;
    const moving: PlatformState = { ...platform, motion: { axis, min, max, speed, direction } };
    return overlapsAnyPlatform(moving, existingPlatforms) ? null : moving;
  };

  for (const axis of axisOrder) {
    const baseRange = axis === 'x' ? baseRangeX : baseRangeY;
    for (const scale of [1, 0.7, 0.45, 0.25]) {
      const range = Math.max(10, baseRange * scale);
      if (axis === 'x') {
        // Try symmetric travel first, then one-sided travel. One-sided motion is especially useful
        // in dense recursive branches because it preserves movement without crossing a neighbor.
        for (const [min, max] of [
          [platform.position.x - range, platform.position.x + range],
          [platform.position.x, platform.position.x + range],
          [platform.position.x - range, platform.position.x],
        ] as Array<[number, number]>) {
          for (const direction of directions) {
            const candidate = tryMotion('x', min, max, direction);
            if (candidate) return candidate;
          }
        }
      } else {
        const minAllowed = 230;
        const maxAllowed = viewportHeight - 105;
        for (const [rawMin, rawMax] of [
          [platform.position.y - range, platform.position.y + range],
          [platform.position.y, platform.position.y + range],
          [platform.position.y - range, platform.position.y],
        ] as Array<[number, number]>) {
          const min = Math.max(minAllowed, rawMin);
          const max = Math.min(maxAllowed, rawMax);
          for (const direction of directions) {
            const candidate = tryMotion('y', min, max, direction);
            if (candidate) return candidate;
          }
        }
      }
    }
  }

  // Safe stationary terrain is better than a moving platform whose sweep can collide. In a
  // guarantee-moving training episode the next generated platform will keep trying until a safe
  // moving candidate is created.
  return platform;
}

function clampBiomeScale(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Biomes bias proposal geometry, but the existing overlap/reachability placement functions remain
 * authoritative. This keeps mechanical identity expressive without bypassing safety constraints.
 */
function resolveBiomeGeometry(
  terrain: TerrainRuntimeConfig,
  worldX: number,
  profileOverride?: TerrainBiomeProfile
): { profile: TerrainBiomeProfile; terrain: TerrainRuntimeConfig } {
  if (profileOverride) return { profile: profileOverride, terrain };
  return {
    profile: terrainProfileForRuntimeAtX(terrain, worldX),
    terrain: terrainRuntimeForBiomeX(terrain, worldX),
  };
}

function generatePlatform(
  baseX: number,
  baseY: number,
  viewportHeight: number,
  id: number,
  rng: () => number,
  toLeft = false,
  terrain: TerrainRuntimeConfig = DEFAULT_TERRAIN_RUNTIME,
  forceMoving = false,
  existingPlatforms: PlatformState[] = [],
  profileOverride?: TerrainBiomeProfile
): PlatformState {
  const minY = 250;
  const maxY = viewportHeight - 120;
  const biome = resolveBiomeGeometry(terrain, baseX, profileOverride);
  const profile = biome.profile;
  const effectiveTerrain = biome.terrain;

  // A reflected, mode-based random walk looks less like white-noise stairs. Biomes adjust both
  // how often a route stays near-level and the magnitude of meaningful climbs/descents. Route
  // persistence is deliberately separate from raw vertical variation: Rural Village can stay on a
  // coherent shelf while Snowy Mountains changes elevation aggressively.
  const mode = rng();
  const flatThreshold = clampBiomeScale(0.42 + (profile.routePersistenceMultiplier - 1) * 0.30, 0.30, 0.53);
  const climbThreshold = flatThreshold + (1 - flatThreshold) * 0.50;
  let deltaY: number;
  if (mode < flatThreshold) deltaY = (rng() - 0.5) * 42;
  else if (mode < climbThreshold) deltaY = -(30 + rng() * 50);
  else deltaY = 30 + rng() * 50;
  deltaY *= profile.verticalVariationMultiplier;

  if (baseY < minY + 72 && deltaY < 0) deltaY = Math.abs(deltaY) * (0.55 + rng() * 0.25);
  if (baseY > maxY - 72 && deltaY > 0) deltaY = -Math.abs(deltaY) * (0.55 + rng() * 0.25);

  let proposedY = baseY + deltaY;
  if (proposedY < minY) proposedY = minY + (minY - proposedY) * 0.55;
  else if (proposedY > maxY) proposedY = maxY - (proposedY - maxY) * 0.55;
  const clampedY = Math.max(minY, Math.min(maxY, proposedY));
  const verticalDifference = clampedY - baseY;

  let gapX = MIN_PLATFORM_GAP_X + rng() * (MAX_PLATFORM_GAP_X - MIN_PLATFORM_GAP_X);
  gapX = clampBiomeScale(gapX * profile.gapMultiplier, MIN_PLATFORM_GAP_X, MAX_PLATFORM_GAP_X);
  // Uphill jumps need slightly shorter reaches; downhill/flat runs can breathe more. These caps
  // remain global reachability guardrails, so a biome cannot turn a statistical bias into an
  // impossible transition.
  if (verticalDifference < -55) gapX = Math.min(gapX, 128);
  else if (verticalDifference > 55) gapX = Math.max(gapX, 105);
  else if (Math.abs(verticalDifference) < 18 && rng() < 0.35) gapX = Math.min(MAX_PLATFORM_GAP_X, gapX + 24);

  let newWidth = (rng() * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH) + PLATFORM_MIN_WIDTH) * profile.platformWidthMultiplier;
  newWidth = clampBiomeScale(newWidth, PLATFORM_MIN_WIDTH * 0.78, PLATFORM_MAX_WIDTH * 1.18);
  // Difficult elevation changes get a slightly more generous landing target without turning every
  // platform into the same width.
  if (Math.abs(verticalDifference) > 70) newWidth = Math.min(PLATFORM_MAX_WIDTH * 1.18, newWidth + 25);

  const stationary = placeTrunkPlatformWithoutOverlap({
    id,
    width: newWidth,
    height: PLATFORM_HEIGHT,
    structureType: 'normal',
    position: {
      x: toLeft ? baseX - newWidth - gapX : baseX + gapX,
      y: clampedY,
    },
  }, existingPlatforms, toLeft);
  return maybeMakeMoving(stationary, viewportHeight, rng, effectiveTerrain, false, forceMoving, existingPlatforms);
}

function clampPlatformY(y: number, viewportHeight: number): number {
  // Branches use a taller play band than ordinary trunk terrain. This extra room is important for
  // clear recursive lanes while still leaving enough camera space above/below the agent body.
  return Math.min(viewportHeight - BRANCH_BOTTOM_MARGIN, Math.max(BRANCH_MIN_PLATFORM_Y, y));
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

function routeLanePair(
  baseY: number,
  depth: number,
  viewportHeight: number,
  rng: () => number,
  stepsToLane: number,
  corridorMinValue: number,
  corridorMaxValue: number,
  nestUpper: boolean,
  nestLower: boolean
): [number, number] {
  const minWorldY = BRANCH_MIN_PLATFORM_Y;
  const maxWorldY = viewportHeight - BRANCH_BOTTOM_MARGIN;
  // Branch siblings are separated more strongly than unrelated platforms so a fork reads as two
  // distinct routes even after the small per-platform contour jitter is applied.
  const minimumForkSeparation = MIN_PLATFORM_CLEARANCE_Y + PLATFORM_HEIGHT + 24;
  const corridorMin = Math.max(minWorldY, Math.min(maxWorldY, corridorMinValue));
  const corridorMax = Math.max(corridorMin, Math.min(maxWorldY, corridorMaxValue));

  // Never expand a nested corridor outside its parent. Older fallback expansion could make a deep
  // child visually leak into its sibling route. Recursion is filtered by corridor capacity before
  // the child is built, so supported nested forks already have enough room here.
  const span = Math.max(1, corridorMax - corridorMin);
  const edgeInset = Math.min(28, Math.max(8, span * 0.10));
  const usableMin = Math.min(corridorMax, corridorMin + edgeInset);
  const usableMax = Math.max(usableMin, corridorMax - edgeInset);
  const usableSpan = Math.max(1, usableMax - usableMin);
  const jitter = Math.min(9, usableSpan * 0.045);

  // Bias extra vertical budget toward whichever side is going to recurse. This produces irregular
  // ravine/canopy-like structures rather than a perfectly mirrored binary circuit diagram.
  let upperFraction = 0.18;
  let lowerFraction = 0.82;
  if (nestUpper && !nestLower) {
    // Put the simple sibling near the far edge so the recursive side keeps most of the inherited
    // corridor. That makes depth 3–4 possible without ever trespassing into the sibling route.
    upperFraction = 0.14;
    lowerFraction = 0.96;
  } else if (nestLower && !nestUpper) {
    upperFraction = 0.04;
    lowerFraction = 0.86;
  }
  let upper = usableMin + usableSpan * upperFraction + (rng() - 0.5) * jitter;
  let lower = usableMin + usableSpan * lowerFraction + (rng() - 0.5) * jitter;

  // Divergence is a short ramp, not a teleport. Cap total displacement per commitment platform so
  // either first choice remains learnable from high and low incoming ledges.
  const maxVerticalOffset = Math.max(134, Math.max(1, stepsToLane) * 134);
  upper = clampPlatformY(Math.max(baseY - maxVerticalOffset, Math.min(baseY + maxVerticalOffset, upper)), viewportHeight);
  lower = clampPlatformY(Math.max(baseY - maxVerticalOffset, Math.min(baseY + maxVerticalOffset, lower)), viewportHeight);

  const requiredSeparation = Math.min(minimumForkSeparation, usableSpan);
  if (lower - upper < requiredSeparation) {
    let center = (upper + lower) * 0.5;
    const half = requiredSeparation * 0.5;
    const minCenter = usableMin + half;
    const maxCenter = usableMax - half;
    center = minCenter <= maxCenter ? Math.max(minCenter, Math.min(maxCenter, center)) : (usableMin + usableMax) * 0.5;
    upper = center - half;
    lower = center + half;
  }
  return [upper, lower];
}

function corridorSupportsNestedFork(corridor: [number, number]): boolean {
  // A child needs two rows, the stronger sibling separation, and a little edge breathing room. If
  // the inherited corridor cannot provide that, maxBranchDepth remains a true ceiling rather than
  // forcing a cramped split that collision fallbacks would have to distort horizontally.
  const minimumForkSeparation = MIN_PLATFORM_CLEARANCE_Y + PLATFORM_HEIGHT + 24;
  return corridor[1] - corridor[0] >= minimumForkSeparation + 28;
}

function intersectCorridors(a: [number, number], b: [number, number]): [number, number] {
  const min = Math.max(a[0], b[0]);
  const max = Math.min(a[1], b[1]);
  return [min, Math.max(min, max)];
}

function commitmentLanePair(
  entryY: number,
  viewportHeight: number,
  corridorMinValue: number,
  corridorMaxValue: number
): [number, number] {
  // The fork itself must already read as two distinct choices. Put the first two ledges around the
  // incoming height with enough separation for the global clearance rule, then let later ledges
  // continue toward the wider route lanes. Both commitment jumps remain modest and symmetric.
  const worldMinY = BRANCH_MIN_PLATFORM_Y;
  const worldMaxY = viewportHeight - BRANCH_BOTTOM_MARGIN;
  const minY = Math.max(worldMinY, Math.min(worldMaxY, corridorMinValue));
  const maxY = Math.max(minY, Math.min(worldMaxY, corridorMaxValue));
  const separation = MIN_PLATFORM_CLEARANCE_Y + PLATFORM_HEIGHT + 12;
  const half = Math.min(separation, maxY - minY) * 0.5;
  const center = Math.max(minY + half, Math.min(maxY - half, entryY));
  return [center - half, center + half];
}

function childBranchCorridor(
  side: 'upper' | 'lower',
  corridorMin: number,
  corridorMax: number,
  upperY: number,
  lowerY: number,
  bothSidesNest: boolean
): [number, number] {
  const routeClearance = MIN_PLATFORM_CLEARANCE_Y + PLATFORM_HEIGHT;
  if (bothSidesNest) {
    const midpoint = (upperY + lowerY) * 0.5;
    // When both siblings recurse, their child corridors themselves need a full vertical safety
    // channel between them. A small aesthetic center gap is not enough because descendants from
    // both subtrees occupy the same horizontal chapter and would otherwise force sideways fallback.
    const centerGap = Math.max(routeClearance * 0.5 + 10, Math.min(72, (lowerY - upperY) * 0.22));
    return side === 'upper'
      ? [corridorMin, midpoint - centerGap]
      : [midpoint + centerGap, corridorMax];
  }
  return side === 'upper'
    ? [corridorMin, Math.min(corridorMax, lowerY - routeClearance)]
    : [Math.max(corridorMin, upperY + routeClearance), corridorMax];
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
  profile: TerrainBiomeProfile,
  forceFirstMoving = false,
  firstPlatformY?: number,
  corridorMinValue = BRANCH_MIN_PLATFORM_Y,
  corridorMaxValue = viewportHeight - BRANCH_BOTTOM_MARGIN
): { last: PlatformState; nextPlatformId: number } {
  const safeCount = Math.max(1, count);
  const span = Math.max(180, endX - startX);
  const preferredWidth = Math.max(100, Math.min(205, (span / safeCount - 90) * profile.platformWidthMultiplier));
  const routeMinY = Math.max(BRANCH_MIN_PLATFORM_Y, Math.min(viewportHeight - BRANCH_BOTTOM_MARGIN, corridorMinValue));
  const routeMaxY = Math.max(routeMinY, Math.min(viewportHeight - BRANCH_BOTTOM_MARGIN, corridorMaxValue));
  let last: PlatformState | null = null;

  for (let i = 0; i < safeCount; i++) {
    const slotStart = startX + (span * i) / safeCount;
    const slotEnd = startX + (span * (i + 1)) / safeCount;
    const slotWidth = slotEnd - slotStart;
    const width = Math.max(96, Math.min(preferredWidth + (rng() - 0.5) * 24, slotWidth - 54));
    const x = slotStart + Math.max(27, (slotWidth - width) * 0.5);
    const laneJitter = Math.max(3, (12 - (depth - 1) * 2) * clampBiomeScale(profile.verticalVariationMultiplier, 0.72, 1.35));
    const routeProgress = safeCount <= 1 ? 0 : i / (safeCount - 1);
    const designedY = firstPlatformY == null
      ? laneY
      : firstPlatformY + (laneY - firstPlatformY) * routeProgress;
    let y = Math.max(routeMinY, Math.min(routeMaxY, clampPlatformY(designedY + (rng() - 0.5) * laneJitter, viewportHeight)));
    // Keep consecutive ledges comfortably inside the ordinary jump envelope. Collision avoidance
    // should never turn a readable route into a near-max-height jump simply because its target lane
    // is far away. Nested forks use their own commitment ledges to make larger vertical changes.
    if (last) {
      const maxRise = 124;
      const maxDrop = 146;
      y = Math.max(last.position.y - maxRise, Math.min(last.position.y + maxDrop, y));
      y = Math.max(routeMinY, Math.min(routeMaxY, y));
    }
    const sequenceStart = last
      ? Math.max(slotStart, platformEnvelope(last).right + MIN_PLATFORM_GAP_X)
      : slotStart;
    const stationary = placeBranchPlatformWithoutOverlap({
      id: nextPlatformId++,
      width,
      height: PLATFORM_HEIGHT,
      position: { x, y },
      structureType: side === 'upper' ? 'branch-upper' : 'branch-lower',
      branchGroupId: groupId,
      branchDepth: depth,
      routePath,
      rootBranchGroupId: rootGroupId,
    }, platforms, viewportHeight, sequenceStart, slotEnd, y, routeMinY, routeMaxY);
    const commitmentPlatform = firstPlatformY != null && i === 0;
    const endpointPlatform = i === safeCount - 1;
    const forcedMovingIndex = forceFirstMoving && safeCount >= 3 ? 1 : -1;
    // Fork commitment and route endpoints stay fixed. Stable endpoints make both the choice and
    // the merge readable; moving terrain belongs inside a route rather than at its doorway.
    const allowMotion = !commitmentPlatform && !endpointPlatform;
    const platform = allowMotion
      ? maybeMakeMoving(
          stationary,
          viewportHeight,
          rng,
          terrain,
          true,
          forcedMovingIndex === i,
          platforms
        )
      : stationary;
    platforms.push(platform);
    last = platform;
  }

  return { last: last!, nextPlatformId };
}

/** Add stationary connective ledges when one sibling route contains a longer nested detour.
 * These are not new choices; they simply keep the unsplit/shorter sibling traversable until both
 * routes reach the same rejoin chapter. */
function extendRouteTowardX(
  platforms: PlatformState[],
  last: PlatformState,
  targetRight: number,
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
  profile: TerrainBiomeProfile,
  corridorMin: number,
  corridorMax: number,
  maxRemaining = 80
): { last: PlatformState; nextPlatformId: number } {
  let current = last;
  const preferredGap = clampBiomeScale(72 * profile.gapMultiplier, 60, 90);
  const minWidth = 80;
  const maxWidth = 140;

  // Alignment ledges are a safety mechanism, not extra route choices. Build them from the lagging
  // endpoint forward in ordinary jump-sized steps. The older implementation stretched a generated
  // slot toward the farther sibling and could accidentally create the very oversized jump it was
  // meant to prevent after an asymmetric nested fork.
  for (let guard = 0; guard < 8; guard++) {
    const currentRight = platformEnvelope(current).right;
    const remaining = targetRight - currentRight;
    if (remaining <= maxRemaining) return { last: current, nextPlatformId };

    let width = maxWidth;
    let desiredX = currentRight + preferredGap;
    if (remaining <= preferredGap + maxWidth) {
      width = Math.max(minWidth, Math.min(maxWidth, remaining - preferredGap));
      desiredX = targetRight - width;
      if (desiredX - currentRight < MIN_PLATFORM_GAP_X) desiredX = currentRight + MIN_PLATFORM_GAP_X;
    }

    // Keep alignment almost level with the route endpoint. Vertical convergence toward the parent
    // lane can happen on the following ordinary platform; these bridges exist only to remove an
    // inherited horizontal lead from the other sibling.
    const y = Math.max(corridorMin, Math.min(corridorMax, current.position.y + Math.max(-36, Math.min(36, laneY - current.position.y))));
    const slotStart = desiredX - 6;
    const slotEnd = desiredX + width + 6;
    const connector = placeBranchPlatformWithoutOverlap({
      id: nextPlatformId++,
      width,
      height: PLATFORM_HEIGHT,
      position: { x: desiredX, y },
      structureType: side === 'upper' ? 'branch-upper' : 'branch-lower',
      branchGroupId: groupId,
      branchDepth: depth,
      routePath,
      rootBranchGroupId: rootGroupId,
    }, platforms, viewportHeight, slotStart, slotEnd, y, corridorMin, corridorMax);
    platforms.push(connector);
    current = connector;
  }

  return { last: current, nextPlatformId };
}

function baseJumpHorizontalReach(deltaY: number): number {
  // Discrete vertical integration in stepAgentPhysics is:
  //   y(n) = n * JUMP_STRENGTH + GRAVITY * n * (n + 1) / 2.
  // Use the descending root and the slower base Runner speed as the generation envelope. A small
  // margin keeps a mathematically exact edge catch from becoming the only possible solution.
  const a = GRAVITY / 2;
  const b = JUMP_STRENGTH + GRAVITY / 2;
  const discriminant = b * b + 4 * a * deltaY;
  if (discriminant < 0) return 0;
  const frames = (-b + Math.sqrt(discriminant)) / (2 * a);
  return Math.max(MIN_PLATFORM_GAP_X, MAX_SPEED * frames - 8);
}

/** Build an asymmetric branch tree. Each fork has a naturally sized local runway; recursive child
 * forks determine their own length and shorter siblings receive connective ledges afterward. This
 * avoids giant empty gaps while preserving route labels and explicit merge checkpoints. */
function buildBranchTree(
  platforms: PlatformState[],
  entryPlatform: PlatformState,
  viewportHeight: number,
  nextPlatformId: number,
  rng: () => number,
  terrain: TerrainRuntimeConfig,
  profile: TerrainBiomeProfile,
  depth: number,
  parentRoutePath: string | null,
  rootGroupId: number,
  forceMovingExposure = false,
  corridorMin = BRANCH_MIN_PLATFORM_Y,
  corridorMax = viewportHeight - BRANCH_BOTTOM_MARGIN
): BranchBuildResult {
  const groupId = nextPlatformId;
  const entryRight = platformEnvelope(entryPlatform).right;
  const mergeWidth = clampBiomeScale(240 * profile.platformWidthMultiplier, 195, 300);
  const entryGap = clampBiomeScale((depth === 1 ? 92 : 76) * profile.gapMultiplier, 68, 112);
  const mergeGap = clampBiomeScale((depth === 1 ? 108 : 88) * profile.gapMultiplier, 76, 128);

  // The configured value is a per-fork ceiling. Deeper forks tend to be shorter and less regular.
  const maxRouteCount = Math.max(1, terrain.maxPlatformsPerBranch - Math.max(0, depth - 1));
  const minRouteCount = maxRouteCount >= 2 ? 2 : 1;
  const routeRoll = clampBiomeScale(rng() + (profile.routePersistenceMultiplier - 1) * 0.55, 0, 0.999999);
  const routeCount = minRouteCount + Math.floor(routeRoll * (maxRouteCount - minRouteCount + 1));

  const canNest = terrain.subBranchingEnabled && depth < terrain.maxBranchDepth;
  let nestUpper = false;
  let nestLower = false;
  const nestChance = clampBiomeScale((depth === 1 ? 0.74 : depth === 2 ? 0.56 : 0.38) * profile.branchWeightMultiplier, 0.22, 0.9);
  if (canNest && rng() < nestChance) {
    if (rng() < 0.5) nestUpper = true;
    else nestLower = true;
    const bothChance = depth === 1 ? 0.30 : depth === 2 ? 0.17 : 0.08;
    if (rng() < bothChance) {
      nestUpper = true;
      nestLower = true;
    }
  }
  const routeCountsForNesting = (nested: boolean): { preCount: number; postCount: number } => {
    if (!nested || routeCount < 2) return { preCount: routeCount, postCount: 0 };
    const preCount = routeCount >= 3
      ? Math.min(routeCount - 1, Math.max(2, Math.ceil(routeCount * 0.55)))
      : 1;
    return { preCount, postCount: routeCount - preCount };
  };

  let [upperCommitY, lowerCommitY] = commitmentLanePair(
    entryPlatform.position.y,
    viewportHeight,
    corridorMin,
    corridorMax
  );
  const commitCenter = (upperCommitY + lowerCommitY) * 0.5;
  const commitScale = clampBiomeScale(0.9 + (profile.verticalVariationMultiplier - 1) * 0.34, 0.82, 1.22);
  upperCommitY = clampPlatformY(commitCenter + (upperCommitY - commitCenter) * commitScale, viewportHeight);
  lowerCommitY = clampPlatformY(commitCenter + (lowerCommitY - commitCenter) * commitScale, viewportHeight);
  const routeClearance = MIN_PLATFORM_CLEARANCE_Y + PLATFORM_HEIGHT;
  const routeSplitCenter = (upperCommitY + lowerCommitY) * 0.5;
  const routeSplitHalfGap = routeClearance * 0.5 + 4;
  const upperRouteCorridor: [number, number] = [
    corridorMin,
    Math.max(corridorMin, routeSplitCenter - routeSplitHalfGap),
  ];
  const lowerRouteCorridor: [number, number] = [
    Math.min(corridorMax, routeSplitCenter + routeSplitHalfGap),
    corridorMax,
  ];
  const computeReachableRouteLanes = (count: number, recurseUpper: boolean, recurseLower: boolean): [number, number] => {
    let [upper, lower] = routeLanePair(
      entryPlatform.position.y,
      depth,
      viewportHeight,
      rng,
      count,
      corridorMin,
      corridorMax,
      recurseUpper,
      recurseLower
    );
    upper = entryPlatform.position.y + (upper - entryPlatform.position.y) * profile.verticalVariationMultiplier;
    lower = entryPlatform.position.y + (lower - entryPlatform.position.y) * profile.verticalVariationMultiplier;
    const remainingTransitions = Math.max(0, count - 1);
    if (remainingTransitions === 0) return [upperCommitY, lowerCommitY];
    const maxLaneDelta = remainingTransitions * 134;
    upper = Math.max(upperCommitY - maxLaneDelta, Math.min(upperCommitY + maxLaneDelta, upper));
    lower = Math.max(lowerCommitY - maxLaneDelta, Math.min(lowerCommitY + maxLaneDelta, lower));
    upper = Math.max(upperRouteCorridor[0], Math.min(upperRouteCorridor[1], upper));
    lower = Math.max(lowerRouteCorridor[0], Math.min(lowerRouteCorridor[1], lower));
    return [upper, lower];
  };

  let { preCount, postCount } = routeCountsForNesting(nestUpper || nestLower);
  let [upperY, lowerY] = computeReachableRouteLanes(preCount, nestUpper, nestLower);

  // A recursive child is only materialized when its inherited vertical corridor can actually fit
  // another readable fork. This makes maxBranchDepth a ceiling instead of a command to squeeze a
  // fork into insufficient space. Recompute the local ramp when one proposed child is rejected.
  let bothSidesNest = nestUpper && nestLower;
  let upperChildCorridor = intersectCorridors(
    childBranchCorridor('upper', corridorMin, corridorMax, upperY, lowerY, bothSidesNest),
    upperRouteCorridor
  );
  let lowerChildCorridor = intersectCorridors(
    childBranchCorridor('lower', corridorMin, corridorMax, upperY, lowerY, bothSidesNest),
    lowerRouteCorridor
  );
  const initialNestUpper = nestUpper;
  const initialNestLower = nestLower;
  if (nestUpper && !corridorSupportsNestedFork(upperChildCorridor)) nestUpper = false;
  if (nestLower && !corridorSupportsNestedFork(lowerChildCorridor)) nestLower = false;

  if (nestUpper !== initialNestUpper || nestLower !== initialNestLower) {
    ({ preCount, postCount } = routeCountsForNesting(nestUpper || nestLower));
    [upperY, lowerY] = computeReachableRouteLanes(preCount, nestUpper, nestLower);
    bothSidesNest = nestUpper && nestLower;
    upperChildCorridor = intersectCorridors(
      childBranchCorridor('upper', corridorMin, corridorMax, upperY, lowerY, bothSidesNest),
      upperRouteCorridor
    );
    lowerChildCorridor = intersectCorridors(
      childBranchCorridor('lower', corridorMin, corridorMax, upperY, lowerY, bothSidesNest),
      lowerRouteCorridor
    );
  }

  const hasNested = nestUpper || nestLower;

  const branchBaseToken = `g${groupId}`;
  const upperPath = parentRoutePath ? `${parentRoutePath}/${branchBaseToken}U` : `${branchBaseToken}U`;
  const lowerPath = parentRoutePath ? `${parentRoutePath}/${branchBaseToken}L` : `${branchBaseToken}L`;

  // Use a bounded slot pitch rather than stretching a small route count across the whole recursive
  // branch. This keeps the first commitment landing and every ordinary continuation jumpable.
  const routePitch = clampBiomeScale((248 - (depth - 1) * 10 + (rng() - 0.5) * 30) * profile.gapMultiplier, 198, 282);
  const preStart = entryRight + entryGap;
  const preEnd = preStart + preCount * routePitch;
  const upperPre = addRoutePlatforms(
    platforms, preCount, preStart, preEnd, upperY, 'upper', upperPath, groupId, rootGroupId,
    depth, viewportHeight, nextPlatformId, rng, terrain, profile, forceMovingExposure, upperCommitY,
    upperRouteCorridor[0], upperRouteCorridor[1]
  );
  nextPlatformId = upperPre.nextPlatformId;
  const lowerPre = addRoutePlatforms(
    platforms, preCount, preStart, preEnd, lowerY, 'lower', lowerPath, groupId, rootGroupId,
    depth, viewportHeight, nextPlatformId, rng, terrain, profile, forceMovingExposure, lowerCommitY,
    lowerRouteCorridor[0], lowerRouteCorridor[1]
  );
  nextPlatformId = lowerPre.nextPlatformId;

  let upperLast = upperPre.last;
  let lowerLast = lowerPre.last;

  if (hasNested) {
    if (nestUpper) {
      const child = buildBranchTree(
        platforms, upperLast, viewportHeight, nextPlatformId, rng, terrain, profile, depth + 1, upperPath,
        rootGroupId, false, upperChildCorridor[0], upperChildCorridor[1]
      );
      nextPlatformId = child.nextPlatformId;
      upperLast = child.merge;
    }
    if (nestLower) {
      const child = buildBranchTree(
        platforms, lowerLast, viewportHeight, nextPlatformId, rng, terrain, profile, depth + 1, lowerPath,
        rootGroupId, false, lowerChildCorridor[0], lowerChildCorridor[1]
      );
      nextPlatformId = child.nextPlatformId;
      lowerLast = child.merge;
    }

    // Align the shorter sibling with stationary transit ledges. Re-evaluate a few times because a
    // collision-safe local fallback can legitimately move one connector slightly farther right.
    for (let pass = 0; pass < 3; pass++) {
      const targetRight = Math.max(platformEnvelope(upperLast).right, platformEnvelope(lowerLast).right);
      const upperAligned = extendRouteTowardX(
        platforms, upperLast, targetRight, upperY, 'upper', upperPath, groupId, rootGroupId,
        depth, viewportHeight, nextPlatformId, rng, terrain, profile,
        upperRouteCorridor[0], upperRouteCorridor[1]
      );
      nextPlatformId = upperAligned.nextPlatformId;
      upperLast = upperAligned.last;
      const lowerAligned = extendRouteTowardX(
        platforms, lowerLast, Math.max(targetRight, platformEnvelope(upperLast).right), lowerY, 'lower', lowerPath,
        groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain, profile,
        lowerRouteCorridor[0], lowerRouteCorridor[1]
      );
      nextPlatformId = lowerAligned.nextPlatformId;
      lowerLast = lowerAligned.last;
      if (Math.abs(platformEnvelope(upperLast).right - platformEnvelope(lowerLast).right) <= 155) break;
    }

    if (postCount > 0) {
      const alignedRight = Math.max(platformEnvelope(upperLast).right, platformEnvelope(lowerLast).right);
      const postStart = alignedRight + 64;
      const postPitch = Math.max(200, routePitch - 10);
      const postEnd = postStart + postCount * postPitch;
      const upperPost = addRoutePlatforms(
        platforms, postCount, postStart, postEnd, upperY, 'upper', upperPath, groupId, rootGroupId,
        depth, viewportHeight, nextPlatformId, rng, terrain, profile, false, upperLast.position.y,
        upperRouteCorridor[0], upperRouteCorridor[1]
      );
      nextPlatformId = upperPost.nextPlatformId;
      upperLast = upperPost.last;
      const lowerPost = addRoutePlatforms(
        platforms, postCount, postStart, postEnd, lowerY, 'lower', lowerPath, groupId, rootGroupId,
        depth, viewportHeight, nextPlatformId, rng, terrain, profile, false, lowerLast.position.y,
        lowerRouteCorridor[0], lowerRouteCorridor[1]
      );
      nextPlatformId = lowerPost.nextPlatformId;
      lowerLast = lowerPost.last;
    }
  }

  // Normalize any remaining sibling lead before the merge. This also covers non-nested branches:
  // independent platform widths and collision-safe placement can otherwise leave one endpoint much
  // farther behind than the other.
  for (let pass = 0; pass < 4; pass++) {
    const targetRight = Math.max(platformEnvelope(upperLast).right, platformEnvelope(lowerLast).right);
    const upperAligned = extendRouteTowardX(
      platforms, upperLast, targetRight, upperY, 'upper', upperPath, groupId, rootGroupId, depth,
      viewportHeight, nextPlatformId, rng, terrain, profile, upperRouteCorridor[0], upperRouteCorridor[1], 80
    );
    nextPlatformId = upperAligned.nextPlatformId;
    upperLast = upperAligned.last;
    const lowerAligned = extendRouteTowardX(
      platforms, lowerLast, Math.max(targetRight, platformEnvelope(upperLast).right), lowerY, 'lower', lowerPath,
      groupId, rootGroupId, depth, viewportHeight, nextPlatformId, rng, terrain, profile,
      lowerRouteCorridor[0], lowerRouteCorridor[1], 80
    );
    nextPlatformId = lowerAligned.nextPlatformId;
    lowerLast = lowerAligned.last;
    if (Math.abs(platformEnvelope(upperLast).right - platformEnvelope(lowerLast).right) <= 80) break;
  }

  // The merge is positioned from the COMPLETE swept envelopes, so a nearby moving route platform
  // can never sweep through the rejoin point. Merges themselves remain stationary checkpoints.
  const resolvedRouteRight = Math.max(platformEnvelope(upperLast).right, platformEnvelope(lowerLast).right);
  const naturalMergeY = clampPlatformY((upperLast.position.y + lowerLast.position.y) / 2 + (rng() - 0.5) * 20 * clampBiomeScale(profile.verticalVariationMultiplier, 0.75, 1.3), viewportHeight);
  // Rejoining should not secretly be the hardest upward jump in the branch. The lower route may
  // need to climb back toward the midpoint, so cap that climb while allowing the upper route's
  // descent to stay generous.
  const mergeReachabilityFloor = Math.max(upperLast.position.y, lowerLast.position.y) - 126;
  const mergeY = clampPlatformY(Math.max(naturalMergeY, mergeReachabilityFloor), viewportHeight);
  const upperRight = platformEnvelope(upperLast).right;
  const lowerRight = platformEnvelope(lowerLast).right;
  const minMergeLeftX = resolvedRouteRight + Math.max(MIN_PLATFORM_GAP_X, MIN_PLATFORM_CLEARANCE_X);
  const desiredMergeLeftX = resolvedRouteRight + mergeGap;
  const maxMergeLeftFromUpper = upperRight + baseJumpHorizontalReach(mergeY - upperLast.position.y);
  const maxMergeLeftFromLower = lowerRight + baseJumpHorizontalReach(mergeY - lowerLast.position.y);
  const mergeLeftX = Math.max(
    minMergeLeftX,
    Math.min(desiredMergeLeftX, maxMergeLeftFromUpper, maxMergeLeftFromLower)
  );
  const mergeRightX = mergeLeftX + mergeWidth;
  const merge = placeBranchPlatformWithoutOverlap({
    id: nextPlatformId++,
    width: mergeWidth,
    height: PLATFORM_HEIGHT,
    position: { x: mergeLeftX, y: mergeY },
    structureType: 'merge',
    branchGroupId: groupId,
    branchDepth: depth,
    mergeToRoutePath: parentRoutePath,
    rootBranchGroupId: rootGroupId,
  }, platforms, viewportHeight, mergeLeftX - 6, mergeRightX + 6, mergeY, corridorMin, corridorMax);
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
  const profileAtX = terrainProfileForRuntimeAtX(terrain, baseRight);
  const terrainAtX = terrainRuntimeForBiomeX(terrain, baseRight);
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
    forceFirstEarlyBranch || forceSecondEarlyBranch || forceRecurringBranch || rng() < branchChanceAtX(baseRight, branchMinX, terrainAtX)
  );
  const hasMovingPlatform = terrain.guaranteeMovingExposure && platforms.some(platform => !!platform.motion);
  const needsGuaranteedMoving = terrain.movingPlatformsEnabled && terrain.guaranteeMovingExposure && !hasMovingPlatform;

  // A training episode selected for moving terrain must actually expose both policies to it. If
  // moving platforms are disallowed inside branches, emit one guaranteed moving trunk platform
  // before a forced branch rather than letting the feature percentage become merely probabilistic.
  if (needsGuaranteedMoving && shouldBranch && !terrainAtX.movingPlatformsInBranches) {
    const p = generatePlatform(baseRight, rightmostPlatform.position.y, viewportHeight, nextPlatformId++, rng, false, terrainAtX, true, platforms, profileAtX);
    platforms.push(p);
    return { rightmost: p, nextPlatformId };
  }

  if (!shouldBranch) {
    const p = generatePlatform(baseRight, rightmostPlatform.position.y, viewportHeight, nextPlatformId++, rng, false, terrainAtX, needsGuaranteedMoving, platforms, profileAtX);
    platforms.push(p);
    return { rightmost: p, nextPlatformId };
  }

  // A route decision should begin from a stable staging ledge. Branching directly from an
  // oscillating platform made the apparent first jump vary by motion phase and could turn a clean
  // fork into a timing accident. Insert one ordinary stationary transition when necessary.
  let branchEntry = rightmostPlatform;
  if (rightmostPlatform.motion) {
    const stationaryTerrain: TerrainRuntimeConfig = { ...terrainAtX, movingPlatformsEnabled: false };
    branchEntry = generatePlatform(
      baseRight,
      rightmostPlatform.position.y,
      viewportHeight,
      nextPlatformId++,
      rng,
      false,
      stationaryTerrain,
      false,
      platforms,
      profileAtX
    );
    platforms.push(branchEntry);
  }

  const rootGroupId = nextPlatformId;
  const built = buildBranchTree(
    platforms,
    branchEntry,
    viewportHeight,
    nextPlatformId,
    rng,
    terrainAtX,
    profileAtX,
    1,
    null,
    rootGroupId,
    needsGuaranteedMoving && terrainAtX.movingPlatformsInBranches
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
    platform.previousPosition = { ...platform.position };
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
      if (!agent.isOnGround || agent.supportingAgentId != null || agent.lastPlatformId !== platform.id) continue;
      // Keep the platform-normal coordinate exact. Incremental += dy is vulnerable to tiny
      // floating-point/contact-correction drift; on a vertical platform that drift can put the
      // feet microscopically below the one-way top and make the next landing test reject support.
      // Horizontal motion must preserve the rider's local X offset, while vertical motion can snap
      // directly to the known top because this body is already the platform's grounded rider.
      if (motion.axis === 'y') {
        agent.position.y = platform.position.y - AGENT_HEIGHT;
        agent.positionAtLastTakeoff.y = agent.position.y;
      } else {
        agent.position.x += dx;
        agent.positionAtLastTakeoff.x += dx;
      }
      for (const rider of agents) {
        if (rider.status === AgentStatus.It || agent.status === AgentStatus.It || rider.supportingAgentId !== agent.id) continue;
        rider.position.x += dx;
        rider.position.y += dy;
      }
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
      const newPlatform = generatePlatform(leftmostPlatform.position.x, leftmostPlatform.position.y, viewportSize.height, nextPlatformId++, rng, true, terrain, false, platforms);
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
