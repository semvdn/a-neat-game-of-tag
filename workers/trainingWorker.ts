import { LearningAgent, type AgentWeights, type AgentControls } from '../learning/agent';
import { getPhysiology, stepLocomotion } from '../learning/movement';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, cloneGenome, type NeatGenerationMetrics, type NeatGenomeData } from '../learning/neat';
import { getAgentStateVector } from '../learning/state';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import type { AgentState, BalanceTelemetry, GameState, PlatformState } from '../types';
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
  NEAT_HOF_OPPONENTS_PER_GENOME,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_RECENT_SLOTS,
  NEAT_EPISODE_MAX_MS,
  NEAT_COMPATIBILITY_THRESHOLD,
  NEAT_TARGET_SPECIES,
  NEAT_CROSSOVER_RATE,
  NEAT_WEIGHT_MUTATION_RATE,
  NEAT_ADD_NODE_RATE,
  NEAT_ADD_CONNECTION_RATE,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
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
let speedMultiplier = 50;
let timerId: ReturnType<typeof setTimeout> | null = null;
const viewportSize = { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT };
let seededFromStart = false;

type EvaluationPhase = 'population' | 'chaser_hof' | 'evader_hof';
interface HallOfFameEntry {
  generation: number;
  genome: NeatGenomeData;
  controller: LearningAgent;
}
interface HallOfFameArchive {
  recent: HallOfFameEntry[];
  reservoir: HallOfFameEntry[];
  historicalSeen: number;
}

let evaluationPhase: EvaluationPhase = 'population';
let evaluationIndex = 0;
let evaluationRound = 0;
const chaserHallOfFame: HallOfFameArchive = { recent: [], reservoir: [], historicalSeen: 0 };
const evaderHallOfFame: HallOfFameArchive = { recent: [], reservoir: [], historicalSeen: 0 };
let chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let generationPopulationMatches = 0;
let generationPopulationTags = 0;
let generationPopulationTagTimeMs = 0;
let lastGenerationBalance: BalanceTelemetry | null = null;

let totalTags = 0;
let totalFalls = 0;
let totalJumps = 0;
let totalSimulatedTime = 0;
let chaserElo = INITIAL_ELO;
let evaderElo = INITIAL_ELO;
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

