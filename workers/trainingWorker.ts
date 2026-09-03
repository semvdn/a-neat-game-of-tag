import { LearningAgent, type AgentWeights, type AgentControls } from '../learning/agent';
import { getPhysiology, stepLocomotion } from '../learning/movement';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, type NeatGenerationMetrics, type NeatGenomeData } from '../learning/neat';
import { getAgentStateVector } from '../learning/state';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import type { AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  AGENT_COLORS,
  GRAVITY,
  MAX_ENERGY,
  FALL_BOUNDARY,
  PLATFORM_MIN_WIDTH,
  PLATFORM_MAX_WIDTH,
  PLATFORM_HEIGHT,
  MIN_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_Y,
  INITIAL_ELO,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  NEAT_POPULATION_SIZE,
  NEAT_OPPONENTS_PER_GENOME,
  NEAT_EPISODE_MAX_MS,
  NEAT_COMPATIBILITY_THRESHOLD,
  NEAT_TARGET_SPECIES,
  NEAT_CROSSOVER_RATE,
  NEAT_WEIGHT_MUTATION_RATE,
  NEAT_ADD_NODE_RATE,
  NEAT_ADD_CONNECTION_RATE,
} from '../constants';

const DT = 16.67;
const neatConfig = {
  ...DEFAULT_NEAT_CONFIG,
  populationSize: NEAT_POPULATION_SIZE,
  compatibilityThreshold: NEAT_COMPATIBILITY_THRESHOLD,
  targetSpecies: NEAT_TARGET_SPECIES,
  crossoverRate: NEAT_CROSSOVER_RATE,
  weightMutationRate: NEAT_WEIGHT_MUTATION_RATE,
  addNodeRate: NEAT_ADD_NODE_RATE,
  addConnectionRate: NEAT_ADD_CONNECTION_RATE,
};

let chaserPopulation = new NeatPopulation('chaser', neatConfig);
let evaderPopulation = new NeatPopulation('evader', neatConfig);
let chaserControllers = chaserPopulation.genomes.map(g => new LearningAgent('chaser', g));
let evaderControllers = evaderPopulation.genomes.map(g => new LearningAgent('evader', g));

let championChaser = new LearningAgent('chaser', chaserPopulation.genomes[0]);
let championEvader = new LearningAgent('evader', evaderPopulation.genomes[0]);
let lastChaserMetrics: NeatGenerationMetrics | null = null;
let lastEvaderMetrics: NeatGenerationMetrics | null = null;

let isRunning = false;
let speedMultiplier = 25;
let timerId: ReturnType<typeof setTimeout> | null = null;
let viewportSize = { width: 1200, height: 800 };
let seededFromStart = false;

let evaluationIndex = 0;
let evaluationRound = 0;
let chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);

let totalTags = 0;
let totalFalls = 0;
let totalJumps = 0;
let totalSimulatedTime = 0;
let chaserElo = INITIAL_ELO;
let evaderElo = INITIAL_ELO;
let lastSampleGameState: GameState | null = null;
const recentSurvivalTimes: number[] = [];
const recentTimesToTag: number[] = [];
const actionCountsChaser: Record<string, number> = {};
const actionCountsEvader: Record<string, number> = {};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeAgent(id: number, x: number, role: 'chaser' | 'evader'): AgentState {
  const physiology = getPhysiology(role);
  return {
    id,
    position: { x, y: viewportSize.height - 100 - AGENT_HEIGHT },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    status: role === 'chaser' ? AgentStatus.It : AgentStatus.Normal,
    role,
    elo: role === 'chaser' ? chaserElo : evaderElo,
    color: AGENT_COLORS[id - 1] || AGENT_COLORS[0],
    isOnGround: true,
    cooldownTimer: 0,
    lastAction: 'wait',
    energy: physiology.energyCapacity,
    maxEnergy: physiology.energyCapacity,
    trajectory: [],
    lastPlatformId: 0,
    scale: { x: 1, y: 1 },
    energyAtLastTakeoff: physiology.energyCapacity,
    positionAtLastTakeoff: { x, y: viewportSize.height - 100 - AGENT_HEIGHT },
    survivalTime: 0,
    timeSinceBecameIt: 0,
    modelId: role === 'chaser' ? 'current_chaser' : 'current_evader',
  };
}

