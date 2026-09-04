import { LearningAgent } from './agent';
import { getAgentStateVector } from './state';
import { getFairRespawn } from './respawn';
import type { ActiveUpgradeState, AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  AGENT_COLORS,
  AGENT_ACCELERATION,
  FRICTION,
  MAX_SPEED,
  JUMP_STRENGTH,
  SPRINT_MAX_SPEED,
  SPRINT_ACCELERATION_MULTIPLIER,
  SPRINT_ENERGY_COST_PER_SEC,
  CONTROLLED_JUMP_MIN_POWER_RATIO,
  CONTROLLED_JUMP_MIN_ENERGY_COST,
  GRAVITY,
  MAX_ENERGY,
  ENERGY_REGEN_RATE,
  JUMP_ENERGY_COST,
  FALL_BOUNDARY,
  PLATFORM_MIN_WIDTH,
  PLATFORM_MAX_WIDTH,
  PLATFORM_HEIGHT,
  MIN_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_Y,
  NEAT_EPISODE_MAX_MS,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
  ACTION_SPACE,
} from '../constants';

const DT = 16.67;

export interface TrainingEpisodeResult {
  chaserFitness: number;
  evaderFitness: number;
  tagged: boolean;
  terminalFallRole: 'chaser' | 'evader' | null;
  elapsedMs: number;
  falls: number;
  jumps: number;
  chaserActionCounts: number[];
  evaderActionCounts: number[];
}

export interface TrainingEpisodeOptions {
  trackChaserActions?: boolean;
  trackEvaderActions?: boolean;
  viewportSize?: { width: number; height: number };
  upgrades?: ActiveUpgradeState;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeAgent(id: number, x: number, role: 'chaser' | 'evader', viewportHeight: number): AgentState {
  return {
    id,
    position: { x, y: viewportHeight - 100 - AGENT_HEIGHT },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    status: role === 'chaser' ? AgentStatus.It : AgentStatus.Normal,
    role,
    elo: 0,
    color: AGENT_COLORS[id - 1] || AGENT_COLORS[0],
    isOnGround: true,
    cooldownTimer: 0,
    lastAction: 'wait',
    energy: MAX_ENERGY,
    maxEnergy: MAX_ENERGY,
    trajectory: [],
    lastPlatformId: 0,
    scale: { x: 1, y: 1 },
    energyAtLastTakeoff: MAX_ENERGY,
    positionAtLastTakeoff: { x, y: viewportHeight - 100 - AGENT_HEIGHT },
    survivalTime: 0,
    timeSinceBecameIt: 0,
    modelId: role === 'chaser' ? 'current_chaser' : 'current_evader',
  };
}

function createEpisodeState(seed: number, viewportSize: { width: number; height: number }): GameState {
  const rng = mulberry32(seed);
  const baseY = viewportSize.height - 100;
  const platforms: PlatformState[] = [
    { id: 0, position: { x: -200, y: baseY }, width: viewportSize.width + 400, height: PLATFORM_HEIGHT },
  ];

  let last = platforms[0];
  let id = 1;
  const targetX = viewportSize.width + 6500;
  while (last.position.x + last.width < targetX) {
    let gapX = MIN_PLATFORM_GAP_X + rng() * (MAX_PLATFORM_GAP_X - MIN_PLATFORM_GAP_X);
    const gapY = (rng() - 0.5) * MAX_PLATFORM_GAP_Y * 1.5;
    const newY = Math.min(viewportSize.height - 120, Math.max(250, last.position.y + gapY));
    const verticalDifference = newY - last.position.y;
    if (verticalDifference < -100) gapX = Math.max(MIN_PLATFORM_GAP_X, Math.min(gapX, 90));
    else if (verticalDifference > 80) gapX = Math.max(gapX, 140);
    const width = PLATFORM_MIN_WIDTH + rng() * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH);
    const next: PlatformState = {
      id: id++,
      position: { x: last.position.x + last.width + gapX, y: newY },
      width,
      height: PLATFORM_HEIGHT,
    };
    platforms.push(next);
    last = next;
  }

  return {
    agents: [
      makeAgent(1, 120, 'chaser', viewportSize.height),
      makeAgent(2, 520, 'evader', viewportSize.height),
      makeAgent(3, 790, 'evader', viewportSize.height),
    ],
    platforms,
    cameraPosition: { x: 0, y: 0 },
    gameTime: 0,
    tagEffects: [],
    avgSurvivalTime: 0,
    avgTimeToTag: 0,
  };
}

