import { LearningAgent } from './agent';
import { getAgentStateVector } from './state';
import type { AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  AGENT_COLORS,
  AGENT_ACCELERATION,
  FRICTION,
  MAX_SPEED,
  JUMP_STRENGTH,
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

  const chaserActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const evaderActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);

  for (let step = 0; step < maxSteps && !tagged; step++) {
    gameState.gameTime += DT;
    chaserAgent.timeSinceBecameIt += DT;
    evaders.forEach(a => (a.survivalTime += DT));

    const actionIndices = new Array<number>(gameState.agents.length);
    for (let i = 0; i < gameState.agents.length; i++) {
      const agent = gameState.agents[i];
      const controller = agent.id === 1 ? chaser : evader;
      const state = getAgentStateVector(agent, gameState, viewportSize);
      const { actionIndex } = controller.chooseAction(state);
      actionIndices[i] = actionIndex;
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
      agent.lastAction = action;
      agent.energy = Math.min(agent.maxEnergy, agent.energy + ENERGY_REGEN_RATE * (DT / 1000));
      agent.acceleration.x = 0;
      if (action === 'move_left') agent.acceleration.x = -AGENT_ACCELERATION;
      else if (action === 'move_right') agent.acceleration.x = AGENT_ACCELERATION;

      const velocity = { ...agent.velocity };
      if (Math.abs(agent.acceleration.x) < 0.1) velocity.x *= FRICTION;
      velocity.x += agent.acceleration.x;
      velocity.x = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity.x));

      if (action === 'jump' && agent.isOnGround && agent.energy >= JUMP_ENERGY_COST) {
        velocity.y = JUMP_STRENGTH;
        agent.energy -= JUMP_ENERGY_COST;
        if (agent.id === 1) chaserJumps++;
        else evaderJumps++;
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

      if (nextPosition.y > FALL_BOUNDARY) {
        if (agent.id === 1) chaserFalls++;
        else evaderFalls++;
        const candidates = gameState.platforms.filter(
          p =>
            p.position.x + p.width >= gameState.cameraPosition.x &&
            p.position.x <= gameState.cameraPosition.x + viewportSize.width
        );
        const spawn = (candidates.length ? candidates : gameState.platforms).reduce((best, p) => {
          const d = Math.abs(p.position.x + p.width / 2 - agent.position.x);
          const bestD = Math.abs(best.position.x + best.width / 2 - agent.position.x);
          return d < bestD ? p : best;
        });
        nextPosition.x = spawn.position.x + spawn.width / 2 - AGENT_WIDTH / 2;
        nextPosition.y = spawn.position.y - AGENT_HEIGHT - 20;
        velocity.x = 0;
        velocity.y = 0;
        agent.energy = MAX_ENERGY;
        grounded = false;
        landedPlatformId = spawn.id;
      }

      agent.position = nextPosition;
      agent.velocity = velocity;
      agent.isOnGround = grounded;
      agent.lastPlatformId = landedPlatformId;
    }

    // Tag ends the episode. Roles never swap during evolutionary evaluation.
    for (const evaderAgent of evaders) {
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

  // Fitness is intentionally retained from the initial version.
  const chaserFitness = Math.max(
    0.01,
    (tagged ? 120 + (maxSec - elapsedSec) * 8 : 10) +
      closingGain * 0.12 +
      chaserProgress * 0.025 +
      chaserJumps * 0.2 -
      chaserFalls * 12 -
      averageDistance * 0.01
  );
  const evaderFitness = Math.max(
    0.01,
    elapsedSec * 8 +
      (tagged ? 0 : 80) +
      averageDistance * 0.015 +
      evaderProgress * 0.02 +
      evaderJumps * 0.15 -
      evaderFalls * 15
  );

  return {
    chaserFitness,
    evaderFitness,
    tagged,
    elapsedMs,
    falls: chaserFalls + evaderFalls,
    jumps: chaserJumps + evaderJumps,
    chaserActionCounts,
    evaderActionCounts,
  };
}