function createEpisodeState(seed: number): { gameState: GameState; flowDirection: 1 | -1 } {
  const rng = mulberry32(seed);
  // Seed parity guarantees both orientations are seen across the three evaluation rounds.
  const mirrored = (seed & 1) === 1;
  const flowDirection: 1 | -1 = mirrored ? -1 : 1;
  const baseY = viewportSize.height - 100;
  let platforms: PlatformState[] = [
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

  // Randomize spacing and translation enough to prevent memorizing exact start coordinates.
  const spread = 0.88 + rng() * 0.24;
  const shift = (rng() - 0.5) * 90;
  let startXs = [120 + shift, 120 + 400 * spread + shift, 120 + 670 * spread + shift];

  if (mirrored) {
    const mirrorRectX = (x: number, width: number) => viewportSize.width - (x + width);
    platforms = platforms.map(platform => ({
      ...platform,
      position: { ...platform.position, x: mirrorRectX(platform.position.x, platform.width) },
    }));
    startXs = startXs.map(x => mirrorRectX(x, AGENT_WIDTH));
  }

  return {
    flowDirection,
    gameState: {
      agents: [makeAgent(1, startXs[0], 'chaser'), makeAgent(2, startXs[1], 'evader'), makeAgent(3, startXs[2], 'evader')],
      platforms,
      cameraPosition: { x: 0, y: 0 },
      gameTime: 0,
      tagEffects: [],
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
    },
  };
}

interface EpisodeStats {
  chaserFitness: number;
  evaderFitness: number;
  tagged: boolean;
  elapsedMs: number;
  falls: number;
  jumps: number;
  gameState: GameState;
}

function runEpisode(chaser: LearningAgent, evader: LearningAgent, seed: number): EpisodeStats {
  const { gameState, flowDirection } = createEpisodeState(seed);
  const chaserAgent = gameState.agents[0];
  const evaders = gameState.agents.slice(1);
  const initialClosestDistance = Math.min(...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y)));
  const initialChaserX = chaserAgent.position.x;
  const initialEvaderXs = evaders.map(e => e.position.x);
  let maxChaserProgress = 0;
  const maxEvaderProgress = initialEvaderXs.map(() => 0);
  let cumulativeClosestDistance = 0;
  let distanceSamples = 0;
  let chaserFalls = 0;
  let evaderFalls = 0;
  let chaserJumps = 0;
  let evaderJumps = 0;
  let tagged = false;

  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);

  for (let step = 0; step < maxSteps && !tagged; step++) {
    gameState.gameTime += DT;
    chaserAgent.timeSinceBecameIt += DT;
    evaders.forEach(a => (a.survivalTime += DT));

    const controlsByAgent = new Map<number, AgentControls>();
    for (const agent of gameState.agents) {
      const controller = agent.id === 1 ? chaser : evader;
      const state = getAgentStateVector(agent, gameState, viewportSize);
      const controls = controller.chooseControls(state);
      controlsByAgent.set(agent.id, controls);
      const counter = agent.id === 1 ? actionCountsChaser : actionCountsEvader;
      counter[controls.action] = (counter[controls.action] || 0) + 1;
    }

    for (const agent of gameState.agents) {
      const role: 'chaser' | 'evader' = agent.id === 1 ? 'chaser' : 'evader';
      const controls = controlsByAgent.get(agent.id) || {
        move: 0, jump: 0, sprint: 0, outputs: [0, 0, 0, 0], action: 'left_drive', actionIndex: 0, label: 'wait',
      };
      agent.lastAction = controls.label;

      const locomotion = stepLocomotion(agent, controls, DT, role);
      agent.acceleration.x = locomotion.accelerationX;
      agent.maxEnergy = getPhysiology(role).energyCapacity;
      agent.energy = locomotion.energy;
      const velocity = locomotion.velocity;

      if (locomotion.jumped) {
        totalJumps++;
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
        const aligned = nextPosition.x + AGENT_WIDTH > platform.position.x && nextPosition.x < platform.position.x + platform.width;
        if (aligned && prevBottom <= platform.position.y + 8 && nextBottom >= platform.position.y && velocity.y >= 0) {
          nextPosition.y = platform.position.y - AGENT_HEIGHT;
          velocity.y = 0;
          grounded = true;
          landedPlatformId = platform.id;
          break;
        }
      }

      if (nextPosition.y > FALL_BOUNDARY) {
        totalFalls++;
        if (agent.id === 1) chaserFalls++;
        else evaderFalls++;
        const candidates = gameState.platforms.filter(
          p => p.position.x + p.width >= gameState.cameraPosition.x && p.position.x <= gameState.cameraPosition.x + viewportSize.width
        );
        const spawn = (candidates.length ? candidates : gameState.platforms).reduce((best, p) => {
          const d = Math.abs((p.position.x + p.width / 2) - agent.position.x);
          const bestD = Math.abs((best.position.x + best.width / 2) - agent.position.x);
          return d < bestD ? p : best;
        });
        nextPosition.x = spawn.position.x + spawn.width / 2 - AGENT_WIDTH / 2;
        nextPosition.y = spawn.position.y - AGENT_HEIGHT - 20;
        velocity.x = 0;
        velocity.y = 0;
        agent.energy = agent.maxEnergy;
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
      const dx = (chaserAgent.position.x + AGENT_WIDTH / 2) - (evaderAgent.position.x + AGENT_WIDTH / 2);
      const dy = (chaserAgent.position.y + AGENT_HEIGHT / 2) - (evaderAgent.position.y + AGENT_HEIGHT / 2);
      if (Math.hypot(dx, dy) < (AGENT_WIDTH + AGENT_HEIGHT) / 2) {
        tagged = true;
        totalTags++;
        break;
      }
    }

    const minX = Math.min(...evaders.map(a => a.position.x));
    const maxX = Math.max(...evaders.map(a => a.position.x + AGENT_WIDTH));
    const desiredCameraX = (minX + maxX) / 2 - viewportSize.width * 0.45;
    gameState.cameraPosition.x += (desiredCameraX - gameState.cameraPosition.x) * 0.12;

    const closestDistance = Math.min(...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y)));
    cumulativeClosestDistance += closestDistance;
    distanceSamples++;
    maxChaserProgress = Math.max(maxChaserProgress, flowDirection * (chaserAgent.position.x - initialChaserX));
    evaders.forEach((e, i) => {
      maxEvaderProgress[i] = Math.max(maxEvaderProgress[i], flowDirection * (e.position.x - initialEvaderXs[i]));
    });
  }

  const elapsedMs = gameState.gameTime;
  const elapsedSec = elapsedMs / 1000;
  const maxSec = NEAT_EPISODE_MAX_MS / 1000;
  const finalClosestDistance = Math.min(...evaders.map(e => Math.hypot(e.position.x - chaserAgent.position.x, e.position.y - chaserAgent.position.y)));
  const averageDistance = cumulativeClosestDistance / Math.max(1, distanceSamples);
  const closingGain = initialClosestDistance - finalClosestDistance;
  const chaserProgress = Math.max(0, maxChaserProgress);
  const evaderProgress = maxEvaderProgress.reduce((sum, progress) => sum + Math.max(0, progress), 0) / evaders.length;

  // Dense enough to bootstrap locomotion, but the dominant objective remains the terminal outcome.
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

  gameState.avgSurvivalTime = elapsedMs;
  gameState.avgTimeToTag = tagged ? elapsedMs : NEAT_EPISODE_MAX_MS;
  gameState.agents.forEach(a => {
    a.stateVector = getAgentStateVector(a, gameState, viewportSize);
    a.elo = a.id === 1 ? chaserElo : evaderElo;
  });

  return {
    chaserFitness,
    evaderFitness,
    tagged,
    elapsedMs,
    falls: chaserFalls + evaderFalls,
    jumps: chaserJumps + evaderJumps,
    gameState,
  };
}