function runEpisode(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  trackActions: { chaser: boolean; evader: boolean } = { chaser: true, evader: true }
): EpisodeStats {
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
      const roleForTelemetry = agent.id === 1 ? 'chaser' : 'evader';
      if (trackActions[roleForTelemetry]) {
        const counter = roleForTelemetry === 'chaser' ? actionCountsChaser : actionCountsEvader;
        counter[controls.action] = (counter[controls.action] || 0) + 1;
      }
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

  // Symmetric 0–200 terminal outcome scale. An early tag approaches 200/0, a late tag approaches
  // 100/100, and surviving the whole episode is 0/200. Small bounded shaping only bootstraps
  // useful locomotion; it cannot overwhelm the win/loss objective. Energy and jumping are not
  // rewarded directly — they matter only through whether they help the agent win.
  const timeFraction = Math.max(0, Math.min(1, elapsedSec / Math.max(1e-6, maxSec)));
  const chaserOutcome = tagged ? 100 + 100 * (1 - timeFraction) : 0;
  const evaderOutcome = tagged ? 100 * timeFraction : 200;

  const closingNorm = Math.max(-1, Math.min(1, closingGain / Math.max(150, initialClosestDistance)));
  const chaserProgressNorm = Math.max(0, Math.min(1, chaserProgress / 600));
  const evaderProgressNorm = Math.max(0, Math.min(1, evaderProgress / 600));
  const evaderFallsPerAgent = evaderFalls / Math.max(1, evaders.length);

  const chaserShaping =
    10 * closingNorm +
    5 * chaserProgressNorm -
    5 * Math.min(2, chaserFalls);
  const evaderShaping =
    -10 * closingNorm +
    5 * evaderProgressNorm -
    5 * Math.min(2, evaderFallsPerAgent);

  const chaserFitness = Math.max(0.01, Math.min(220, chaserOutcome + chaserShaping));
  const evaderFitness = Math.max(0.01, Math.min(220, evaderOutcome + evaderShaping));

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

function hallOfFamePool(archive: HallOfFameArchive): HallOfFameEntry[] {
  return [...archive.reservoir, ...archive.recent];
}

function archiveChampion(archive: HallOfFameArchive, genome: NeatGenomeData, role: 'chaser' | 'evader') {
  const snapshot = cloneGenome(genome, `${role}_hof_g${genome.generation}`);
  snapshot.role = role;
  const entry: HallOfFameEntry = {
    generation: snapshot.generation,
    genome: snapshot,
    controller: new LearningAgent(role, snapshot),
  };

  archive.recent.push(entry);
  const recentLimit = Math.min(NEAT_HOF_RECENT_SLOTS, NEAT_HOF_MAX_SIZE);
  if (archive.recent.length <= recentLimit) return;

  const historical = archive.recent.shift()!;
  archive.historicalSeen++;
  const reservoirLimit = Math.max(0, NEAT_HOF_MAX_SIZE - recentLimit);
  if (reservoirLimit === 0) return;
  if (archive.reservoir.length < reservoirLimit) {
    archive.reservoir.push(historical);
    return;
  }

  // Reservoir sampling keeps a bounded, approximately uniform sample of older strategies.
  const rng = mulberry32((historical.generation + 1) * 2654435761 >>> 0);
  const slot = Math.floor(rng() * archive.historicalSeen);
  if (slot < reservoirLimit) archive.reservoir[slot] = historical;
}

function clearHallOfFame() {
  chaserHallOfFame.recent.length = 0;
  chaserHallOfFame.reservoir.length = 0;
  chaserHallOfFame.historicalSeen = 0;
  evaderHallOfFame.recent.length = 0;
  evaderHallOfFame.reservoir.length = 0;
  evaderHallOfFame.historicalSeen = 0;
}

function selectHallOpponent(archive: HallOfFameArchive, genomeIndex: number, round: number, generation: number): HallOfFameEntry | null {
  const pool = hallOfFamePool(archive);
  if (pool.length === 0) return null;
  const index = (genomeIndex * 7 + round * 5 + generation * 3) % pool.length;
  return pool[index];
}

function refreshControllers() {
  chaserControllers = chaserPopulation.genomes.map(g => new LearningAgent('chaser', g));
  evaderControllers = evaderPopulation.genomes.map(g => new LearningAgent('evader', g));
}

function resetEvaluationAccumulators() {
  evaluationPhase = 'population';
  evaluationIndex = 0;
  evaluationRound = 0;
  chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  generationPopulationMatches = 0;
  generationPopulationTags = 0;
  generationPopulationTagTimeMs = 0;
}

function recordEpisodeTelemetry(result: EpisodeStats, currentPopulationMatch = true) {
  totalSimulatedTime += result.elapsedMs;
  recentSurvivalTimes.push(result.elapsedMs);
  if (recentSurvivalTimes.length > SURVIVAL_TIME_HISTORY_LENGTH) recentSurvivalTimes.shift();
  if (result.tagged) {
    recentTimesToTag.push(result.elapsedMs);
    if (recentTimesToTag.length > TIME_TO_TAG_HISTORY_LENGTH) recentTimesToTag.shift();
  }
  if (currentPopulationMatch) {
    const eloResult = updateEloRatings(chaserElo, evaderElo, result.elapsedMs, undefined, result.tagged);
    chaserElo = eloResult.newChaserElo;
    evaderElo = eloResult.newEvaderElo;
  }
}

function evaluateNextMatch(): boolean {
  const n = chaserPopulation.genomes.length;

  if (evaluationPhase === 'population') {
    const chaserIndex = evaluationIndex;
    // Rotating opponents prevents index-lock coevolution while keeping every role equally sampled.
    const evaderIndex = (evaluationIndex + evaluationRound * 17 + chaserPopulation.generation * 7) % n;
    const environmentSeed = chaserPopulation.generation * 100003 + evaluationRound * 7919;
    const result = runEpisode(chaserControllers[chaserIndex], evaderControllers[evaderIndex], environmentSeed);

    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;
    generationPopulationMatches++;
    if (result.tagged) {
      generationPopulationTags++;
      generationPopulationTagTimeMs += result.elapsedMs;
    }
    recordEpisodeTelemetry(result);

    evaluationIndex++;
    if (evaluationIndex >= n) {
      evaluationIndex = 0;
      evaluationRound++;
    }

    if (evaluationRound < NEAT_OPPONENTS_PER_GENOME) return false;
    evaluationRound = 0;
    evaluationIndex = 0;
    if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && hallOfFamePool(evaderHallOfFame).length > 0) {
      evaluationPhase = 'chaser_hof';
      return false;
    }
    if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && hallOfFamePool(chaserHallOfFame).length > 0) {
      evaluationPhase = 'evader_hof';
      return false;
    }
    return true;
  }

  if (evaluationPhase === 'chaser_hof') {
    const opponent = selectHallOpponent(evaderHallOfFame, evaluationIndex, evaluationRound, chaserPopulation.generation);
    if (opponent) {
      const environmentSeed = chaserPopulation.generation * 200003 + evaluationRound * 12011 + 101;
      const result = runEpisode(chaserControllers[evaluationIndex], opponent.controller, environmentSeed, { chaser: true, evader: false });
      chaserFitnessTotals[evaluationIndex] += result.chaserFitness;
      chaserFitnessCounts[evaluationIndex]++;
      recordEpisodeTelemetry(result, false);
    }

    evaluationIndex++;
    if (evaluationIndex >= n) {
      evaluationIndex = 0;
      evaluationRound++;
    }
    if (evaluationRound < NEAT_HOF_OPPONENTS_PER_GENOME) return false;
    evaluationRound = 0;
    evaluationIndex = 0;
    if (hallOfFamePool(chaserHallOfFame).length > 0) {
      evaluationPhase = 'evader_hof';
      return false;
    }
    return true;
  }

  const opponent = selectHallOpponent(chaserHallOfFame, evaluationIndex, evaluationRound, evaderPopulation.generation);
  if (opponent) {
    const environmentSeed = evaderPopulation.generation * 300007 + evaluationRound * 16001 + 211;
    const result = runEpisode(opponent.controller, evaderControllers[evaluationIndex], environmentSeed, { chaser: false, evader: true });
    evaderFitnessTotals[evaluationIndex] += result.evaderFitness;
    evaderFitnessCounts[evaluationIndex]++;
    recordEpisodeTelemetry(result, false);
  }

  evaluationIndex++;
  if (evaluationIndex >= n) {
    evaluationIndex = 0;
    evaluationRound++;
  }
  return evaluationRound >= NEAT_HOF_OPPONENTS_PER_GENOME;
}

