import { LearningAgent, type AgentWeights } from '../learning/agent';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, cloneGenome, type NeatGenerationMetrics, type NeatGenomeData } from '../learning/neat';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import { runTrainingEpisode, type TrainingEpisodeResult } from '../learning/trainingEpisode';
import type { BalanceTelemetry } from '../types';
import {
  INITIAL_ELO,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  NEAT_POPULATION_SIZE,
  NEAT_OPPONENTS_PER_GENOME,
  NEAT_HOF_OPPONENTS_PER_GENOME,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_RECENT_SLOTS,
  NEAT_COMPATIBILITY_THRESHOLD,
  NEAT_TARGET_SPECIES,
  NEAT_CROSSOVER_RATE,
  NEAT_WEIGHT_MUTATION_RATE,
  NEAT_ADD_NODE_RATE,
  NEAT_ADD_CONNECTION_RATE,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
  ACTION_SPACE,
} from '../constants';

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
let timerId: ReturnType<typeof setTimeout> | null = null;
const viewportSize = { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT };
let seededFromStart = false;

// Training always runs at maximum available throughput. The preferred backend dispatches
// independent episodes to a CPU worker pool; the short-burst loop below remains as a
// compatibility fallback when nested workers are unavailable.
const MAX_TRAINING_BURST_MS = 40;
const TELEMETRY_INTERVAL_MS = 250;
let lastTelemetryEmitAt = 0;
let completedEpisodes = 0;
let throughputSampleStartedAt = performance.now();
let throughputSampleSimulatedTime = 0;
let throughputSampleEpisodes = 0;
let currentTrainingSpeedX = 0;
let currentTrainingEpisodesPerSecond = 0;

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

interface ParallelEvaluationTask {
  id: number;
  epoch: number;
  phase: EvaluationPhase;
  chaserIndex: number | null;
  evaderIndex: number | null;
  chaserGenome: NeatGenomeData;
  evaderGenome: NeatGenomeData;
  seed: number;
  trackChaserActions: boolean;
  trackEvaderActions: boolean;
  currentPopulationMatch: boolean;
}

interface EvaluatorSlot {
  worker: Worker;
  busy: boolean;
  taskId: number | null;
}

let evaluatorPool: EvaluatorSlot[] = [];
let poolInitializationAttempted = false;
let parallelTasks: ParallelEvaluationTask[] = [];
let parallelTaskCursor = 0;
let parallelTasksCompleted = 0;
let nextParallelTaskId = 1;
let evaluationEpoch = 1;
let parallelGenerationPrepared = false;
let parallelBackendActive = false;
const activeParallelTasks = new Map<number, ParallelEvaluationTask>();
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


interface EpisodeStats {
  chaserFitness: number;
  evaderFitness: number;
  tagged: boolean;
  elapsedMs: number;
  falls: number;
  jumps: number;
}