function refreshControllers() {
  chaserControllers = chaserPopulation.genomes.map(g => new LearningAgent('chaser', g));
  evaderControllers = evaderPopulation.genomes.map(g => new LearningAgent('evader', g));
}

function resetEvaluationAccumulators() {
  evaluationIndex = 0;
  evaluationRound = 0;
  chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
}

function recordEpisodeTelemetry(result: EpisodeStats) {
  totalSimulatedTime += result.elapsedMs;
  recentSurvivalTimes.push(result.elapsedMs);
  if (recentSurvivalTimes.length > SURVIVAL_TIME_HISTORY_LENGTH) recentSurvivalTimes.shift();
  if (result.tagged) {
    recentTimesToTag.push(result.elapsedMs);
    if (recentTimesToTag.length > TIME_TO_TAG_HISTORY_LENGTH) recentTimesToTag.shift();
  }
  const eloResult = updateEloRatings(chaserElo, evaderElo, result.elapsedMs, undefined, result.tagged);
  chaserElo = eloResult.newChaserElo;
  evaderElo = eloResult.newEvaderElo;
  lastSampleGameState = result.gameState;
}

function evaluateNextMatch(): boolean {
  const n = chaserPopulation.genomes.length;
  const chaserIndex = evaluationIndex;
  // Rotating opponents prevents index-lock coevolution while keeping every role equally sampled.
  const evaderIndex = (evaluationIndex + evaluationRound * 17 + chaserPopulation.generation * 7) % n;
  const environmentSeed = chaserPopulation.generation * 100003 + evaluationRound * 7919;
  const result = runEpisode(chaserControllers[chaserIndex], evaderControllers[evaderIndex], environmentSeed);

  chaserFitnessTotals[chaserIndex] += result.chaserFitness;
  chaserFitnessCounts[chaserIndex]++;
  evaderFitnessTotals[evaderIndex] += result.evaderFitness;
  evaderFitnessCounts[evaderIndex]++;
  recordEpisodeTelemetry(result);

  evaluationIndex++;
  if (evaluationIndex >= n) {
    evaluationIndex = 0;
    evaluationRound++;
  }

  return evaluationRound >= NEAT_OPPONENTS_PER_GENOME;
}