/**
 * Headless evaluation using the ORIGINAL discrete locomotion and ORIGINAL 39-D/LiDAR senses.
 * This intentionally mirrors the first project's episode physics and fitness terms. The newer
 * worker pool only changes how many independent episodes can be evaluated concurrently.
 */
export function runTrainingEpisode(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  options: TrainingEpisodeOptions = {}
): TrainingEpisodeResult {
  const viewportSize = options.viewportSize || { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT };
  const trackChaserActions = options.trackChaserActions !== false;
  const trackEvaderActions = options.trackEvaderActions !== false;
  const gameState = createEpisodeState(seed, viewportSize);
  const upgrades: ActiveUpgradeState = options.upgrades || {
    sprint: false, controlledJump: false,
    sprintChaser: false, sprintRunner: false,
    controlledJumpChaser: false, controlledJumpRunner: false,
    sprintChaserMaxSpeed: SPRINT_MAX_SPEED, sprintRunnerMaxSpeed: SPRINT_MAX_SPEED,
    sprintChaserStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC, sprintRunnerStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC,
  };
  const chaserAgent = gameState.agents[0];
  const evaders = gameState.agents.slice(1);

  const initialClosestDistance = Math.min(
    ...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y))
  );
  const initialChaserX = chaserAgent.position.x;
  const initialEvaderXs = evaders.map(e => e.position.x);
  let maxChaserX = initialChaserX;
  const maxEvaderXs = [...initialEvaderXs];
  let cumulativeClosestDistance = 0;
  let distanceSamples = 0;
  let chaserFalls = 0;
  let evaderFalls = 0;
  let chaserJumps = 0;
  let evaderJumps = 0;
  let tagged = false;
  let terminalFallRole: 'chaser' | 'evader' | null = null;

  const chaserActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const evaderActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);

  for (let step = 0; step < maxSteps && !tagged && !terminalFallRole; step++) {
    gameState.gameTime += DT;
    chaserAgent.timeSinceBecameIt += DT;
    evaders.forEach(a => (a.survivalTime += DT));

    const actionIndices = new Array<number>(gameState.agents.length);
    const actionStrengths = new Array<number>(gameState.agents.length).fill(0);
    for (let i = 0; i < gameState.agents.length; i++) {
      const agent = gameState.agents[i];
      const controller = agent.id === 1 ? chaser : evader;
      const state = getAgentStateVector(agent, gameState, viewportSize);
      const { actionIndex, actionStrength } = controller.chooseAction(state);
      actionIndices[i] = actionIndex;
      actionStrengths[i] = actionStrength;
      if (agent.id === 1) {
        if (trackChaserActions) chaserActionCounts[actionIndex]++;
      } else if (trackEvaderActions) {
        evaderActionCounts[actionIndex]++;
      }
    }

    for (let i = 0; i < gameState.agents.length; i++) {
      const agent = gameState.agents[i];
      const actionIndex = actionIndices[i] ?? ACTION_SPACE.indexOf('wait');
      const action = ACTION_SPACE[actionIndex] || 'wait';
      const actionStrength = actionStrengths[i] || 0;
      agent.lastAction = action;
      agent.energy = Math.min(agent.maxEnergy, agent.energy + ENERGY_REGEN_RATE * (DT / 1000));
      agent.acceleration.x = 0;

      const isChaserRole = agent.id === 1;
      const sprintEnabledForRole = upgrades.sprint && (isChaserRole ? upgrades.sprintChaser : upgrades.sprintRunner);
      const controlledJumpEnabledForRole = upgrades.controlledJump && (isChaserRole ? upgrades.controlledJumpChaser : upgrades.controlledJumpRunner);
      const roleSprintMaxSpeed = isChaserRole ? upgrades.sprintChaserMaxSpeed : upgrades.sprintRunnerMaxSpeed;
      const roleSprintStaminaCost = isChaserRole ? upgrades.sprintChaserStaminaCostPerSec : upgrades.sprintRunnerStaminaCostPerSec;
      const isMoveAction = action === 'move_left' || action === 'move_right';
      const sprintIntensity = sprintEnabledForRole && isMoveAction && agent.energy > 0
        ? actionStrength
        : 0;
      const accelerationScale = 1 + (SPRINT_ACCELERATION_MULTIPLIER - 1) * sprintIntensity;
      if (action === 'move_left') agent.acceleration.x = -AGENT_ACCELERATION * accelerationScale;
      else if (action === 'move_right') agent.acceleration.x = AGENT_ACCELERATION * accelerationScale;

      const velocity = { ...agent.velocity };
      if (Math.abs(agent.acceleration.x) < 0.1) velocity.x *= FRICTION;
      velocity.x += agent.acceleration.x;
      const maxHorizontalSpeed = MAX_SPEED + (roleSprintMaxSpeed - MAX_SPEED) * sprintIntensity;
      velocity.x = Math.max(-maxHorizontalSpeed, Math.min(maxHorizontalSpeed, velocity.x));
      if (sprintIntensity > 0) {
        agent.energy = Math.max(0, agent.energy - roleSprintStaminaCost * sprintIntensity * (DT / 1000));
      }
      agent.sprintIntensity = sprintIntensity;

      if (action === 'jump' && agent.isOnGround) {
        const jumpPower = controlledJumpEnabledForRole
          ? CONTROLLED_JUMP_MIN_POWER_RATIO + (1 - CONTROLLED_JUMP_MIN_POWER_RATIO) * actionStrength
          : 1;
        const jumpCost = controlledJumpEnabledForRole
          ? CONTROLLED_JUMP_MIN_ENERGY_COST + (JUMP_ENERGY_COST - CONTROLLED_JUMP_MIN_ENERGY_COST) * jumpPower * jumpPower
          : JUMP_ENERGY_COST;
        if (agent.energy >= jumpCost) {
          velocity.y = JUMP_STRENGTH * jumpPower;
          agent.energy -= jumpCost;
          agent.jumpPower = jumpPower;
          if (agent.id === 1) chaserJumps++;
          else evaderJumps++;
        }
      }

      velocity.y += GRAVITY;
      const nextPosition = { x: agent.position.x + velocity.x, y: agent.position.y + velocity.y };
      const minVisibleX = gameState.cameraPosition.x;
      const maxVisibleX = gameState.cameraPosition.x + viewportSize.width - AGENT_WIDTH;
      agent.touchingCameraFrame = false;
      agent.cameraFrameContact = null;
      if (nextPosition.x < minVisibleX) {
        nextPosition.x = minVisibleX;
        velocity.x = 0;
        agent.touchingCameraFrame = true;
        agent.cameraFrameContact = 'left';
      } else if (nextPosition.x > maxVisibleX) {
        nextPosition.x = maxVisibleX;
        velocity.x = 0;
        agent.touchingCameraFrame = true;
        agent.cameraFrameContact = 'right';
      }

      let grounded = false;
      let landedPlatformId = agent.lastPlatformId;
      for (const platform of gameState.platforms) {
        const prevBottom = agent.position.y + AGENT_HEIGHT;
        const nextBottom = nextPosition.y + AGENT_HEIGHT;
        const aligned =
          nextPosition.x + AGENT_WIDTH > platform.position.x &&
          nextPosition.x < platform.position.x + platform.width;
        if (
          aligned &&
          prevBottom <= platform.position.y + 8 &&
          nextBottom >= platform.position.y &&
          velocity.y >= 0
        ) {
          nextPosition.y = platform.position.y - AGENT_HEIGHT;
          velocity.y = 0;
          grounded = true;
          landedPlatformId = platform.id;
          break;
        }
      }

      // Record the most recent real grounded location as the recovery checkpoint.
      // This mirrors the champion game even though a training fall is terminal.
      if (grounded) {
        agent.positionAtLastTakeoff = { ...nextPosition };
        agent.energyAtLastTakeoff = agent.energy;
      }

      if (nextPosition.y > FALL_BOUNDARY) {
        if (agent.id === 1) {
          chaserFalls++;
          terminalFallRole = terminalFallRole || 'chaser';
        } else {
          evaderFalls++;
          terminalFallRole = terminalFallRole || 'evader';
        }

        // Use the same fair deterministic recovery policy as the champion game. Training
        // still terminates on this frame, so the spawn cannot be exploited for fitness.
        const respawn = getFairRespawn(agent, gameState.platforms, gameState.agents, {
          minX: gameState.cameraPosition.x,
          maxX: gameState.cameraPosition.x + viewportSize.width - AGENT_WIDTH,
        });
        nextPosition.x = respawn.position.x;
        nextPosition.y = respawn.position.y;
        velocity.x = 0;
        velocity.y = 0;
        grounded = true;
        landedPlatformId = respawn.platformId;
      }

      agent.position = nextPosition;
      agent.velocity = velocity;
      agent.isOnGround = grounded;
      agent.lastPlatformId = landedPlatformId;

      // The first fall decides the evaluation outcome on this frame. Do not advance
      // the remaining agents after that terminal mistake.
      if (terminalFallRole) break;
    }

    // Tag ends the episode. A fall also ends evaluation, so skip contact scoring once
    // either role has already lost by falling. Roles never swap during evolutionary evaluation.
    if (!terminalFallRole) for (const evaderAgent of evaders) {
      const dx = chaserAgent.position.x - evaderAgent.position.x;
      const dy = chaserAgent.position.y - evaderAgent.position.y;
      if (Math.hypot(dx, dy) < (AGENT_WIDTH + AGENT_HEIGHT) / 2) {
        tagged = true;
        break;
      }
    }

    const minX = Math.min(...evaders.map(a => a.position.x));
    const maxX = Math.max(...evaders.map(a => a.position.x + AGENT_WIDTH));
    const desiredCameraX = (minX + maxX) / 2 - viewportSize.width * 0.45;
    gameState.cameraPosition.x += (desiredCameraX - gameState.cameraPosition.x) * 0.12;
    gameState.cameraPosition.x = Math.max(0, gameState.cameraPosition.x);

    const closestDistance = Math.min(
      ...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y))
    );
    cumulativeClosestDistance += closestDistance;
    distanceSamples++;
    maxChaserX = Math.max(maxChaserX, chaserAgent.position.x);
    evaders.forEach((e, i) => (maxEvaderXs[i] = Math.max(maxEvaderXs[i], e.position.x)));
  }

  const elapsedMs = gameState.gameTime;
  const elapsedSec = elapsedMs / 1000;
  const maxSec = NEAT_EPISODE_MAX_MS / 1000;
  const finalClosestDistance = Math.min(
    ...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y))
  );
  const averageDistance = cumulativeClosestDistance / Math.max(1, distanceSamples);
  const closingGain = initialClosestDistance - finalClosestDistance;
  const chaserProgress = Math.max(0, maxChaserX - initialChaserX);
  const evaderProgress =
    maxEvaderXs.reduce((sum, x, i) => sum + Math.max(0, x - initialEvaderXs[i]), 0) / evaders.length;

  // Fall outcomes are asymmetric by role:
  // - Runner fall: scored exactly as a successful tag for the chaser / tagged loss for the runner.
  // - Chaser fall: scored through the same no-catch branch as a chase that reaches the time limit.
  //   The episode can still terminate immediately for throughput, but there is no extra fall-only
  //   fitness punishment for the chaser. The runner receives the same full-survival outcome base
  //   it would receive when the chaser simply fails to catch anyone before timeout.
  // Actual tag telemetry remains separate via `tagged`, so falls do not inflate tag-rate diagnostics.
  const runnerDefeated = tagged || terminalFallRole === 'evader';
  const chaserFailedToCatch = !runnerDefeated;

  const chaserFitness = Math.max(
    0.01,
    (runnerDefeated ? 120 + (maxSec - elapsedSec) * 8 : 10) +
      closingGain * 0.12 +
      chaserProgress * 0.025 +
      chaserJumps * 0.2 -
      averageDistance * 0.01
  );

  const evaderOutcomeBase = runnerDefeated
    ? elapsedSec * 8
    : chaserFailedToCatch
      ? maxSec * 8 + 80
      : elapsedSec * 8 + 80;

  const evaderFitness = Math.max(
    0.01,
    evaderOutcomeBase +
      averageDistance * 0.015 +
      evaderProgress * 0.02 +
      evaderJumps * 0.15
  );

  return {
    chaserFitness,
    evaderFitness,
    tagged,
    terminalFallRole,
    elapsedMs,
    falls: chaserFalls + evaderFalls,
    jumps: chaserJumps + evaderJumps,
    chaserActionCounts,
    evaderActionCounts,
  };
}