function runEpisode(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  trackActions: { chaser: boolean; evader: boolean } = { chaser: true, evader: true }
): EpisodeStats {
  const result = runTrainingEpisode(chaser, evader, seed, {
    trackChaserActions: trackActions.chaser,
    trackEvaderActions: trackActions.evader,
    viewportSize,
  });

  if (result.tagged) totalTags++;
  totalFalls += result.falls;
  totalJumps += result.jumps;
  for (let i = 0; i < ACTION_SPACE.length; i++) {
    const action = ACTION_SPACE[i];
    const chaserCount = result.chaserActionCounts[i] || 0;
    const evaderCount = result.evaderActionCounts[i] || 0;
    if (chaserCount) actionCountsChaser[action] = (actionCountsChaser[action] || 0) + chaserCount;
    if (evaderCount) actionCountsEvader[action] = (actionCountsEvader[action] || 0) + evaderCount;
  }

  return result;
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


function invalidateParallelGeneration() {
  evaluationEpoch++;
  parallelTasks = [];
  parallelTaskCursor = 0;
  parallelTasksCompleted = 0;
  parallelGenerationPrepared = false;
  activeParallelTasks.clear();
}

function prepareParallelGeneration() {
  const n = chaserPopulation.genomes.length;
  const generation = chaserPopulation.generation;
  const tasks: ParallelEvaluationTask[] = [];
  const evaderHofPool = hallOfFamePool(evaderHallOfFame);
  const chaserHofPool = hallOfFamePool(chaserHallOfFame);

  for (let round = 0; round < NEAT_OPPONENTS_PER_GENOME; round++) {
    for (let chaserIndex = 0; chaserIndex < n; chaserIndex++) {
      const evaderIndex = (chaserIndex + round * 17 + generation * 7) % n;
      tasks.push({
        id: nextParallelTaskId++,
        epoch: evaluationEpoch,
        phase: 'population',
        chaserIndex,
        evaderIndex,
        chaserGenome: chaserPopulation.genomes[chaserIndex],
        evaderGenome: evaderPopulation.genomes[evaderIndex],
        seed: generation * 100003 + round * 7919,
        trackChaserActions: true,
        trackEvaderActions: true,
        currentPopulationMatch: true,
      });
    }
  }

  if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && evaderHofPool.length > 0) {
    for (let round = 0; round < NEAT_HOF_OPPONENTS_PER_GENOME; round++) {
      for (let chaserIndex = 0; chaserIndex < n; chaserIndex++) {
        const opponent = evaderHofPool[(chaserIndex * 7 + round * 5 + generation * 3) % evaderHofPool.length];
        tasks.push({
          id: nextParallelTaskId++,
          epoch: evaluationEpoch,
          phase: 'chaser_hof',
          chaserIndex,
          evaderIndex: null,
          chaserGenome: chaserPopulation.genomes[chaserIndex],
          evaderGenome: opponent.genome,
          seed: generation * 200003 + round * 12011 + 101,
          trackChaserActions: true,
          trackEvaderActions: false,
          currentPopulationMatch: false,
        });
      }
    }
  }

  if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && chaserHofPool.length > 0) {
    for (let round = 0; round < NEAT_HOF_OPPONENTS_PER_GENOME; round++) {
      for (let evaderIndex = 0; evaderIndex < n; evaderIndex++) {
        const opponent = chaserHofPool[(evaderIndex * 7 + round * 5 + generation * 3) % chaserHofPool.length];
        tasks.push({
          id: nextParallelTaskId++,
          epoch: evaluationEpoch,
          phase: 'evader_hof',
          chaserIndex: null,
          evaderIndex,
          chaserGenome: opponent.genome,
          evaderGenome: evaderPopulation.genomes[evaderIndex],
          seed: generation * 300007 + round * 16001 + 211,
          trackChaserActions: false,
          trackEvaderActions: true,
          currentPopulationMatch: false,
        });
      }
    }
  }

  parallelTasks = tasks;
  parallelTaskCursor = 0;
  parallelTasksCompleted = 0;
  activeParallelTasks.clear();
  parallelGenerationPrepared = true;
}

function applyParallelEpisodeResult(task: ParallelEvaluationTask, result: TrainingEpisodeResult) {
  if (result.tagged) totalTags++;
  totalFalls += result.falls;
  totalJumps += result.jumps;
  for (let i = 0; i < ACTION_SPACE.length; i++) {
    const action = ACTION_SPACE[i];
    const chaserCount = result.chaserActionCounts[i] || 0;
    const evaderCount = result.evaderActionCounts[i] || 0;
    if (chaserCount) actionCountsChaser[action] = (actionCountsChaser[action] || 0) + chaserCount;
    if (evaderCount) actionCountsEvader[action] = (actionCountsEvader[action] || 0) + evaderCount;
  }

  if (task.phase === 'population') {
    const chaserIndex = task.chaserIndex!;
    const evaderIndex = task.evaderIndex!;
    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;
    generationPopulationMatches++;
    if (result.tagged) {
      generationPopulationTags++;
      generationPopulationTagTimeMs += result.elapsedMs;
    }
  } else if (task.phase === 'chaser_hof') {
    const chaserIndex = task.chaserIndex!;
    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
  } else {
    const evaderIndex = task.evaderIndex!;
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;
  }

  recordEpisodeTelemetry(result, task.currentPopulationMatch);
}