function finishGeneration() {
  chaserPopulation.genomes.forEach((g, i) => {
    g.fitness = chaserFitnessTotals[i] / Math.max(1, chaserFitnessCounts[i]);
  });
  evaderPopulation.genomes.forEach((g, i) => {
    g.fitness = evaderFitnessTotals[i] / Math.max(1, evaderFitnessCounts[i]);
  });

  const chaserResult = chaserPopulation.evolve();
  const evaderResult = evaderPopulation.evolve();
  lastChaserMetrics = chaserResult.metrics;
  lastEvaderMetrics = evaderResult.metrics;
  championChaser = new LearningAgent('chaser', chaserResult.champion);
  championEvader = new LearningAgent('evader', evaderResult.champion);
  championChaser.setGeneration(chaserResult.metrics.generation);
  championEvader.setGeneration(evaderResult.metrics.generation);

  resetEvaluationAccumulators();
  refreshControllers();
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function emitTelemetry() {
  const generation = Math.max(lastChaserMetrics?.generation || 0, lastEvaderMetrics?.generation || 0);
  const leaderboard = createLeaderboardEntries(
    chaserElo,
    evaderElo,
    totalTags,
    totalFalls,
    generation,
    average(recentTimesToTag),
    average(recentSurvivalTimes)
  );

  self.postMessage({
    type: 'TELEMETRY',
    payload: {
      algorithm: 'NEAT',
      generation,
      evaluationProgress: (evaluationRound * NEAT_POPULATION_SIZE + evaluationIndex) / (NEAT_POPULATION_SIZE * NEAT_OPPONENTS_PER_GENOME),
      gameTime: totalSimulatedTime,
      chaserElo,
      evaderElo,
      avgSurvivalTime: average(recentSurvivalTimes),
      avgTimeToTag: average(recentTimesToTag),
      totalTags,
      totalFalls,
      totalJumps,
      lastChaserNeatMetrics: lastChaserMetrics,
      lastEvaderNeatMetrics: lastEvaderMetrics,
      chaserChampionGenome: championChaser.getWeights(),
      evaderChampionGenome: championEvader.getWeights(),
      actionCountsChaser,
      actionCountsEvader,
      eloLeaderboard: leaderboard,
      sampleGameState: lastSampleGameState
        ? {
            ...lastSampleGameState,
            agents: lastSampleGameState.agents.map(a => ({ ...a, trajectory: [] })),
          }
        : null,
    },
  });
}

function runHeadlessBatch() {
  if (!isRunning) return;

  const matchesThisBatch = Math.max(1, Math.min(12, Math.round(speedMultiplier / 5)));
  for (let i = 0; i < matchesThisBatch; i++) {
    const generationComplete = evaluateNextMatch();
    if (generationComplete) finishGeneration();
  }

  emitTelemetry();
  if (isRunning) timerId = setTimeout(runHeadlessBatch, 16);
}

function seedPopulations(chaserWeights?: AgentWeights, evaderWeights?: AgentWeights) {
  if (chaserWeights?.nodes && chaserWeights?.connections) {
    chaserPopulation.seedFromChampion(chaserWeights as NeatGenomeData);
    championChaser.setWeights(chaserWeights);
  }
  if (evaderWeights?.nodes && evaderWeights?.connections) {
    evaderPopulation.seedFromChampion(evaderWeights as NeatGenomeData);
    championEvader.setWeights(evaderWeights);
  }
  refreshControllers();
  resetEvaluationAccumulators();
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START': {
      if (typeof payload?.speedMultiplier === 'number') speedMultiplier = Math.max(1, Math.min(200, payload.speedMultiplier));
      if (payload?.viewportSize) viewportSize = payload.viewportSize;
      if (!seededFromStart && (payload?.chaserWeights || payload?.evaderWeights)) {
        seedPopulations(payload?.chaserWeights, payload?.evaderWeights);
        seededFromStart = true;
      }
      if (typeof payload?.chaserElo === 'number') chaserElo = payload.chaserElo;
      if (typeof payload?.evaderElo === 'number') evaderElo = payload.evaderElo;
      isRunning = true;
      if (timerId) clearTimeout(timerId);
      runHeadlessBatch();
      break;
    }

    case 'PAUSE':
      isRunning = false;
      if (timerId) clearTimeout(timerId);
      emitTelemetry();
      break;

    case 'SET_SPEED':
      if (typeof payload?.speedMultiplier === 'number') speedMultiplier = Math.max(1, Math.min(200, payload.speedMultiplier));
      break;

    case 'SYNC_WEIGHTS_REQUEST':
      self.postMessage({
        type: 'SYNC_WEIGHTS_RESPONSE',
        payload: {
          algorithm: 'NEAT',
          chaserWeights: championChaser.getWeights(),
          evaderWeights: championEvader.getWeights(),
          chaserElo,
          evaderElo,
          generation: Math.max(lastChaserMetrics?.generation || 0, lastEvaderMetrics?.generation || 0),
        },
      });
      break;

    case 'SET_WEIGHTS':
      seedPopulations(payload?.chaserWeights, payload?.evaderWeights);
      seededFromStart = true;
      if (typeof payload?.chaserElo === 'number') chaserElo = payload.chaserElo;
      if (typeof payload?.evaderElo === 'number') evaderElo = payload.evaderElo;
      break;

    case 'RESET':
      chaserPopulation = new NeatPopulation('chaser', neatConfig);
      evaderPopulation = new NeatPopulation('evader', neatConfig);
      refreshControllers();
      championChaser = new LearningAgent('chaser', chaserPopulation.genomes[0]);
      championEvader = new LearningAgent('evader', evaderPopulation.genomes[0]);
      lastChaserMetrics = null;
      lastEvaderMetrics = null;
      seededFromStart = false;
      totalTags = 0;
      totalFalls = 0;
      totalJumps = 0;
      totalSimulatedTime = 0;
      chaserElo = INITIAL_ELO;
      evaderElo = INITIAL_ELO;
      recentSurvivalTimes.length = 0;
      recentTimesToTag.length = 0;
      Object.keys(actionCountsChaser).forEach(k => delete actionCountsChaser[k]);
      Object.keys(actionCountsEvader).forEach(k => delete actionCountsEvader[k]);
      lastSampleGameState = null;
      resetEvaluationAccumulators();
      emitTelemetry();
      break;
  }
};