function finishGeneration() {
  const evaluatedGeneration = chaserPopulation.generation;
  lastGenerationBalance = {
    generation: evaluatedGeneration,
    matches: generationPopulationMatches,
    tags: generationPopulationTags,
    tagRate: generationPopulationTags / Math.max(1, generationPopulationMatches),
    survivalRate: (generationPopulationMatches - generationPopulationTags) / Math.max(1, generationPopulationMatches),
    avgTagTimeMs: generationPopulationTags > 0 ? generationPopulationTagTimeMs / generationPopulationTags : null,
  };

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
  archiveChampion(chaserHallOfFame, chaserResult.champion, 'chaser');
  archiveChampion(evaderHallOfFame, evaderResult.champion, 'evader');
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

function evaluationProgress(): number {
  const n = NEAT_POPULATION_SIZE;
  const hasEvaderHof = NEAT_HOF_OPPONENTS_PER_GENOME > 0 && hallOfFamePool(evaderHallOfFame).length > 0;
  const hasChaserHof = NEAT_HOF_OPPONENTS_PER_GENOME > 0 && hallOfFamePool(chaserHallOfFame).length > 0;
  const populationEpisodes = n * NEAT_OPPONENTS_PER_GENOME;
  const chaserHofEpisodes = hasEvaderHof ? n * NEAT_HOF_OPPONENTS_PER_GENOME : 0;
  const evaderHofEpisodes = hasChaserHof ? n * NEAT_HOF_OPPONENTS_PER_GENOME : 0;
  const total = populationEpisodes + chaserHofEpisodes + evaderHofEpisodes;

  let completed = 0;
  if (evaluationPhase === 'population') {
    completed = evaluationRound * n + evaluationIndex;
  } else if (evaluationPhase === 'chaser_hof') {
    completed = populationEpisodes + evaluationRound * n + evaluationIndex;
  } else {
    completed = populationEpisodes + chaserHofEpisodes + evaluationRound * n + evaluationIndex;
  }
  return Math.max(0, Math.min(1, completed / Math.max(1, total)));
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
      evaluationProgress: evaluationProgress(),
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
      lastGenerationBalance,
      hallOfFame: {
        chaserSize: hallOfFamePool(chaserHallOfFame).length,
        evaderSize: hallOfFamePool(evaderHallOfFame).length,
        maxSize: NEAT_HOF_MAX_SIZE,
        opponentsPerGenome: NEAT_HOF_OPPONENTS_PER_GENOME,
        chaserGenerations: hallOfFamePool(chaserHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
        evaderGenerations: hallOfFamePool(evaderHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
      },
    },
  });
}

function runHeadlessBatch() {
  if (!isRunning) return;

  const matchesThisBatch = Math.max(1, Math.min(40, Math.round(speedMultiplier / 5)));
  for (let i = 0; i < matchesThisBatch; i++) {
    const generationComplete = evaluateNextMatch();
    if (generationComplete) finishGeneration();
  }

  emitTelemetry();
  if (isRunning) timerId = setTimeout(runHeadlessBatch, 16);
}

function seedPopulations(chaserWeights?: AgentWeights, evaderWeights?: AgentWeights, archiveSeed = false) {
  clearHallOfFame();
  lastGenerationBalance = null;
  if (chaserWeights?.nodes && chaserWeights?.connections) {
    chaserPopulation.seedFromChampion(chaserWeights as NeatGenomeData);
    championChaser.setWeights(chaserWeights);
    if (archiveSeed) archiveChampion(chaserHallOfFame, chaserWeights as NeatGenomeData, 'chaser');
  }
  if (evaderWeights?.nodes && evaderWeights?.connections) {
    evaderPopulation.seedFromChampion(evaderWeights as NeatGenomeData);
    championEvader.setWeights(evaderWeights);
    if (archiveSeed) archiveChampion(evaderHallOfFame, evaderWeights as NeatGenomeData, 'evader');
  }
  refreshControllers();
  resetEvaluationAccumulators();
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START': {
      if (typeof payload?.speedMultiplier === 'number') speedMultiplier = Math.max(1, Math.min(200, payload.speedMultiplier));
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
      seedPopulations(payload?.chaserWeights, payload?.evaderWeights, true);
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
      clearHallOfFame();
      lastGenerationBalance = null;
      resetEvaluationAccumulators();
      emitTelemetry();
      break;
  }
};