function fallBackToSerialTraining(reason: unknown) {
  console.warn('Parallel evaluator pool unavailable; falling back to optimized single-worker training.', reason);
  for (const slot of evaluatorPool) slot.worker.terminate();
  evaluatorPool = [];
  parallelBackendActive = false;
  parallelGenerationPrepared = false;
  activeParallelTasks.clear();
  resetEvaluationAccumulators();
  if (isRunning) {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(runHeadlessBatch, 0);
  }
}

function maybeFinishParallelGeneration() {
  if (!parallelGenerationPrepared) return;
  if (parallelTasksCompleted < parallelTasks.length) return;
  if (activeParallelTasks.size > 0 || parallelTaskCursor < parallelTasks.length) return;

  finishGeneration();
  parallelGenerationPrepared = false;
  if (isRunning) {
    prepareParallelGeneration();
    dispatchParallelWork();
  }
}

function handleEvaluatorMessage(slot: EvaluatorSlot, event: MessageEvent) {
  const { type, payload } = event.data || {};
  const taskId = payload?.taskId as number | undefined;
  const task = taskId !== undefined ? activeParallelTasks.get(taskId) : undefined;
  if (taskId !== undefined) activeParallelTasks.delete(taskId);
  slot.busy = false;
  slot.taskId = null;

  if (type === 'ERROR') {
    fallBackToSerialTraining(payload?.message || 'Evaluator worker failed');
    return;
  }

  if (type === 'RESULT' && task && payload?.epoch === evaluationEpoch && task.epoch === evaluationEpoch) {
    applyParallelEpisodeResult(task, payload.result as TrainingEpisodeResult);
    parallelTasksCompleted++;
    emitTelemetry();
  }

  maybeFinishParallelGeneration();
  if (isRunning && parallelBackendActive) dispatchParallelWork();
}

function initializeEvaluatorPool() {
  if (poolInitializationAttempted) return;
  poolInitializationAttempted = true;

  try {
    const logicalCores = Math.max(1, self.navigator?.hardwareConcurrency || 4);
    // Reserve one logical core for the UI/browser and cap worker count to avoid runaway memory/thermal pressure.
    const targetWorkers = Math.max(1, Math.min(12, logicalCores - 1));
    for (let i = 0; i < targetWorkers; i++) {
      const worker = new Worker(new URL('./episodeWorker.ts', import.meta.url), { type: 'module' });
      const slot: EvaluatorSlot = { worker, busy: false, taskId: null };
      worker.onmessage = event => handleEvaluatorMessage(slot, event);
      worker.onerror = event => fallBackToSerialTraining(event.message || event);
      evaluatorPool.push(slot);
    }
    parallelBackendActive = evaluatorPool.length > 0;
  } catch (error) {
    fallBackToSerialTraining(error);
  }
}

function dispatchParallelWork() {
  if (!isRunning || !parallelBackendActive) return;
  if (!parallelGenerationPrepared) prepareParallelGeneration();

  for (const slot of evaluatorPool) {
    if (slot.busy || parallelTaskCursor >= parallelTasks.length) continue;
    const task = parallelTasks[parallelTaskCursor++];
    slot.busy = true;
    slot.taskId = task.id;
    activeParallelTasks.set(task.id, task);
    slot.worker.postMessage({
      type: 'EVALUATE',
      payload: {
        taskId: task.id,
        epoch: task.epoch,
        chaserGenome: task.chaserGenome,
        evaderGenome: task.evaderGenome,
        seed: task.seed,
        trackChaserActions: task.trackChaserActions,
        trackEvaderActions: task.trackEvaderActions,
      },
    });
  }

  maybeFinishParallelGeneration();
}

function startTrainingEngine() {
  initializeEvaluatorPool();
  if (parallelBackendActive) {
    if (timerId) clearTimeout(timerId);
    dispatchParallelWork();
  } else {
    runHeadlessBatch();
  }
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
  completedEpisodes++;
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
  if (parallelBackendActive && parallelGenerationPrepared) {
    return Math.max(0, Math.min(1, parallelTasksCompleted / Math.max(1, parallelTasks.length)));
  }

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

function updateTrainingThroughput(now = performance.now()) {
  if (!isRunning) return;
  const elapsedWallMs = now - throughputSampleStartedAt;
  if (elapsedWallMs < TELEMETRY_INTERVAL_MS) return;

  const simulatedDeltaMs = totalSimulatedTime - throughputSampleSimulatedTime;
  const episodeDelta = completedEpisodes - throughputSampleEpisodes;
  currentTrainingSpeedX = simulatedDeltaMs / Math.max(1, elapsedWallMs);
  currentTrainingEpisodesPerSecond = episodeDelta * 1000 / Math.max(1, elapsedWallMs);

  throughputSampleStartedAt = now;
  throughputSampleSimulatedTime = totalSimulatedTime;
  throughputSampleEpisodes = completedEpisodes;
}

function resetTrainingThroughput() {
  const now = performance.now();
  throughputSampleStartedAt = now;
  throughputSampleSimulatedTime = totalSimulatedTime;
  throughputSampleEpisodes = completedEpisodes;
  currentTrainingSpeedX = 0;
  currentTrainingEpisodesPerSecond = 0;
  lastTelemetryEmitAt = 0;
}

function emitTelemetry(force = false) {
  const now = performance.now();
  updateTrainingThroughput(now);
  if (!force && now - lastTelemetryEmitAt < TELEMETRY_INTERVAL_MS) return;
  lastTelemetryEmitAt = now;

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
      trainingSpeedX: currentTrainingSpeedX,
      trainingEpisodesPerSecond: currentTrainingEpisodesPerSecond,
      trainingBackend: parallelBackendActive ? 'CPU parallel' : 'CPU optimized',
      trainingWorkerCount: parallelBackendActive ? evaluatorPool.length : 1,
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
  if (!isRunning || parallelBackendActive) return;

  const burstStartedAt = performance.now();
  do {
    const generationComplete = evaluateNextMatch();
    if (generationComplete) finishGeneration();
  } while (isRunning && performance.now() - burstStartedAt < MAX_TRAINING_BURST_MS);

  emitTelemetry();
  if (isRunning) timerId = setTimeout(runHeadlessBatch, 0);
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
  invalidateParallelGeneration();
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START': {
      if (!seededFromStart && (payload?.chaserWeights || payload?.evaderWeights)) {
        seedPopulations(payload?.chaserWeights, payload?.evaderWeights);
        seededFromStart = true;
      }
      if (typeof payload?.chaserElo === 'number') chaserElo = payload.chaserElo;
      if (typeof payload?.evaderElo === 'number') evaderElo = payload.evaderElo;
      isRunning = true;
      if (timerId) clearTimeout(timerId);
      resetTrainingThroughput();
      startTrainingEngine();
      break;
    }

    case 'PAUSE':
      isRunning = false;
      if (timerId) clearTimeout(timerId);
      currentTrainingSpeedX = 0;
      currentTrainingEpisodesPerSecond = 0;
      emitTelemetry(true);
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
      if (isRunning) startTrainingEngine();
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
      completedEpisodes = 0;
      chaserElo = INITIAL_ELO;
      evaderElo = INITIAL_ELO;
      recentSurvivalTimes.length = 0;
      recentTimesToTag.length = 0;
      Object.keys(actionCountsChaser).forEach(k => delete actionCountsChaser[k]);
      Object.keys(actionCountsEvader).forEach(k => delete actionCountsEvader[k]);
      clearHallOfFame();
      lastGenerationBalance = null;
      resetEvaluationAccumulators();
      invalidateParallelGeneration();
      resetTrainingThroughput();
      emitTelemetry(true);
      if (isRunning) startTrainingEngine();
      break;
  }
};
