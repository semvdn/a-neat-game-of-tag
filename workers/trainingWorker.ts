import { LearningAgent, type AgentWeights } from '../learning/agent';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, DEFAULT_NETWORK_ARCHITECTURE_SUITE, sanitizeNetworkArchitectureSuite, cloneGenome, type NeatGenerationMetrics, type NeatGenomeData, type NeatPopulationCheckpoint, type NetworkArchitectureSuiteConfig } from '../learning/neat';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import {
  runTrainingEpisode,
  type TrainingEpisodeResult,
  type TrainingStartMode,
} from '../learning/trainingEpisode';
import type { ActiveUpgradeState, BalanceTelemetry, BenchmarkRoleTelemetry, CrossGenerationBenchmarkTelemetry, HallOfFameTelemetry, TrainingFitnessConfig, TrainingGenerationAnalysisRecord, UpgradeConfig } from '../types';
import {
  INITIAL_ELO,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  NEAT_POPULATION_SIZE,
  NEAT_OPPONENTS_PER_GENOME,
  NEAT_HOF_OPPONENTS_PER_GENOME,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_RECENT_SLOTS,
  NEAT_HOF_SIMILARITY_THRESHOLD,
  NEAT_HOF_NOVELTY_WEIGHT,
  NEAT_BENCHMARK_REFERENCES_PER_ROLE,
  NEAT_BENCHMARK_START_MODES,
  NEAT_CHAMPION_VALIDATION_CANDIDATES,
  NEAT_CHAMPION_VALIDATION_CURRENT_OPPONENTS,
  NEAT_CHAMPION_VALIDATION_HOF_OPPONENTS,
  NEAT_COMPATIBILITY_THRESHOLD,
  NEAT_TARGET_SPECIES,
  NEAT_CROSSOVER_RATE,
  NEAT_WEIGHT_MUTATION_RATE,
  NEAT_ADD_NODE_RATE,
  NEAT_ADD_CONNECTION_RATE,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
  ACTION_SPACE,
  STATE_VECTOR_SIZE,
  MAX_SPEED,
  SPRINT_MAX_SPEED,
  SPRINT_ENERGY_COST_PER_SEC,
  DEFAULT_RUNNER_PACE_TARGET_PX,
  MIN_RUNNER_PACE_TARGET_PX,
  MAX_RUNNER_PACE_TARGET_PX,
  DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW,
  MAX_RUNNER_PACE_REWARD_PER_WINDOW,
  DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM,
  MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM,
} from '../constants';

const baseNeatConfig = {
  ...DEFAULT_NEAT_CONFIG,
  populationSize: NEAT_POPULATION_SIZE,
  compatibilityThreshold: NEAT_COMPATIBILITY_THRESHOLD,
  targetSpecies: NEAT_TARGET_SPECIES,
  crossoverRate: NEAT_CROSSOVER_RATE,
  weightMutationRate: NEAT_WEIGHT_MUTATION_RATE,
  addNodeRate: NEAT_ADD_NODE_RATE,
  addConnectionRate: NEAT_ADD_CONNECTION_RATE,
};

let networkArchitecture: NetworkArchitectureSuiteConfig = sanitizeNetworkArchitectureSuite(DEFAULT_NETWORK_ARCHITECTURE_SUITE);

function populationConfig(role: 'chaser' | 'evader') {
  const architecture = role === 'chaser' ? networkArchitecture.chaser : networkArchitecture.runner;
  return {
    ...baseNeatConfig,
    addNodeRate: architecture.addNodeRate,
    addConnectionRate: architecture.addConnectionRate,
    initialArchitecture: { ...architecture, hiddenLayers: [...architecture.hiddenLayers] },
  };
}

function createFreshPopulation(role: 'chaser' | 'evader') {
  return new NeatPopulation(role, populationConfig(role));
}

let chaserPopulation = createFreshPopulation('chaser');
let evaderPopulation = createFreshPopulation('evader');
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

const DEFAULT_UPGRADE_CONFIG: UpgradeConfig = {
  sprint: {
    mode: 'off', chaserEnabled: true, runnerEnabled: true,
    chaserAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
    runnerAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
  },
  controlledJump: { mode: 'off', chaserEnabled: true, runnerEnabled: true },
};
let upgradeConfig: UpgradeConfig = DEFAULT_UPGRADE_CONFIG;
const DEFAULT_TRAINING_FITNESS_CONFIG: TrainingFitnessConfig = {
  runnerPaceTargetPxPerWindow: DEFAULT_RUNNER_PACE_TARGET_PX,
  runnerPaceRewardPerWindow: DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW,
  chaserPursuitRewardPerPlatform: DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM,
};
let trainingFitnessConfig: TrainingFitnessConfig = { ...DEFAULT_TRAINING_FITNESS_CONFIG };

function sanitizeTrainingFitnessConfig(value?: Partial<TrainingFitnessConfig>): TrainingFitnessConfig {
  const target = Number(value?.runnerPaceTargetPxPerWindow);
  const paceReward = Number(value?.runnerPaceRewardPerWindow);
  const pursuit = Number(value?.chaserPursuitRewardPerPlatform);
  return {
    runnerPaceTargetPxPerWindow: Number.isFinite(target)
      ? Math.max(MIN_RUNNER_PACE_TARGET_PX, Math.min(MAX_RUNNER_PACE_TARGET_PX, target))
      : DEFAULT_TRAINING_FITNESS_CONFIG.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: Number.isFinite(paceReward)
      ? Math.max(0, Math.min(MAX_RUNNER_PACE_REWARD_PER_WINDOW, paceReward))
      : DEFAULT_TRAINING_FITNESS_CONFIG.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: Number.isFinite(pursuit)
      ? Math.max(0, Math.min(MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM, pursuit))
      : DEFAULT_TRAINING_FITNESS_CONFIG.chaserPursuitRewardPerPlatform,
  };
}

function sanitizeUpgradeConfig(value?: Partial<UpgradeConfig>): UpgradeConfig {
  const normalize = (rule: any, fallback: UpgradeConfig[keyof UpgradeConfig]): UpgradeConfig['controlledJump'] => ({
    mode: rule?.mode === 'on' ? 'on' : 'off',
    chaserEnabled: typeof rule?.chaserEnabled === 'boolean' ? rule.chaserEnabled : fallback.chaserEnabled,
    runnerEnabled: typeof rule?.runnerEnabled === 'boolean' ? rule.runnerEnabled : fallback.runnerEnabled,
  });
  const normalizeAdvanced = (advanced: any, fallback: UpgradeConfig['sprint']['chaserAdvanced']) => ({
    maxSpeedOverride: typeof advanced?.maxSpeedOverride === 'boolean' ? advanced.maxSpeedOverride : fallback.maxSpeedOverride,
    maxSpeed: Number.isFinite(Number(advanced?.maxSpeed)) ? Math.max(MAX_SPEED, Math.min(20, Number(advanced.maxSpeed))) : fallback.maxSpeed,
    staminaCostOverride: typeof advanced?.staminaCostOverride === 'boolean' ? advanced.staminaCostOverride : fallback.staminaCostOverride,
    staminaCostPerSec: Number.isFinite(Number(advanced?.staminaCostPerSec)) ? Math.max(0, Math.min(200, Number(advanced.staminaCostPerSec))) : fallback.staminaCostPerSec,
  });
  const sprintBase = normalize(value?.sprint, DEFAULT_UPGRADE_CONFIG.sprint);
  return {
    sprint: {
      ...sprintBase,
      chaserAdvanced: normalizeAdvanced(value?.sprint?.chaserAdvanced, DEFAULT_UPGRADE_CONFIG.sprint.chaserAdvanced),
      runnerAdvanced: normalizeAdvanced(value?.sprint?.runnerAdvanced, DEFAULT_UPGRADE_CONFIG.sprint.runnerAdvanced),
    },
    controlledJump: normalize(value?.controlledJump, DEFAULT_UPGRADE_CONFIG.controlledJump),
  };
}

function activeUpgradeState(): ActiveUpgradeState {
  const sprint = upgradeConfig.sprint.mode === 'on';
  const controlledJump = upgradeConfig.controlledJump.mode === 'on';
  const sprintChaser = sprint && upgradeConfig.sprint.chaserEnabled;
  const sprintRunner = sprint && upgradeConfig.sprint.runnerEnabled;
  const chaserAdvanced = upgradeConfig.sprint.chaserAdvanced;
  const runnerAdvanced = upgradeConfig.sprint.runnerAdvanced;
  return {
    sprint,
    controlledJump,
    sprintChaser,
    sprintRunner,
    controlledJumpChaser: controlledJump && upgradeConfig.controlledJump.chaserEnabled,
    controlledJumpRunner: controlledJump && upgradeConfig.controlledJump.runnerEnabled,
    sprintChaserMaxSpeed: sprintChaser && chaserAdvanced.maxSpeedOverride ? chaserAdvanced.maxSpeed : SPRINT_MAX_SPEED,
    sprintRunnerMaxSpeed: sprintRunner && runnerAdvanced.maxSpeedOverride ? runnerAdvanced.maxSpeed : SPRINT_MAX_SPEED,
    sprintChaserStaminaCostPerSec: sprintChaser && chaserAdvanced.staminaCostOverride ? chaserAdvanced.staminaCostPerSec : SPRINT_ENERGY_COST_PER_SEC,
    sprintRunnerStaminaCostPerSec: sprintRunner && runnerAdvanced.staminaCostOverride ? runnerAdvanced.staminaCostPerSec : SPRINT_ENERGY_COST_PER_SEC,
  };
}

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

type EvaluationPhase = 'chaser_population' | 'evader_population' | 'chaser_hof' | 'evader_hof';
interface HallOfFameEntry {
  generation: number;
  genome: NeatGenomeData;
  controller: LearningAgent;
  descriptor: number[];
  benchmarkScore: number;
}
interface HallOfFameArchive {
  recent: HallOfFameEntry[];
  diverse: HallOfFameEntry[];
}

interface SerializedHallOfFameEntry {
  generation: number;
  genome: NeatGenomeData;
  descriptor: number[];
  benchmarkScore: number;
}

interface EvolutionCheckpoint {
  format: 'neat-tag-evolution-checkpoint';
  version: 2;
  timestamp: number;
  generation: number;
  chaserPopulation: NeatPopulationCheckpoint;
  evaderPopulation: NeatPopulationCheckpoint;
  championChaser: NeatGenomeData;
  championEvader: NeatGenomeData;
  lastChaserMetrics: NeatGenerationMetrics | null;
  lastEvaderMetrics: NeatGenerationMetrics | null;
  upgradeConfig: UpgradeConfig;
  trainingFitnessConfig?: TrainingFitnessConfig;
  networkArchitecture?: NetworkArchitectureSuiteConfig;
  /** Fitness semantics marker for compatibility with checkpoints created before right-only exploration. */
  explorationRewardMode?: 'safe-per-runner-right-frontier';
  gameplayObjectiveVersion?: 'pace-pursuit-branches-v1';
  actionSchema?: 'factorized-controls-v1';
  chaserElo: number;
  evaderElo: number;
  hallOfFame: {
    chaser: { recent: SerializedHallOfFameEntry[]; diverse: SerializedHallOfFameEntry[] };
    evader: { recent: SerializedHallOfFameEntry[]; diverse: SerializedHallOfFameEntry[] };
  };
  benchmark: {
    chaserReferences: NeatGenomeData[];
    evaderReferences: NeatGenomeData[];
    suiteRevision: number;
    lastResult: CrossGenerationBenchmarkTelemetry | null;
  };
  telemetry: {
    totalTags: number;
    totalFalls: number;
    totalChaserFalls: number;
    totalRunnerFalls: number;
    totalJumps: number;
    totalEvaluationMatches: number;
    totalChaserEpisodeWins: number;
    totalEvaderEpisodeWins: number;
    totalEpisodeDraws: number;
    totalSimulatedTime: number;
    completedEpisodes: number;
    recentSurvivalTimes: number[];
    recentTimesToTag: number[];
    actionCountsChaser: Record<string, number>;
    actionCountsEvader: Record<string, number>;
    lastGenerationBalance: BalanceTelemetry | null;
    analysisHistory?: TrainingGenerationAnalysisRecord[];
  };
}

interface BenchmarkReference {
  genome: NeatGenomeData;
  controller: LearningAgent;
}

interface BenchmarkRoleEvaluation {
  telemetry: BenchmarkRoleTelemetry;
  descriptor: number[];
}

let evaluationPhase: EvaluationPhase = 'chaser_population';
let evaluationIndex = 0;
let evaluationRound = 0;

interface ParallelEvaluationTask {
  id: number;
  epoch: number;
  phase: EvaluationPhase;
  chaserIndex: number | null;
  evaderIndex: number | null;
  chaserKey: string;
  evaderKey: string;
  seed: number;
  trackChaserActions: boolean;
  trackEvaderActions: boolean;
  currentPopulationMatch: boolean;
  startMode: TrainingStartMode;
}

interface ParallelControllerEntry {
  key: string;
  role: 'chaser' | 'evader';
  genome: NeatGenomeData;
}

interface EvaluatorSlot {
  worker: Worker;
  busy: boolean;
  taskIds: number[];
  batchStartedAt: number;
  index: number;
}

let evaluatorPool: EvaluatorSlot[] = [];
let poolInitializationAttempted = false;
let parallelTasks: ParallelEvaluationTask[] = [];
let parallelRetryTasks: ParallelEvaluationTask[] = [];
let parallelControllerBank: ParallelControllerEntry[] = [];
let parallelTaskCursor = 0;
let parallelTasksCompleted = 0;
let nextParallelTaskId = 1;
let evaluationEpoch = 1;
let parallelGenerationPrepared = false;
let parallelBackendActive = false;
const activeParallelTasks = new Map<number, ParallelEvaluationTask>();
const PARALLEL_TASK_BATCH_SIZE = 4;
const EVALUATOR_WATCHDOG_INTERVAL_MS = 2000;
const EVALUATOR_BATCH_TIMEOUT_MS = 15000;
const EVALUATOR_WAKE_TIMEOUT_MS = 5000;
let evaluatorWatchdogId: ReturnType<typeof setInterval> | null = null;
let evaluatorRecoveryCount = 0;
let lastEvaluatorRecoveryReason = '';
const chaserHallOfFame: HallOfFameArchive = { recent: [], diverse: [] };
const evaderHallOfFame: HallOfFameArchive = { recent: [], diverse: [] };
let benchmarkChaserReferences: BenchmarkReference[] = [];
let benchmarkEvaderReferences: BenchmarkReference[] = [];
let benchmarkSuiteRevision = 0;
let lastCrossGenerationBenchmark: CrossGenerationBenchmarkTelemetry | null = null;
let chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
let generationPopulationMatches = 0;
let generationPopulationTags = 0;
let generationPopulationTaggedEpisodes = 0;
let generationPopulationTagTimeMs = 0;
let generationPopulationChaserFalls = 0;
let generationPopulationRunnerFalls = 0;
let generationPopulationCleanRunnerSurvivals = 0;
let generationRunnerFrontierExpansionPx = 0;
let generationRunnerLeftFrontierExpansionPx = 0;
let generationRunnerRawRightFrontierExpansionPx = 0;
let generationRunnerRightFrontierExpansionPx = 0;
let generationRunnerExplorationBonus = 0;
let generationRunnerPaceBonus = 0;
let generationRunnerPaceCompletion = 0;
let generationRunnerPaceWindowsSatisfied = 0;
let generationRunnerPaceWindowsTotal = 0;
let generationChaserPursuitBonus = 0;
let generationChaserPursuitLandings = 0;
let generationRunnerPlatformLandings = 0;
let generationChaserPlatformLandings = 0;
let generationRunnerBranchLandings = 0;
let generationChaserBranchLandings = 0;
let generationCloseEncounters = 0;
let generationSuccessfulEvades = 0;
let generationMeanNearestRunnerDistance = 0;
let generationTimeWithin100Pct = 0;
let generationTimeWithin200Pct = 0;
let generationTimeWithin400Pct = 0;
let generationTagsSoonAfterRunnerFall = 0;
let generationRunnerMaxFrontierExpansionPx = 0;
let generationActionCountsChaser = new Array<number>(ACTION_SPACE.length).fill(0);
let generationActionCountsEvader = new Array<number>(ACTION_SPACE.length).fill(0);
let generationDecisionCountChaser = 0;
let generationDecisionCountEvader = 0;
let generationIdleCountChaser = 0;
let generationIdleCountEvader = 0;
let lastGenerationBalance: BalanceTelemetry | null = null;
const MAX_ANALYSIS_HISTORY = 5000;
const analysisHistory: TrainingGenerationAnalysisRecord[] = [];
let latestSafeCheckpoint: EvolutionCheckpoint | null = null;

let totalTags = 0;
let totalFalls = 0;
let totalChaserFalls = 0;
let totalRunnerFalls = 0;
let totalJumps = 0;
let totalEvaluationMatches = 0;
let totalChaserEpisodeWins = 0;
let totalEvaderEpisodeWins = 0;
let totalEpisodeDraws = 0;
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
  tags: number;
  terminalFallRole: 'chaser' | 'evader' | null;
  chaserFalls: number;
  evaderFalls: number;
  tagTimeTotalMs: number;
  taggedSurvivalTimeTotalMs: number;
  elapsedMs: number;
  falls: number;
  jumps: number;
  chaserActionCounts: number[];
  evaderActionCounts: number[];
  chaserDecisionCount: number;
  evaderDecisionCount: number;
  chaserIdleCount: number;
  evaderIdleCount: number;
  runnerFrontierExpansionPx: number;
  runnerFrontierExpansionViewports: number;
  runnerLeftFrontierExpansionPx: number;
  runnerRawRightFrontierExpansionPx: number;
  runnerRightFrontierExpansionPx: number;
  runnerExplorationFitnessBonus: number;
  runnerPaceFitnessBonus: number;
  runnerPaceCompletion: number;
  runnerPaceWindowsSatisfied: number;
  runnerPaceWindowsTotal: number;
  chaserPursuitFitnessBonus: number;
  chaserPursuitLandings: number;
  runnerPlatformLandings: number;
  chaserPlatformLandings: number;
  runnerBranchLandings: number;
  chaserBranchLandings: number;
  closeEncounters: number;
  successfulEvades: number;
  meanNearestRunnerDistancePx: number;
  timeWithin100Ms: number;
  timeWithin200Ms: number;
  timeWithin400Ms: number;
  tagsSoonAfterRunnerFall: number;
  runnerMaxFrontierExpansionPx: number;
}

function runEpisode(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  trackActions: { chaser: boolean; evader: boolean } = { chaser: true, evader: true },
  startMode: TrainingStartMode = 'mixed'
): EpisodeStats {
  const result = runTrainingEpisode(chaser, evader, seed, {
    trackChaserActions: trackActions.chaser,
    trackEvaderActions: trackActions.evader,
    viewportSize,
    upgrades: activeUpgradeState(),
    startMode,
    runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
  });

  totalTags += result.tags;
  totalFalls += result.falls;
  totalChaserFalls += result.chaserFalls;
  totalRunnerFalls += result.evaderFalls;
  totalJumps += result.jumps;
  for (let i = 0; i < ACTION_SPACE.length; i++) {
    const action = ACTION_SPACE[i];
    const chaserCount = result.chaserActionCounts[i] || 0;
    const evaderCount = result.evaderActionCounts[i] || 0;
    if (chaserCount) actionCountsChaser[action] = (actionCountsChaser[action] || 0) + chaserCount;
    if (evaderCount) actionCountsEvader[action] = (actionCountsEvader[action] || 0) + evaderCount;
  }
  if (result.chaserIdleCount) actionCountsChaser.idle = (actionCountsChaser.idle || 0) + result.chaserIdleCount;
  if (result.evaderIdleCount) actionCountsEvader.idle = (actionCountsEvader.idle || 0) + result.evaderIdleCount;

  return result;
}

function benchmarkReferenceIndices(n: number): number[] {
  if (n <= 0) return [];
  const count = Math.min(NEAT_BENCHMARK_REFERENCES_PER_ROLE, n);
  if (count === 1) return [0];
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.round((i * (n - 1)) / (count - 1));
    if (!indices.includes(index)) indices.push(index);
  }
  return indices;
}

function resetBenchmarkSuite() {
  const makeRefs = (role: 'chaser' | 'evader', genomes: NeatGenomeData[]): BenchmarkReference[] =>
    benchmarkReferenceIndices(genomes.length).map((index, refIndex) => {
      const genome = cloneGenome(genomes[index], `${role}_benchmark_ref_${refIndex}`);
      genome.role = role;
      genome.fitness = undefined;
      return { genome, controller: new LearningAgent(role, genome) };
    });

  benchmarkChaserReferences = makeRefs('chaser', chaserPopulation.genomes);
  benchmarkEvaderReferences = makeRefs('evader', evaderPopulation.genomes);
  benchmarkSuiteRevision++;
  lastCrossGenerationBenchmark = null;
}

function ensureBenchmarkSuite() {
  if (benchmarkChaserReferences.length === 0 || benchmarkEvaderReferences.length === 0) resetBenchmarkSuite();
}

function benchmarkStartMode(index: number): TrainingStartMode {
  const modes: TrainingStartMode[] = ['visual', 'varied', 'midgame'];
  return modes[index % Math.min(NEAT_BENCHMARK_START_MODES, modes.length)];
}

function benchmarkSeed(role: 'chaser' | 'evader', referenceIndex: number, modeIndex: number): number {
  // Permanent suite seeds: intentionally independent of generation and current populations.
  const roleSalt = role === 'chaser' ? 0x4c11db7 : 0x6a09e667;
  return (roleSalt ^ Math.imul(referenceIndex + 1, 0x9e3779b1) ^ Math.imul(modeIndex + 1, 0x85ebca6b)) >>> 0;
}

function controlActiveShare(counts: number[], action: string, decisions: number): number {
  const index = ACTION_SPACE.indexOf(action);
  return index >= 0 ? (counts[index] || 0) / Math.max(1, decisions) : 0;
}

function evaluateFixedBenchmark(genome: NeatGenomeData, role: 'chaser' | 'evader'): BenchmarkRoleEvaluation {
  ensureBenchmarkSuite();
  const candidate = new LearningAgent(role, genome);
  const references = role === 'chaser' ? benchmarkEvaderReferences : benchmarkChaserReferences;
  const modesToRun = Math.min(NEAT_BENCHMARK_START_MODES, 3);
  const actionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  let fitnessTotal = 0;
  let tags = 0;
  let ownFalls = 0;
  let explorationViewports = 0;
  let paceCompletion = 0;
  let pursuitBonus = 0;
  let closeEncounters = 0;
  let decisionCount = 0;
  let idleCount = 0;
  let matches = 0;
  const upgrades = activeUpgradeState();

  references.forEach((reference, referenceIndex) => {
    for (let modeIndex = 0; modeIndex < modesToRun; modeIndex++) {
      const seed = benchmarkSeed(role, referenceIndex, modeIndex);
      const result = role === 'chaser'
        ? runTrainingEpisode(candidate, reference.controller, seed, {
            trackChaserActions: true,
            trackEvaderActions: false,
            viewportSize,
            upgrades,
            startMode: benchmarkStartMode(modeIndex),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          })
        : runTrainingEpisode(reference.controller, candidate, seed, {
            trackChaserActions: false,
            trackEvaderActions: true,
            viewportSize,
            upgrades,
            startMode: benchmarkStartMode(modeIndex),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          });

      fitnessTotal += role === 'chaser' ? result.chaserFitness : result.evaderFitness;
      tags += result.tags;
      ownFalls += role === 'chaser' ? result.chaserFalls : result.evaderFalls;
      if (role === 'evader') {
        explorationViewports += result.runnerFrontierExpansionViewports;
        paceCompletion += result.runnerPaceCompletion;
      } else {
        pursuitBonus += result.chaserPursuitFitnessBonus;
      }
      closeEncounters += result.closeEncounters;
      const sourceCounts = role === 'chaser' ? result.chaserActionCounts : result.evaderActionCounts;
      for (let i = 0; i < ACTION_SPACE.length; i++) actionCounts[i] += sourceCounts[i] || 0;
      decisionCount += role === 'chaser' ? result.chaserDecisionCount : result.evaderDecisionCount;
      idleCount += role === 'chaser' ? result.chaserIdleCount : result.evaderIdleCount;
      matches++;
    }
  });

  const tagsPerEpisode = tags / Math.max(1, matches);
  const ownFallsPerEpisode = ownFalls / Math.max(1, matches);
  const telemetry: BenchmarkRoleTelemetry = {
    meanFitness: fitnessTotal / Math.max(1, matches),
    matches,
    tagsPerEpisode,
    ownFallsPerEpisode,
    rightActionShare: controlActiveShare(actionCounts, 'move_right', decisionCount),
    jumpActionShare: controlActiveShare(actionCounts, 'jump', decisionCount),
    sprintActionShare: upgrades.sprint ? controlActiveShare(actionCounts, 'sprint', decisionCount) : 0,
    idleActionShare: idleCount / Math.max(1, decisionCount),
    explorationViewportsPerEpisode: role === 'evader' ? explorationViewports / Math.max(1, matches) : 0,
    paceCompletion: role === 'evader' ? paceCompletion / Math.max(1, matches) : 0,
    pursuitBonusPerEpisode: role === 'chaser' ? pursuitBonus / Math.max(1, matches) : 0,
    closeEncountersPerEpisode: closeEncounters / Math.max(1, matches),
  };

  // Outcome rates are smoothly compressed so repeated events do not dominate the action-style
  // dimensions. The descriptor is for archive diversity only; it never enters evolutionary fitness.
  const descriptor = [
    1 - Math.exp(-tagsPerEpisode),
    1 - Math.exp(-ownFallsPerEpisode),
    telemetry.rightActionShare,
    telemetry.jumpActionShare,
    telemetry.sprintActionShare,
    telemetry.idleActionShare,
    role === 'evader' ? (telemetry.paceCompletion || 0) : Math.tanh((telemetry.pursuitBonusPerEpisode || 0) / 5),
  ];
  return { telemetry, descriptor };
}

function runCrossGenerationBenchmark(
  generation: number,
  chaserGenome: NeatGenomeData,
  evaderGenome: NeatGenomeData
): { chaser: BenchmarkRoleEvaluation; evader: BenchmarkRoleEvaluation } {
  const chaser = evaluateFixedBenchmark(chaserGenome, 'chaser');
  const evader = evaluateFixedBenchmark(evaderGenome, 'evader');
  lastCrossGenerationBenchmark = {
    generation,
    suiteRevision: benchmarkSuiteRevision,
    chaser: chaser.telemetry,
    evader: evader.telemetry,
  };
  return { chaser, evader };
}

function refreshHallOfFameBenchmarkMetadata(): void {
  const refreshArchive = (archive: HallOfFameArchive, role: 'chaser' | 'evader') => {
    for (const entry of [...archive.recent, ...archive.diverse]) {
      const evaluation = evaluateFixedBenchmark(entry.genome, role);
      entry.descriptor = [...evaluation.descriptor];
      entry.benchmarkScore = evaluation.telemetry.meanFitness;
    }
  };
  refreshArchive(chaserHallOfFame, 'chaser');
  refreshArchive(evaderHallOfFame, 'evader');
}

function descriptorDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const delta = (a[i] || 0) - (b[i] || 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum / length);
}

function archiveDiversity(entries: HallOfFameEntry[]): number {
  if (entries.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      total += descriptorDistance(entries[i].descriptor, entries[j].descriptor);
      pairs++;
    }
  }
  return total / Math.max(1, pairs);
}

function normalizedBenchmarkStrength(score: number): number {
  return 0.5 + 0.5 * Math.tanh((score - 100) / 60);
}

function entryNovelty(entry: HallOfFameEntry, peers: HallOfFameEntry[]): number {
  if (peers.length === 0) return 1;
  let nearest = Infinity;
  for (const peer of peers) {
    if (peer === entry) continue;
    nearest = Math.min(nearest, descriptorDistance(entry.descriptor, peer.descriptor));
  }
  return Number.isFinite(nearest) ? nearest : 1;
}

function addDiverseHistorical(archive: HallOfFameArchive, candidate: HallOfFameEntry) {
  const recentLimit = Math.min(NEAT_HOF_RECENT_SLOTS, NEAT_HOF_MAX_SIZE);
  const diverseLimit = Math.max(0, NEAT_HOF_MAX_SIZE - recentLimit);
  if (diverseLimit === 0) return;

  // First collapse obvious behavioral duplicates: the stronger fixed-benchmark representative wins.
  let nearestIndex = -1;
  let nearestDistance = Infinity;
  for (let i = 0; i < archive.diverse.length; i++) {
    const distance = descriptorDistance(candidate.descriptor, archive.diverse[i].descriptor);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }
  if (nearestIndex >= 0 && nearestDistance < NEAT_HOF_SIMILARITY_THRESHOLD) {
    if (candidate.benchmarkScore > archive.diverse[nearestIndex].benchmarkScore) {
      archive.diverse[nearestIndex] = candidate;
    }
    return;
  }

  if (archive.diverse.length < diverseLimit) {
    archive.diverse.push(candidate);
    return;
  }

  // Once full, retain entries that jointly maximize behavioral novelty and fixed-suite strength.
  const strengthWeight = 1 - NEAT_HOF_NOVELTY_WEIGHT;
  const candidateNovelty = entryNovelty(candidate, archive.diverse);
  const candidateUtility =
    NEAT_HOF_NOVELTY_WEIGHT * candidateNovelty +
    strengthWeight * normalizedBenchmarkStrength(candidate.benchmarkScore);

  let worstIndex = 0;
  let worstUtility = Infinity;
  for (let i = 0; i < archive.diverse.length; i++) {
    const peers = archive.diverse.filter((_, index) => index !== i);
    const novelty = entryNovelty(archive.diverse[i], peers);
    const utility =
      NEAT_HOF_NOVELTY_WEIGHT * novelty +
      strengthWeight * normalizedBenchmarkStrength(archive.diverse[i].benchmarkScore);
    if (utility < worstUtility) {
      worstUtility = utility;
      worstIndex = i;
    }
  }

  if (candidateUtility > worstUtility) archive.diverse[worstIndex] = candidate;
}

function hallOfFamePool(archive: HallOfFameArchive): HallOfFameEntry[] {
  return [...archive.diverse, ...archive.recent];
}

function archiveChampion(
  archive: HallOfFameArchive,
  genome: NeatGenomeData,
  role: 'chaser' | 'evader',
  benchmarkEvaluation?: BenchmarkRoleEvaluation
) {
  const snapshot = cloneGenome(genome, `${role}_hof_g${genome.generation}`);
  snapshot.role = role;
  const evaluation = benchmarkEvaluation || evaluateFixedBenchmark(snapshot, role);
  const entry: HallOfFameEntry = {
    generation: snapshot.generation,
    genome: snapshot,
    controller: new LearningAgent(role, snapshot),
    descriptor: [...evaluation.descriptor],
    benchmarkScore: evaluation.telemetry.meanFitness,
  };

  archive.recent.push(entry);
  const recentLimit = Math.min(NEAT_HOF_RECENT_SLOTS, NEAT_HOF_MAX_SIZE);
  if (archive.recent.length <= recentLimit) return;
  addDiverseHistorical(archive, archive.recent.shift()!);
}

function clearHallOfFame() {
  chaserHallOfFame.recent.length = 0;
  chaserHallOfFame.diverse.length = 0;
  evaderHallOfFame.recent.length = 0;
  evaderHallOfFame.diverse.length = 0;
}

function serializeHallEntry(entry: HallOfFameEntry): SerializedHallOfFameEntry {
  return {
    generation: entry.generation,
    genome: cloneGenome(entry.genome),
    descriptor: [...entry.descriptor],
    benchmarkScore: entry.benchmarkScore,
  };
}

function restoreHallEntry(saved: SerializedHallOfFameEntry, role: 'chaser' | 'evader'): HallOfFameEntry {
  const genome = cloneGenome(saved.genome);
  genome.role = role;
  return {
    generation: saved.generation,
    genome,
    controller: new LearningAgent(role, genome),
    descriptor: [...(saved.descriptor || [])],
    benchmarkScore: Number(saved.benchmarkScore) || 0,
  };
}

function currentHallOfFameTelemetry(): HallOfFameTelemetry {
  return {
    chaserSize: hallOfFamePool(chaserHallOfFame).length,
    evaderSize: hallOfFamePool(evaderHallOfFame).length,
    maxSize: NEAT_HOF_MAX_SIZE,
    opponentsPerGenome: NEAT_HOF_OPPONENTS_PER_GENOME,
    chaserGenerations: hallOfFamePool(chaserHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
    evaderGenerations: hallOfFamePool(evaderHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
    chaserRecentSize: chaserHallOfFame.recent.length,
    evaderRecentSize: evaderHallOfFame.recent.length,
    chaserDiverseSize: chaserHallOfFame.diverse.length,
    evaderDiverseSize: evaderHallOfFame.diverse.length,
    chaserDiversity: archiveDiversity(chaserHallOfFame.diverse),
    evaderDiversity: archiveDiversity(evaderHallOfFame.diverse),
  };
}

function actionSharesFromArray(counts: number[], decisions: number, idle: number): Record<string, number> {
  const denom = Math.max(1, decisions);
  return {
    ...Object.fromEntries(ACTION_SPACE.map((action, index) => [action, (counts[index] || 0) / denom])),
    idle: idle / denom,
  };
}

function recordGenerationAnalysis(generation: number): void {
  const record: TrainingGenerationAnalysisRecord = {
    generation,
    recordedAt: Date.now(),
    simulatedTimeMs: totalSimulatedTime,
    completedEpisodes,
    chaserMetrics: lastChaserMetrics ? { ...lastChaserMetrics } : null,
    runnerMetrics: lastEvaderMetrics ? { ...lastEvaderMetrics } : null,
    balance: lastGenerationBalance ? { ...lastGenerationBalance } : null,
    benchmark: lastCrossGenerationBenchmark
      ? JSON.parse(JSON.stringify(lastCrossGenerationBenchmark)) as CrossGenerationBenchmarkTelemetry
      : null,
    hallOfFame: currentHallOfFameTelemetry(),
    chaserElo,
    runnerElo: evaderElo,
    actionShares: {
      chaser: actionSharesFromArray(generationActionCountsChaser, generationDecisionCountChaser, generationIdleCountChaser),
      runner: actionSharesFromArray(generationActionCountsEvader, generationDecisionCountEvader, generationIdleCountEvader),
    },
    fitnessConfig: { ...trainingFitnessConfig },
    networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture),
  };
  analysisHistory.push(record);
  if (analysisHistory.length > MAX_ANALYSIS_HISTORY) analysisHistory.splice(0, analysisHistory.length - MAX_ANALYSIS_HISTORY);
}

function buildEvolutionCheckpoint(): EvolutionCheckpoint {
  return {
    format: 'neat-tag-evolution-checkpoint',
    version: 2,
    timestamp: Date.now(),
    generation: chaserPopulation.generation,
    chaserPopulation: chaserPopulation.exportCheckpoint(),
    evaderPopulation: evaderPopulation.exportCheckpoint(),
    championChaser: championChaser.getWeights(),
    championEvader: championEvader.getWeights(),
    lastChaserMetrics: lastChaserMetrics ? { ...lastChaserMetrics } : null,
    lastEvaderMetrics: lastEvaderMetrics ? { ...lastEvaderMetrics } : null,
    upgradeConfig: sanitizeUpgradeConfig(upgradeConfig),
    trainingFitnessConfig: sanitizeTrainingFitnessConfig(trainingFitnessConfig),
    networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture),
    explorationRewardMode: 'safe-per-runner-right-frontier',
    gameplayObjectiveVersion: 'pace-pursuit-branches-v1',
    actionSchema: 'factorized-controls-v1',
    chaserElo,
    evaderElo,
    hallOfFame: {
      chaser: {
        recent: chaserHallOfFame.recent.map(serializeHallEntry),
        diverse: chaserHallOfFame.diverse.map(serializeHallEntry),
      },
      evader: {
        recent: evaderHallOfFame.recent.map(serializeHallEntry),
        diverse: evaderHallOfFame.diverse.map(serializeHallEntry),
      },
    },
    benchmark: {
      chaserReferences: benchmarkChaserReferences.map(ref => cloneGenome(ref.genome)),
      evaderReferences: benchmarkEvaderReferences.map(ref => cloneGenome(ref.genome)),
      suiteRevision: benchmarkSuiteRevision,
      lastResult: lastCrossGenerationBenchmark
        ? JSON.parse(JSON.stringify(lastCrossGenerationBenchmark)) as CrossGenerationBenchmarkTelemetry
        : null,
    },
    telemetry: {
      totalTags,
      totalFalls,
      totalChaserFalls,
      totalRunnerFalls,
      totalJumps,
      totalEvaluationMatches,
      totalChaserEpisodeWins,
      totalEvaderEpisodeWins,
      totalEpisodeDraws,
      totalSimulatedTime,
      completedEpisodes,
      recentSurvivalTimes: [...recentSurvivalTimes],
      recentTimesToTag: [...recentTimesToTag],
      actionCountsChaser: { ...actionCountsChaser },
      actionCountsEvader: { ...actionCountsEvader },
      lastGenerationBalance: lastGenerationBalance ? { ...lastGenerationBalance } : null,
      analysisHistory: JSON.parse(JSON.stringify(analysisHistory)) as TrainingGenerationAnalysisRecord[],
    },
  };
}

function captureSafeCheckpoint(): void {
  // Called only at an evaluation boundary (new/reset/imported population). This intentionally
  // excludes half-finished evaluator batches so a restored run never double-counts matches.
  latestSafeCheckpoint = buildEvolutionCheckpoint();
}

function restoreEvolutionCheckpoint(checkpoint: EvolutionCheckpoint): void {
  if (!checkpoint || checkpoint.format !== 'neat-tag-evolution-checkpoint' || checkpoint.version !== 2 || checkpoint.actionSchema !== 'factorized-controls-v1') {
    throw new Error('This checkpoint predates the factorized movement+jump controller. Start a fresh run or load a checkpoint created by this build.');
  }

  networkArchitecture = sanitizeNetworkArchitectureSuite(checkpoint.networkArchitecture || DEFAULT_NETWORK_ARCHITECTURE_SUITE);
  chaserPopulation = createFreshPopulation('chaser');
  evaderPopulation = createFreshPopulation('evader');
  chaserPopulation.restoreCheckpoint(checkpoint.chaserPopulation);
  evaderPopulation.restoreCheckpoint(checkpoint.evaderPopulation);
  championChaser = new LearningAgent('chaser', checkpoint.championChaser);
  championEvader = new LearningAgent('evader', checkpoint.championEvader);
  lastChaserMetrics = checkpoint.lastChaserMetrics ? { ...checkpoint.lastChaserMetrics } : null;
  lastEvaderMetrics = checkpoint.lastEvaderMetrics ? { ...checkpoint.lastEvaderMetrics } : null;
  upgradeConfig = sanitizeUpgradeConfig(checkpoint.upgradeConfig);
  const migratedExplorationFitness = !checkpoint.trainingFitnessConfig;
  const migratedExplorationRewardMode = checkpoint.explorationRewardMode !== 'safe-per-runner-right-frontier';
  const migratedGameplayObjective = checkpoint.gameplayObjectiveVersion !== 'pace-pursuit-branches-v1';
  trainingFitnessConfig = sanitizeTrainingFitnessConfig(checkpoint.trainingFitnessConfig);
  chaserElo = Number.isFinite(checkpoint.chaserElo) ? checkpoint.chaserElo : INITIAL_ELO;
  evaderElo = Number.isFinite(checkpoint.evaderElo) ? checkpoint.evaderElo : INITIAL_ELO;

  clearHallOfFame();
  chaserHallOfFame.recent.push(...(checkpoint.hallOfFame?.chaser?.recent || []).map(entry => restoreHallEntry(entry, 'chaser')));
  chaserHallOfFame.diverse.push(...(checkpoint.hallOfFame?.chaser?.diverse || []).map(entry => restoreHallEntry(entry, 'chaser')));
  evaderHallOfFame.recent.push(...(checkpoint.hallOfFame?.evader?.recent || []).map(entry => restoreHallEntry(entry, 'evader')));
  evaderHallOfFame.diverse.push(...(checkpoint.hallOfFame?.evader?.diverse || []).map(entry => restoreHallEntry(entry, 'evader')));

  benchmarkChaserReferences = (checkpoint.benchmark?.chaserReferences || []).map(genome => ({
    genome: cloneGenome(genome),
    controller: new LearningAgent('chaser', genome),
  }));
  benchmarkEvaderReferences = (checkpoint.benchmark?.evaderReferences || []).map(genome => ({
    genome: cloneGenome(genome),
    controller: new LearningAgent('evader', genome),
  }));
  benchmarkSuiteRevision = Math.max(0, Math.floor(checkpoint.benchmark?.suiteRevision || 0));
  lastCrossGenerationBenchmark = checkpoint.benchmark?.lastResult
    ? JSON.parse(JSON.stringify(checkpoint.benchmark.lastResult)) as CrossGenerationBenchmarkTelemetry
    : null;
  ensureBenchmarkSuite();
  const hasLegacyHallDescriptor = [...chaserHallOfFame.recent, ...chaserHallOfFame.diverse, ...evaderHallOfFame.recent, ...evaderHallOfFame.diverse]
    .some(entry => entry.descriptor.length < 6);
  if (migratedExplorationFitness || migratedExplorationRewardMode || migratedGameplayObjective || hasLegacyHallDescriptor) {
    benchmarkSuiteRevision++;
    lastCrossGenerationBenchmark = null;
    refreshHallOfFameBenchmarkMetadata();
  }

  const telemetry = checkpoint.telemetry || ({} as EvolutionCheckpoint['telemetry']);
  totalTags = Number(telemetry.totalTags) || 0;
  totalFalls = Number(telemetry.totalFalls) || 0;
  totalChaserFalls = Number(telemetry.totalChaserFalls) || 0;
  totalRunnerFalls = Number(telemetry.totalRunnerFalls) || 0;
  totalJumps = Number(telemetry.totalJumps) || 0;
  totalEvaluationMatches = Number(telemetry.totalEvaluationMatches) || 0;
  totalChaserEpisodeWins = Number(telemetry.totalChaserEpisodeWins) || 0;
  totalEvaderEpisodeWins = Number(telemetry.totalEvaderEpisodeWins) || 0;
  totalEpisodeDraws = Number(telemetry.totalEpisodeDraws) || 0;
  totalSimulatedTime = Number(telemetry.totalSimulatedTime) || 0;
  completedEpisodes = Number(telemetry.completedEpisodes) || 0;
  recentSurvivalTimes.length = 0;
  recentSurvivalTimes.push(...(telemetry.recentSurvivalTimes || []).slice(-SURVIVAL_TIME_HISTORY_LENGTH));
  recentTimesToTag.length = 0;
  recentTimesToTag.push(...(telemetry.recentTimesToTag || []).slice(-TIME_TO_TAG_HISTORY_LENGTH));
  Object.keys(actionCountsChaser).forEach(key => delete actionCountsChaser[key]);
  Object.assign(actionCountsChaser, telemetry.actionCountsChaser || {});
  Object.keys(actionCountsEvader).forEach(key => delete actionCountsEvader[key]);
  Object.assign(actionCountsEvader, telemetry.actionCountsEvader || {});
  lastGenerationBalance = telemetry.lastGenerationBalance ? { ...telemetry.lastGenerationBalance } : null;
  analysisHistory.length = 0;
  analysisHistory.push(...((telemetry.analysisHistory || []).slice(-MAX_ANALYSIS_HISTORY)));

  seededFromStart = true;
  refreshControllers();
  resetEvaluationAccumulators();
  invalidateParallelGeneration();
  resetTrainingThroughput();
  captureSafeCheckpoint();
}

function shuffledIndices(n: number, generation: number, salt: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  const rng = mulberry32((((generation + 1) * 2654435761) ^ salt) >>> 0);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function commonPopulationOpponentIndices(
  n: number,
  count: number,
  generation: number,
  salt: number
): number[] {
  return shuffledIndices(n, generation, salt).slice(0, Math.min(count, n));
}

function populationStartMode(round: number): TrainingStartMode {
  // With the default 3-opponent panel every candidate gets one exact visual reset, one varied
  // fresh reset, and one real mid-game snapshot generated by the shared simulation core.
  if (round === 0) return 'visual';
  if (round === 1) return 'varied';
  return 'midgame';
}

function heldOutStartMode(matchIndex: number): TrainingStartMode {
  // Champion validation emphasizes states that cannot be solved by memorizing the opening while
  // retaining some fresh-start coverage.
  return matchIndex % 3 === 0 ? 'varied' : 'midgame';
}

function commonOpponentPanels(generation: number) {
  const n = chaserPopulation.genomes.length;
  return {
    // Every chaser faces these same runner genomes; every runner faces the same chaser genomes.
    evaderIndices: commonPopulationOpponentIndices(n, NEAT_OPPONENTS_PER_GENOME, generation, 0x51ed270b),
    chaserIndices: commonPopulationOpponentIndices(n, NEAT_OPPONENTS_PER_GENOME, generation, 0x7f4a7c15),
  };
}

function selectHallOpponent(
  archive: HallOfFameArchive,
  round: number,
  generation: number,
  salt: number
): HallOfFameEntry | null {
  const pool = hallOfFamePool(archive);
  if (pool.length === 0) return null;
  // Deliberately independent of candidate index: all candidates in a role see the same
  // historical opponent in a given round.
  const index = Math.abs((round * 5 + generation * 3 + salt) % pool.length);
  return pool[index];
}

function heldOutPopulationIndices(
  n: number,
  excluded: number[],
  count: number,
  generation: number,
  salt: number
): number[] {
  const blocked = new Set(excluded);
  return shuffledIndices(n, generation, salt)
    .filter(index => !blocked.has(index))
    .slice(0, Math.min(count, Math.max(0, n - blocked.size)));
}

function commonValidationHallPanel(
  archive: HallOfFameArchive,
  count: number,
  generation: number,
  salt: number,
  excludedGenomeIds: Set<string>
): HallOfFameEntry[] {
  const pool = hallOfFamePool(archive).filter(entry => !excludedGenomeIds.has(entry.genome.id));
  if (pool.length <= count) return [...pool];
  return shuffledIndices(pool.length, generation, salt).slice(0, count).map(index => pool[index]);
}

/**
 * Re-check only the strongest few genomes against opponents and scenario seeds not used by the
 * main common panel. The winner gets an infinitesimal fitness promotion so NEAT's normal evolve()
 * preserves that validated genome as the generation champion without otherwise reshaping selection.
 */
function promoteValidatedChampion(role: 'chaser' | 'evader', generation: number): void {
  const population = role === 'chaser' ? chaserPopulation : evaderPopulation;
  const controllers = role === 'chaser' ? chaserControllers : evaderControllers;
  const opponentControllers = role === 'chaser' ? evaderControllers : chaserControllers;
  const opponentArchive = role === 'chaser' ? evaderHallOfFame : chaserHallOfFame;
  const panels = commonOpponentPanels(generation);
  const excluded = role === 'chaser' ? panels.evaderIndices : panels.chaserIndices;
  const heldOutIndices = heldOutPopulationIndices(
    opponentControllers.length,
    excluded,
    NEAT_CHAMPION_VALIDATION_CURRENT_OPPONENTS,
    generation,
    role === 'chaser' ? 0x13579bdf : 0x2468ace0
  );
  const mainHallSalt = role === 'chaser' ? 11 : 23;
  const mainHallGenomeIds = new Set<string>();
  for (let round = 0; round < NEAT_HOF_OPPONENTS_PER_GENOME; round++) {
    const mainOpponent = selectHallOpponent(opponentArchive, round, generation, mainHallSalt);
    if (mainOpponent) mainHallGenomeIds.add(mainOpponent.genome.id);
  }
  const heldOutHall = commonValidationHallPanel(
    opponentArchive,
    NEAT_CHAMPION_VALIDATION_HOF_OPPONENTS,
    generation,
    role === 'chaser' ? 0x31415926 : 0x27182818,
    mainHallGenomeIds
  );

  const candidates = population.genomes
    .map((genome, index) => ({ index, rawFitness: genome.fitness ?? -Infinity }))
    .sort((a, b) => b.rawFitness - a.rawFitness)
    .slice(0, Math.min(NEAT_CHAMPION_VALIDATION_CANDIDATES, population.genomes.length));
  if (candidates.length === 0 || (heldOutIndices.length === 0 && heldOutHall.length === 0)) return;

  const upgrades = activeUpgradeState();
  let winner = candidates[0];
  let winnerValidation = -Infinity;

  for (const candidate of candidates) {
    let total = 0;
    let matches = 0;
    const controller = controllers[candidate.index];

    heldOutIndices.forEach((opponentIndex, matchIndex) => {
      const seed = (
        generation * 400009 +
        matchIndex * 17431 +
        (role === 'chaser' ? 911 : 3571)
      ) >>> 0;
      const result = role === 'chaser'
        ? runTrainingEpisode(controller, opponentControllers[opponentIndex], seed, {
            trackChaserActions: false,
            trackEvaderActions: false,
            viewportSize,
            upgrades,
            startMode: heldOutStartMode(matchIndex),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          })
        : runTrainingEpisode(opponentControllers[opponentIndex], controller, seed, {
            trackChaserActions: false,
            trackEvaderActions: false,
            viewportSize,
            upgrades,
            startMode: heldOutStartMode(matchIndex),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          });
      total += role === 'chaser' ? result.chaserFitness : result.evaderFitness;
      matches++;
    });

    heldOutHall.forEach((entry, matchIndex) => {
      const seed = (
        generation * 500009 +
        matchIndex * 21929 +
        (role === 'chaser' ? 1237 : 4567)
      ) >>> 0;
      const result = role === 'chaser'
        ? runTrainingEpisode(controller, entry.controller, seed, {
            trackChaserActions: false,
            trackEvaderActions: false,
            viewportSize,
            upgrades,
            startMode: heldOutStartMode(matchIndex + heldOutIndices.length),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          })
        : runTrainingEpisode(entry.controller, controller, seed, {
            trackChaserActions: false,
            trackEvaderActions: false,
            viewportSize,
            upgrades,
            startMode: heldOutStartMode(matchIndex + heldOutIndices.length),
            runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
          });
      total += role === 'chaser' ? result.chaserFitness : result.evaderFitness;
      matches++;
    });

    const validationFitness = total / Math.max(1, matches);
    if (
      validationFitness > winnerValidation ||
      (validationFitness === winnerValidation && candidate.rawFitness > winner.rawFitness)
    ) {
      winner = candidate;
      winnerValidation = validationFitness;
    }
  }

  const maxRawFitness = Math.max(...population.genomes.map(g => g.fitness ?? -Infinity));
  population.genomes[winner.index].fitness = maxRawFitness + 1e-6;
}


function invalidateParallelGeneration() {
  evaluationEpoch++;
  parallelTasks = [];
  parallelRetryTasks = [];
  parallelControllerBank = [];
  parallelTaskCursor = 0;
  parallelTasksCompleted = 0;
  parallelGenerationPrepared = false;
  activeParallelTasks.clear();
}

function prepareParallelGeneration() {
  const n = chaserPopulation.genomes.length;
  const generation = chaserPopulation.generation;
  const tasks: ParallelEvaluationTask[] = [];
  const panels = commonOpponentPanels(generation);
  const evaderHofPool = hallOfFamePool(evaderHallOfFame);
  const chaserHofPool = hallOfFamePool(chaserHallOfFame);
  const upgrades = { ...activeUpgradeState() };
  const bank = new Map<string, ParallelControllerEntry>();

  const registerGenome = (role: 'chaser' | 'evader', genome: NeatGenomeData): string => {
    const key = `${role}:${genome.id}:${genome.generation}`;
    if (!bank.has(key)) bank.set(key, { key, role, genome });
    return key;
  };

  const addTask = (
    task: Omit<ParallelEvaluationTask, 'id' | 'epoch' | 'chaserKey' | 'evaderKey'>,
    chaserGenome: NeatGenomeData,
    evaderGenome: NeatGenomeData
  ) => {
    tasks.push({
      ...task,
      id: nextParallelTaskId++,
      epoch: evaluationEpoch,
      chaserKey: registerGenome('chaser', chaserGenome),
      evaderKey: registerGenome('evader', evaderGenome),
    });
  };

  // Fair current-population comparisons: every chaser sees the same runner panel and scenario
  // seeds, then every runner sees the same chaser panel and its own common scenario seeds.
  panels.evaderIndices.forEach((evaderIndex, round) => {
    for (let chaserIndex = 0; chaserIndex < n; chaserIndex++) {
      addTask({
        phase: 'chaser_population',
        chaserIndex,
        evaderIndex,
        seed: (generation * 100003 + round * 7919 + 17) >>> 0,
        trackChaserActions: true,
        trackEvaderActions: false,
        currentPopulationMatch: true,
        startMode: populationStartMode(round),
      }, chaserPopulation.genomes[chaserIndex], evaderPopulation.genomes[evaderIndex]);
    }
  });

  panels.chaserIndices.forEach((chaserIndex, round) => {
    for (let evaderIndex = 0; evaderIndex < n; evaderIndex++) {
      addTask({
        phase: 'evader_population',
        chaserIndex,
        evaderIndex,
        seed: (generation * 100003 + round * 7919 + 53) >>> 0,
        trackChaserActions: false,
        trackEvaderActions: true,
        currentPopulationMatch: true,
        startMode: populationStartMode(round),
      }, chaserPopulation.genomes[chaserIndex], evaderPopulation.genomes[evaderIndex]);
    }
  });

  if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && evaderHofPool.length > 0) {
    for (let round = 0; round < NEAT_HOF_OPPONENTS_PER_GENOME; round++) {
      const opponent = selectHallOpponent(evaderHallOfFame, round, generation, 11);
      if (!opponent) continue;
      for (let chaserIndex = 0; chaserIndex < n; chaserIndex++) {
        addTask({
          phase: 'chaser_hof',
          chaserIndex,
          evaderIndex: null,
          seed: (generation * 200003 + round * 12011 + 101) >>> 0,
          trackChaserActions: true,
          trackEvaderActions: false,
          currentPopulationMatch: false,
          startMode: 'midgame',
        }, chaserPopulation.genomes[chaserIndex], opponent.genome);
      }
    }
  }

  if (NEAT_HOF_OPPONENTS_PER_GENOME > 0 && chaserHofPool.length > 0) {
    for (let round = 0; round < NEAT_HOF_OPPONENTS_PER_GENOME; round++) {
      const opponent = selectHallOpponent(chaserHallOfFame, round, generation, 23);
      if (!opponent) continue;
      for (let evaderIndex = 0; evaderIndex < n; evaderIndex++) {
        addTask({
          phase: 'evader_hof',
          chaserIndex: null,
          evaderIndex,
          seed: (generation * 300007 + round * 16001 + 211) >>> 0,
          trackChaserActions: false,
          trackEvaderActions: true,
          currentPopulationMatch: false,
          startMode: 'midgame',
        }, opponent.genome, evaderPopulation.genomes[evaderIndex]);
      }
    }
  }

  parallelTasks = tasks;
  parallelRetryTasks = [];
  parallelControllerBank = Array.from(bank.values());
  parallelTaskCursor = 0;
  parallelTasksCompleted = 0;
  activeParallelTasks.clear();
  parallelGenerationPrepared = true;

  // Load each distinct genome once per evaluator/epoch. Subsequent episode messages carry only
  // compact controller keys + seeds, avoiding repeated structured-clone of full NEAT genomes.
  for (const slot of evaluatorPool) {
    slot.worker.postMessage({
      type: 'LOAD_EPOCH',
      payload: {
        epoch: evaluationEpoch,
        controllers: parallelControllerBank,
        upgrades,
        fitnessConfig: trainingFitnessConfig,
      },
    });
  }
}

function recordPopulationBalance(result: EpisodeStats) {
  generationPopulationMatches++;
  generationPopulationTags += result.tags;
  if (result.tags > 0) {
    generationPopulationTaggedEpisodes++;
    generationPopulationTagTimeMs += result.tagTimeTotalMs;
  }
  if (result.chaserFalls > 0) generationPopulationChaserFalls++;
  if (result.evaderFalls > 0) generationPopulationRunnerFalls++;
  if (result.tags === 0 && result.evaderFalls === 0) generationPopulationCleanRunnerSurvivals++;
  generationRunnerFrontierExpansionPx += result.runnerFrontierExpansionPx;
  generationRunnerLeftFrontierExpansionPx += result.runnerLeftFrontierExpansionPx;
  generationRunnerRawRightFrontierExpansionPx += result.runnerRawRightFrontierExpansionPx;
  generationRunnerRightFrontierExpansionPx += result.runnerRightFrontierExpansionPx;
  generationRunnerExplorationBonus += result.runnerExplorationFitnessBonus;
  generationRunnerPaceBonus += result.runnerPaceFitnessBonus;
  generationRunnerPaceCompletion += result.runnerPaceCompletion;
  generationRunnerPaceWindowsSatisfied += result.runnerPaceWindowsSatisfied;
  generationRunnerPaceWindowsTotal += result.runnerPaceWindowsTotal;
  generationChaserPursuitBonus += result.chaserPursuitFitnessBonus;
  generationChaserPursuitLandings += result.chaserPursuitLandings;
  generationRunnerPlatformLandings += result.runnerPlatformLandings;
  generationChaserPlatformLandings += result.chaserPlatformLandings;
  generationRunnerBranchLandings += result.runnerBranchLandings;
  generationChaserBranchLandings += result.chaserBranchLandings;
  generationCloseEncounters += result.closeEncounters;
  generationSuccessfulEvades += result.successfulEvades;
  generationMeanNearestRunnerDistance += result.meanNearestRunnerDistancePx;
  generationTimeWithin100Pct += result.timeWithin100Ms / Math.max(1, result.elapsedMs);
  generationTimeWithin200Pct += result.timeWithin200Ms / Math.max(1, result.elapsedMs);
  generationTimeWithin400Pct += result.timeWithin400Ms / Math.max(1, result.elapsedMs);
  generationTagsSoonAfterRunnerFall += result.tagsSoonAfterRunnerFall;
  generationRunnerMaxFrontierExpansionPx = Math.max(generationRunnerMaxFrontierExpansionPx, result.runnerMaxFrontierExpansionPx);
  for (let i = 0; i < ACTION_SPACE.length; i++) {
    generationActionCountsChaser[i] += result.chaserActionCounts[i] || 0;
    generationActionCountsEvader[i] += result.evaderActionCounts[i] || 0;
  }
  generationDecisionCountChaser += result.chaserDecisionCount || 0;
  generationDecisionCountEvader += result.evaderDecisionCount || 0;
  generationIdleCountChaser += result.chaserIdleCount || 0;
  generationIdleCountEvader += result.evaderIdleCount || 0;
}

function applyParallelEpisodeResult(task: ParallelEvaluationTask, result: TrainingEpisodeResult) {
  totalTags += result.tags;
  totalFalls += result.falls;
  totalChaserFalls += result.chaserFalls;
  totalRunnerFalls += result.evaderFalls;
  totalJumps += result.jumps;
  for (let i = 0; i < ACTION_SPACE.length; i++) {
    const action = ACTION_SPACE[i];
    const chaserCount = result.chaserActionCounts[i] || 0;
    const evaderCount = result.evaderActionCounts[i] || 0;
    if (chaserCount) actionCountsChaser[action] = (actionCountsChaser[action] || 0) + chaserCount;
    if (evaderCount) actionCountsEvader[action] = (actionCountsEvader[action] || 0) + evaderCount;
  }
  if (result.chaserIdleCount) actionCountsChaser.idle = (actionCountsChaser.idle || 0) + result.chaserIdleCount;
  if (result.evaderIdleCount) actionCountsEvader.idle = (actionCountsEvader.idle || 0) + result.evaderIdleCount;

  if (task.phase === 'chaser_population') {
    const chaserIndex = task.chaserIndex!;
    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
    recordPopulationBalance(result);
  } else if (task.phase === 'evader_population') {
    const evaderIndex = task.evaderIndex!;
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;
    recordPopulationBalance(result);
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

function loadEvaluatorEpoch(slot: EvaluatorSlot) {
  if (!parallelGenerationPrepared) return;
  slot.worker.postMessage({
    type: 'LOAD_EPOCH',
    payload: {
      epoch: evaluationEpoch,
      controllers: parallelControllerBank,
      upgrades: { ...activeUpgradeState() },
      fitnessConfig: trainingFitnessConfig,
    },
  });
}

function attachEvaluatorWorker(slot: EvaluatorSlot, worker: Worker) {
  slot.worker = worker;
  worker.onmessage = event => handleEvaluatorMessage(slot, event);
  worker.onerror = event => {
    // A single evaluator failure should not destroy the entire parallel backend. Recreate just
    // that slot and retry its in-flight work; fall back to serial only if recreation itself fails.
    try {
      restartEvaluatorSlot(slot, `worker error: ${event.message || 'unknown evaluator error'}`);
      if (isRunning && parallelBackendActive) dispatchParallelWork();
    } catch (error) {
      fallBackToSerialTraining(error);
    }
  };
}

function restartEvaluatorSlot(slot: EvaluatorSlot, reason: string) {
  const retryTasks: ParallelEvaluationTask[] = [];
  for (const taskId of slot.taskIds) {
    const task = activeParallelTasks.get(taskId);
    if (task && task.epoch === evaluationEpoch) retryTasks.push(task);
  }

  try { slot.worker.terminate(); } catch { /* no-op */ }
  slot.busy = false;
  slot.taskIds = [];
  slot.batchStartedAt = 0;

  if (retryTasks.length > 0) {
    // Put interrupted work at the front so a stalled batch cannot starve behind the rest of a
    // generation. Keep the task IDs unchanged so accounting remains exactly-once.
    parallelRetryTasks.unshift(...retryTasks);
    evaluatorRecoveryCount++;
    lastEvaluatorRecoveryReason = reason;
  }

  const replacement = new Worker(new URL('./episodeWorker.ts', import.meta.url), { type: 'module' });
  attachEvaluatorWorker(slot, replacement);
  loadEvaluatorEpoch(slot);
}

function recoverStalledEvaluators(timeoutMs = EVALUATOR_BATCH_TIMEOUT_MS, reasonPrefix = 'watchdog') {
  if (!parallelBackendActive || !parallelGenerationPrepared) return;
  const now = performance.now();
  let recovered = false;

  for (const slot of evaluatorPool) {
    if (!slot.busy || slot.batchStartedAt <= 0) continue;
    const stalledFor = now - slot.batchStartedAt;
    if (stalledFor < timeoutMs) continue;
    restartEvaluatorSlot(slot, `${reasonPrefix}: evaluator ${slot.index + 1} stalled for ${Math.round(stalledFor)} ms`);
    recovered = true;
  }

  if (recovered && isRunning) {
    emitTelemetry(true);
    dispatchParallelWork();
  }
}

function fallBackToSerialTraining(reason: unknown) {
  console.warn('Parallel evaluator pool unavailable; falling back to optimized single-worker training.', reason);
  for (const slot of evaluatorPool) slot.worker.terminate();
  evaluatorPool = [];
  if (evaluatorWatchdogId) {
    clearInterval(evaluatorWatchdogId);
    evaluatorWatchdogId = null;
  }
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
  if (activeParallelTasks.size > 0 || parallelRetryTasks.length > 0 || parallelTaskCursor < parallelTasks.length) return;

  finishGeneration();
  parallelGenerationPrepared = false;
  if (isRunning) {
    prepareParallelGeneration();
    dispatchParallelWork();
  }
}

function handleEvaluatorMessage(slot: EvaluatorSlot, event: MessageEvent) {
  const { type, payload } = event.data || {};

  if (type === 'ERROR') {
    slot.busy = false;
    slot.taskIds = [];
    fallBackToSerialTraining(payload?.message || 'Evaluator worker failed');
    return;
  }

  if (type === 'BATCH_RESULT') {
    // Always release the slot, including stale results from an invalidated epoch.
    slot.busy = false;
    slot.taskIds = [];
    slot.batchStartedAt = 0;
    if (payload?.epoch === evaluationEpoch && Array.isArray(payload.results)) {
      for (const item of payload.results) {
        const taskId = item?.taskId as number | undefined;
        if (taskId === undefined) continue;
        const task = activeParallelTasks.get(taskId);
        activeParallelTasks.delete(taskId);
        if (!task || task.epoch !== evaluationEpoch) continue;
        applyParallelEpisodeResult(task, item.result as TrainingEpisodeResult);
        parallelTasksCompleted++;
      }
      emitTelemetry();
    }
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
      const slot: EvaluatorSlot = { worker, busy: false, taskIds: [], batchStartedAt: 0, index: i };
      attachEvaluatorWorker(slot, worker);
      evaluatorPool.push(slot);
    }
    parallelBackendActive = evaluatorPool.length > 0;
    if (parallelBackendActive && !evaluatorWatchdogId) {
      evaluatorWatchdogId = setInterval(() => recoverStalledEvaluators(), EVALUATOR_WATCHDOG_INTERVAL_MS);
    }
  } catch (error) {
    fallBackToSerialTraining(error);
  }
}

function dispatchParallelWork() {
  if (!isRunning || !parallelBackendActive) return;
  if (!parallelGenerationPrepared) prepareParallelGeneration();

  for (const slot of evaluatorPool) {
    if (slot.busy || (parallelRetryTasks.length === 0 && parallelTaskCursor >= parallelTasks.length)) continue;

    const batch: ParallelEvaluationTask[] = [];
    while (batch.length < PARALLEL_TASK_BATCH_SIZE) {
      let task: ParallelEvaluationTask | undefined;
      if (parallelRetryTasks.length > 0) task = parallelRetryTasks.shift();
      else if (parallelTaskCursor < parallelTasks.length) task = parallelTasks[parallelTaskCursor++];
      else break;
      if (!task || task.epoch !== evaluationEpoch) continue;
      batch.push(task);
      activeParallelTasks.set(task.id, task);
    }
    if (batch.length === 0) continue;

    slot.busy = true;
    slot.taskIds = batch.map(task => task.id);
    slot.batchStartedAt = performance.now();
    slot.worker.postMessage({
      type: 'EVALUATE_BATCH',
      payload: {
        epoch: evaluationEpoch,
        tasks: batch.map(task => ({
          taskId: task.id,
          chaserKey: task.chaserKey,
          evaderKey: task.evaderKey,
          seed: task.seed,
          trackChaserActions: task.trackChaserActions,
          trackEvaderActions: task.trackEvaderActions,
          startMode: task.startMode,
        })),
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
  evaluationPhase = 'chaser_population';
  evaluationIndex = 0;
  evaluationRound = 0;
  chaserFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessTotals = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  chaserFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  evaderFitnessCounts = new Array<number>(NEAT_POPULATION_SIZE).fill(0);
  generationPopulationMatches = 0;
  generationPopulationTags = 0;
  generationPopulationTaggedEpisodes = 0;
  generationPopulationTagTimeMs = 0;
  generationPopulationChaserFalls = 0;
  generationPopulationRunnerFalls = 0;
  generationPopulationCleanRunnerSurvivals = 0;
  generationRunnerFrontierExpansionPx = 0;
  generationRunnerLeftFrontierExpansionPx = 0;
  generationRunnerRawRightFrontierExpansionPx = 0;
  generationRunnerRightFrontierExpansionPx = 0;
  generationRunnerExplorationBonus = 0;
  generationRunnerPaceBonus = 0;
  generationRunnerPaceCompletion = 0;
  generationRunnerPaceWindowsSatisfied = 0;
  generationRunnerPaceWindowsTotal = 0;
  generationChaserPursuitBonus = 0;
  generationChaserPursuitLandings = 0;
  generationRunnerPlatformLandings = 0;
  generationChaserPlatformLandings = 0;
  generationRunnerBranchLandings = 0;
  generationChaserBranchLandings = 0;
  generationCloseEncounters = 0;
  generationSuccessfulEvades = 0;
  generationMeanNearestRunnerDistance = 0;
  generationTimeWithin100Pct = 0;
  generationTimeWithin200Pct = 0;
  generationTimeWithin400Pct = 0;
  generationTagsSoonAfterRunnerFall = 0;
  generationRunnerMaxFrontierExpansionPx = 0;
  generationActionCountsChaser = new Array<number>(ACTION_SPACE.length).fill(0);
  generationActionCountsEvader = new Array<number>(ACTION_SPACE.length).fill(0);
  generationDecisionCountChaser = 0;
  generationDecisionCountEvader = 0;
  generationIdleCountChaser = 0;
  generationIdleCountEvader = 0;
}

function recordEpisodeTelemetry(result: EpisodeStats, currentPopulationMatch = true) {
  completedEpisodes++;
  totalSimulatedTime += result.elapsedMs;

  // Fixed-horizon episodes can contain multiple role swaps. Use the mean completed survival/tag
  // interval from this match rather than the full episode duration, which is now always constant.
  if (result.tags > 0) {
    recentSurvivalTimes.push(result.taggedSurvivalTimeTotalMs / result.tags);
    recentTimesToTag.push(result.tagTimeTotalMs / result.tags);
    if (recentSurvivalTimes.length > SURVIVAL_TIME_HISTORY_LENGTH) recentSurvivalTimes.shift();
    if (recentTimesToTag.length > TIME_TO_TAG_HISTORY_LENGTH) recentTimesToTag.shift();
  }

  if (currentPopulationMatch) {
    // Elo is a tag-contest diagnostic only. Personal falls are deliberately excluded because they
    // no longer grant the opponent fitness. A match with at least one tag is a chaser win; a
    // tag-free fixed-horizon match is a runner win. Exploration remains outside Elo as well.
    const chaserScore: 0 | 0.5 | 1 = result.tags > 0 ? 1 : 0;
    totalEvaluationMatches++;
    if (chaserScore === 1) totalChaserEpisodeWins++;
    else if (chaserScore === 0) totalEvaderEpisodeWins++;
    else totalEpisodeDraws++;
    const eloResult = updateEloRatings(chaserElo, evaderElo, chaserScore);
    chaserElo = eloResult.newChaserElo;
    evaderElo = eloResult.newEvaderElo;
  }
}

function evaluateNextMatch(): boolean {
  const n = chaserPopulation.genomes.length;
  const generation = chaserPopulation.generation;
  const panels = commonOpponentPanels(generation);

  if (evaluationPhase === 'chaser_population') {
    const chaserIndex = evaluationIndex;
    const evaderIndex = panels.evaderIndices[evaluationRound];
    const environmentSeed = (generation * 100003 + evaluationRound * 7919 + 17) >>> 0;
    const result = runEpisode(
      chaserControllers[chaserIndex],
      evaderControllers[evaderIndex],
      environmentSeed,
      { chaser: true, evader: false },
      populationStartMode(evaluationRound)
    );
    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
    recordPopulationBalance(result);
    recordEpisodeTelemetry(result);

    evaluationIndex++;
    if (evaluationIndex >= n) {
      evaluationIndex = 0;
      evaluationRound++;
    }
    if (evaluationRound < panels.evaderIndices.length) return false;
    evaluationRound = 0;
    evaluationIndex = 0;
    evaluationPhase = 'evader_population';
    return false;
  }

  if (evaluationPhase === 'evader_population') {
    const evaderIndex = evaluationIndex;
    const chaserIndex = panels.chaserIndices[evaluationRound];
    const environmentSeed = (generation * 100003 + evaluationRound * 7919 + 53) >>> 0;
    const result = runEpisode(
      chaserControllers[chaserIndex],
      evaderControllers[evaderIndex],
      environmentSeed,
      { chaser: false, evader: true },
      populationStartMode(evaluationRound)
    );
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;
    recordPopulationBalance(result);
    recordEpisodeTelemetry(result);

    evaluationIndex++;
    if (evaluationIndex >= n) {
      evaluationIndex = 0;
      evaluationRound++;
    }
    if (evaluationRound < panels.chaserIndices.length) return false;
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
    const opponent = selectHallOpponent(evaderHallOfFame, evaluationRound, generation, 11);
    if (opponent) {
      const environmentSeed = (generation * 200003 + evaluationRound * 12011 + 101) >>> 0;
      const result = runEpisode(
        chaserControllers[evaluationIndex],
        opponent.controller,
        environmentSeed,
        { chaser: true, evader: false },
        'midgame'
      );
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

  const opponent = selectHallOpponent(chaserHallOfFame, evaluationRound, generation, 23);
  if (opponent) {
    const environmentSeed = (generation * 300007 + evaluationRound * 16001 + 211) >>> 0;
    const result = runEpisode(
      opponent.controller,
      evaderControllers[evaluationIndex],
      environmentSeed,
      { chaser: false, evader: true },
      'midgame'
    );
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
    // Tag rate = episodes with at least one physical contact tag. Runner survival requires both
    // no contact tag and no runner fall, so a fall can no longer be mislabeled as survival.
    tagRate: generationPopulationTaggedEpisodes / Math.max(1, generationPopulationMatches),
    survivalRate: generationPopulationCleanRunnerSurvivals / Math.max(1, generationPopulationMatches),
    avgTagTimeMs: generationPopulationTags > 0 ? generationPopulationTagTimeMs / generationPopulationTags : null,
    // These counts/rates mean matches containing at least one fall by the corresponding role.
    chaserFalls: generationPopulationChaserFalls,
    runnerFalls: generationPopulationRunnerFalls,
    chaserFallRate: generationPopulationChaserFalls / Math.max(1, generationPopulationMatches),
    runnerFallRate: generationPopulationRunnerFalls / Math.max(1, generationPopulationMatches),
    runnerFrontierExpansionPxPerEpisode: generationRunnerFrontierExpansionPx / Math.max(1, generationPopulationMatches),
    runnerFrontierExpansionViewportsPerEpisode: generationRunnerFrontierExpansionPx / Math.max(1, generationPopulationMatches * viewportSize.width),
    runnerLeftFrontierExpansionViewportsPerEpisode: generationRunnerLeftFrontierExpansionPx / Math.max(1, generationPopulationMatches * viewportSize.width),
    runnerRawRightFrontierExpansionViewportsPerEpisode: generationRunnerRawRightFrontierExpansionPx / Math.max(1, generationPopulationMatches * viewportSize.width),
    runnerRightFrontierExpansionViewportsPerEpisode: generationRunnerRightFrontierExpansionPx / Math.max(1, generationPopulationMatches * viewportSize.width),
    runnerExplorationBonusPerEpisode: generationRunnerExplorationBonus / Math.max(1, generationPopulationMatches),
    runnerPaceCompletion: generationRunnerPaceCompletion / Math.max(1, generationPopulationMatches),
    runnerPaceWindowsSatisfiedPerEpisode: generationRunnerPaceWindowsSatisfied / Math.max(1, generationPopulationMatches),
    runnerPaceBonusPerEpisode: generationRunnerPaceBonus / Math.max(1, generationPopulationMatches),
    chaserPursuitBonusPerEpisode: generationChaserPursuitBonus / Math.max(1, generationPopulationMatches),
    chaserPursuitLandingsPerEpisode: generationChaserPursuitLandings / Math.max(1, generationPopulationMatches),
    runnerPlatformLandingsPerEpisode: generationRunnerPlatformLandings / Math.max(1, generationPopulationMatches),
    chaserPlatformLandingsPerEpisode: generationChaserPlatformLandings / Math.max(1, generationPopulationMatches),
    runnerBranchLandingsPerEpisode: generationRunnerBranchLandings / Math.max(1, generationPopulationMatches),
    chaserBranchLandingsPerEpisode: generationChaserBranchLandings / Math.max(1, generationPopulationMatches),
    closeEncountersPerEpisode: generationCloseEncounters / Math.max(1, generationPopulationMatches),
    successfulEvadesPerEpisode: generationSuccessfulEvades / Math.max(1, generationPopulationMatches),
    meanNearestRunnerDistancePx: generationMeanNearestRunnerDistance / Math.max(1, generationPopulationMatches),
    timeWithin100Pct: generationTimeWithin100Pct / Math.max(1, generationPopulationMatches),
    timeWithin200Pct: generationTimeWithin200Pct / Math.max(1, generationPopulationMatches),
    timeWithin400Pct: generationTimeWithin400Pct / Math.max(1, generationPopulationMatches),
    tagsSoonAfterRunnerFallPerEpisode: generationTagsSoonAfterRunnerFall / Math.max(1, generationPopulationMatches),
    runnerMaxFrontierExpansionPx: generationRunnerMaxFrontierExpansionPx,
  };

  chaserPopulation.genomes.forEach((g, i) => {
    g.fitness = chaserFitnessTotals[i] / Math.max(1, chaserFitnessCounts[i]);
  });
  evaderPopulation.genomes.forEach((g, i) => {
    g.fitness = evaderFitnessTotals[i] / Math.max(1, evaderFitnessCounts[i]);
  });

  // Main fitness uses common opponent panels. Before accepting a champion, re-test only the
  // strongest few against held-out current opponents and historical strategies.
  promoteValidatedChampion('chaser', evaluatedGeneration);
  promoteValidatedChampion('evader', evaluatedGeneration);

  // Freeze the benchmark bank before evolution changes the population. Benchmark matches are
  // telemetry/archive descriptors only: they never alter fitness or selection.
  ensureBenchmarkSuite();
  const chaserResult = chaserPopulation.evolve();
  const evaderResult = evaderPopulation.evolve();
  lastChaserMetrics = chaserResult.metrics;
  lastEvaderMetrics = evaderResult.metrics;
  const benchmark = runCrossGenerationBenchmark(evaluatedGeneration, chaserResult.champion, evaderResult.champion);
  archiveChampion(chaserHallOfFame, chaserResult.champion, 'chaser', benchmark.chaser);
  archiveChampion(evaderHallOfFame, evaderResult.champion, 'evader', benchmark.evader);
  championChaser = new LearningAgent('chaser', chaserResult.champion);
  championEvader = new LearningAgent('evader', evaderResult.champion);
  championChaser.setGeneration(chaserResult.metrics.generation);
  championEvader.setGeneration(evaderResult.metrics.generation);

  recordGenerationAnalysis(evaluatedGeneration);
  resetEvaluationAccumulators();
  refreshControllers();
  captureSafeCheckpoint();
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
  const perRolePopulationEpisodes = n * NEAT_OPPONENTS_PER_GENOME;
  const populationEpisodes = perRolePopulationEpisodes * 2;
  const chaserHofEpisodes = hasEvaderHof ? n * NEAT_HOF_OPPONENTS_PER_GENOME : 0;
  const evaderHofEpisodes = hasChaserHof ? n * NEAT_HOF_OPPONENTS_PER_GENOME : 0;
  const total = populationEpisodes + chaserHofEpisodes + evaderHofEpisodes;

  let completed = 0;
  if (evaluationPhase === 'chaser_population') {
    completed = evaluationRound * n + evaluationIndex;
  } else if (evaluationPhase === 'evader_population') {
    completed = perRolePopulationEpisodes + evaluationRound * n + evaluationIndex;
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

function buildAnalysisExport() {
  const modes: TrainingStartMode[] = ['visual', 'varied', 'midgame'];
  const probeSeeds = [0x31415926, 0x27182818, 0x9e3779b9];
  const upgrades = activeUpgradeState();
  const probes = modes.map((startMode, index) => {
    const result = runTrainingEpisode(championChaser, championEvader, probeSeeds[index] >>> 0, {
      trackChaserActions: true,
      trackEvaderActions: true,
      viewportSize,
      upgrades,
      startMode,
      runnerPaceTargetPxPerWindow: trainingFitnessConfig.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: trainingFitnessConfig.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: trainingFitnessConfig.chaserPursuitRewardPerPlatform,
      recordTrace: true,
      traceIntervalMs: 250,
    });
    return {
      id: `champion_${startMode}`,
      startMode,
      seed: probeSeeds[index] >>> 0,
      summary: {
        chaserFitness: result.chaserFitness,
        runnerFitness: result.evaderFitness,
        tags: result.tags,
        chaserFalls: result.chaserFalls,
        runnerFalls: result.evaderFalls,
        runnerFrontierExpansionPx: result.runnerFrontierExpansionPx,
        runnerFrontierExpansionViewports: result.runnerFrontierExpansionViewports,
        runnerLeftFrontierExpansionPx: result.runnerLeftFrontierExpansionPx,
        runnerRawRightFrontierExpansionPx: result.runnerRawRightFrontierExpansionPx,
        runnerRightFrontierExpansionPx: result.runnerRightFrontierExpansionPx,
        runnerMaxSafeRightProgressPx: result.runnerMaxFrontierExpansionPx,
        runnerExplorationFitnessBonus: result.runnerExplorationFitnessBonus,
        runnerPaceFitnessBonus: result.runnerPaceFitnessBonus,
        runnerPaceCompletion: result.runnerPaceCompletion,
        runnerPaceWindowsSatisfied: result.runnerPaceWindowsSatisfied,
        runnerPaceWindowsTotal: result.runnerPaceWindowsTotal,
        chaserPursuitFitnessBonus: result.chaserPursuitFitnessBonus,
        chaserPursuitLandings: result.chaserPursuitLandings,
        runnerPlatformLandings: result.runnerPlatformLandings,
        chaserPlatformLandings: result.chaserPlatformLandings,
        runnerBranchLandings: result.runnerBranchLandings,
        chaserBranchLandings: result.chaserBranchLandings,
        closeEncounters: result.closeEncounters,
        successfulEvades: result.successfulEvades,
        meanNearestRunnerDistancePx: result.meanNearestRunnerDistancePx,
        timeWithin100Ms: result.timeWithin100Ms,
        timeWithin200Ms: result.timeWithin200Ms,
        timeWithin400Ms: result.timeWithin400Ms,
        tagsSoonAfterRunnerFall: result.tagsSoonAfterRunnerFall,
        chaserActionCounts: result.chaserActionCounts,
        runnerActionCounts: result.evaderActionCounts,
        chaserDecisionCount: result.chaserDecisionCount,
        runnerDecisionCount: result.evaderDecisionCount,
        chaserIdleCount: result.chaserIdleCount,
        runnerIdleCount: result.evaderIdleCount,
      },
      trace: result.trace || [],
    };
  });

  return {
    format: 'neat-tag-training-analysis',
    version: 3,
    generatedAt: Date.now(),
    generation: Math.max(lastChaserMetrics?.generation || 0, lastEvaderMetrics?.generation || 0),
    stateVectorSize: STATE_VECTOR_SIZE,
    actionSpace: [...ACTION_SPACE],
    actionSchema: 'factorized-controls-v1',
    gameplayObjectiveVersion: 'pace-pursuit-branches-v1',
    networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture),
    viewportSize: { ...viewportSize },
    fitness: {
      chaser: '100 + 20 * (tags - chaserFalls) + capped runner-visited-platform pursuit shaping',
      runner: '100 + 20 * (-tags - runnerFalls) + capped 2-second pace-window reward',
      config: { ...trainingFitnessConfig },
      paceDefinition: 'Every 2 seconds, SAFE rightward progress across both Runner slots is averaged and converted to a 0..1 completion fraction. Reward saturates at the configured target; extra speed earns nothing.',
      pursuitDefinition: 'The Chaser earns a small capped reward only for first safe landings on platforms a Runner has already occupied. Tags remain the dominant Chaser reward.',
    },
    upgrades: sanitizeUpgradeConfig(upgradeConfig),
    benchmarkSuiteRevision,
    trainingHealth: {
      backend: parallelBackendActive ? 'CPU parallel' : 'CPU optimized',
      workerCount: parallelBackendActive ? evaluatorPool.length : 1,
      evaluatorRecoveryCount,
      lastEvaluatorRecoveryReason,
    },
    history: JSON.parse(JSON.stringify(analysisHistory)) as TrainingGenerationAnalysisRecord[],
    current: {
      chaserMetrics: lastChaserMetrics ? { ...lastChaserMetrics } : null,
      runnerMetrics: lastEvaderMetrics ? { ...lastEvaderMetrics } : null,
      balance: lastGenerationBalance ? { ...lastGenerationBalance } : null,
      benchmark: lastCrossGenerationBenchmark
        ? JSON.parse(JSON.stringify(lastCrossGenerationBenchmark)) as CrossGenerationBenchmarkTelemetry
        : null,
      hallOfFame: currentHallOfFameTelemetry(),
      chaserElo,
      runnerElo: evaderElo,
      totalTags,
      totalChaserFalls,
      totalRunnerFalls,
      totalSimulatedTimeMs: totalSimulatedTime,
      completedEpisodes,
    },
    probes,
  };
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
    totalEvaluationMatches,
    totalChaserEpisodeWins,
    totalEvaderEpisodeWins,
    totalEpisodeDraws,
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
      trainingRecoveryCount: evaluatorRecoveryCount,
      trainingLastRecoveryReason: lastEvaluatorRecoveryReason,
      upgradeConfig,
      sprintUpgradeActive: activeUpgradeState().sprint,
      controlledJumpUpgradeActive: activeUpgradeState().controlledJump,
      gameTime: totalSimulatedTime,
      chaserElo,
      evaderElo,
      avgSurvivalTime: average(recentSurvivalTimes),
      avgTimeToTag: average(recentTimesToTag),
      totalTags,
      totalFalls,
      totalChaserFalls,
      totalRunnerFalls,
      totalJumps,
      lastChaserNeatMetrics: lastChaserMetrics,
      lastEvaderNeatMetrics: lastEvaderMetrics,
      chaserChampionGenome: championChaser.getWeights(),
      evaderChampionGenome: championEvader.getWeights(),
      actionCountsChaser,
      actionCountsEvader,
      eloLeaderboard: leaderboard,
      lastGenerationBalance,
      hallOfFame: currentHallOfFameTelemetry(),
      trainingFitnessConfig: { ...trainingFitnessConfig },
      networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture),
      lastCrossGenerationBenchmark,
      benchmarkSuiteRevision,
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
  analysisHistory.length = 0;
  lastGenerationBalance = null;
  if (chaserWeights?.nodes && chaserWeights?.connections) {
    chaserPopulation.seedFromChampion(chaserWeights as NeatGenomeData);
    championChaser.setWeights(chaserWeights);
  }
  if (evaderWeights?.nodes && evaderWeights?.connections) {
    evaderPopulation.seedFromChampion(evaderWeights as NeatGenomeData);
    championEvader.setWeights(evaderWeights);
  }
  refreshControllers();
  resetBenchmarkSuite();
  if (archiveSeed && chaserWeights?.nodes && chaserWeights?.connections) {
    archiveChampion(chaserHallOfFame, chaserWeights as NeatGenomeData, 'chaser');
  }
  if (archiveSeed && evaderWeights?.nodes && evaderWeights?.connections) {
    archiveChampion(evaderHallOfFame, evaderWeights as NeatGenomeData, 'evader');
  }
  resetEvaluationAccumulators();
  invalidateParallelGeneration();
  captureSafeCheckpoint();
}

function resetEntireEvolutionRun(): void {
  chaserPopulation = createFreshPopulation('chaser');
  evaderPopulation = createFreshPopulation('evader');
  refreshControllers();
  championChaser = new LearningAgent('chaser', chaserPopulation.genomes[0]);
  championEvader = new LearningAgent('evader', evaderPopulation.genomes[0]);
  lastChaserMetrics = null;
  lastEvaderMetrics = null;
  seededFromStart = true;
  totalTags = 0;
  totalFalls = 0;
  totalChaserFalls = 0;
  totalRunnerFalls = 0;
  totalJumps = 0;
  totalEvaluationMatches = 0;
  totalChaserEpisodeWins = 0;
  totalEvaderEpisodeWins = 0;
  totalEpisodeDraws = 0;
  totalSimulatedTime = 0;
  completedEpisodes = 0;
  evaluatorRecoveryCount = 0;
  lastEvaluatorRecoveryReason = '';
  chaserElo = INITIAL_ELO;
  evaderElo = INITIAL_ELO;
  recentSurvivalTimes.length = 0;
  recentTimesToTag.length = 0;
  Object.keys(actionCountsChaser).forEach(k => delete actionCountsChaser[k]);
  Object.keys(actionCountsEvader).forEach(k => delete actionCountsEvader[k]);
  clearHallOfFame();
  analysisHistory.length = 0;
  lastGenerationBalance = null;
  resetBenchmarkSuite();
  resetEvaluationAccumulators();
  invalidateParallelGeneration();
  resetTrainingThroughput();
  captureSafeCheckpoint();
  emitTelemetry(true);
  if (isRunning) startTrainingEngine();
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START': {
      if (!seededFromStart) {
        if (payload?.networkArchitecture) networkArchitecture = sanitizeNetworkArchitectureSuite(payload.networkArchitecture);
        chaserPopulation = createFreshPopulation('chaser');
        evaderPopulation = createFreshPopulation('evader');
        refreshControllers();
        championChaser = new LearningAgent('chaser', chaserPopulation.genomes[0]);
        championEvader = new LearningAgent('evader', evaderPopulation.genomes[0]);
        resetBenchmarkSuite();
        resetEvaluationAccumulators();
        invalidateParallelGeneration();
        seededFromStart = true;
      }
      if (typeof payload?.chaserElo === 'number') chaserElo = payload.chaserElo;
      if (typeof payload?.evaderElo === 'number') evaderElo = payload.evaderElo;
      if (payload?.upgradeConfig) {
        upgradeConfig = sanitizeUpgradeConfig(payload.upgradeConfig);
      }
      if (payload?.trainingFitnessConfig) {
        trainingFitnessConfig = sanitizeTrainingFitnessConfig(payload.trainingFitnessConfig);
      }
      ensureBenchmarkSuite();
      // START may supply restored Elo/config after population seeding. Refresh the boundary snapshot
      // so persistence reflects those values as well; current population genetics remain a safe boundary.
      captureSafeCheckpoint();
      isRunning = true;
      if (timerId) clearTimeout(timerId);
      resetTrainingThroughput();
      startTrainingEngine();
      break;
    }

    case 'SET_NETWORK_ARCHITECTURE': {
      networkArchitecture = sanitizeNetworkArchitectureSuite(payload?.networkArchitecture);
      resetEntireEvolutionRun();
      self.postMessage({
        type: 'NETWORK_ARCHITECTURE_APPLIED',
        payload: { networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture) },
      });
      break;
    }

    case 'SET_UPGRADE_CONFIG': {
      const before = activeUpgradeState();
      upgradeConfig = sanitizeUpgradeConfig(payload?.upgradeConfig);
          const after = activeUpgradeState();
      const physicsChanged = before.sprint !== after.sprint || before.controlledJump !== after.controlledJump ||
        before.sprintChaser !== after.sprintChaser || before.sprintRunner !== after.sprintRunner ||
        before.controlledJumpChaser !== after.controlledJumpChaser || before.controlledJumpRunner !== after.controlledJumpRunner ||
        before.sprintChaserMaxSpeed !== after.sprintChaserMaxSpeed || before.sprintRunnerMaxSpeed !== after.sprintRunnerMaxSpeed ||
        before.sprintChaserStaminaCostPerSec !== after.sprintChaserStaminaCostPerSec || before.sprintRunnerStaminaCostPerSec !== after.sprintRunnerStaminaCostPerSec;
      // Only discard a partial generation when the effective physics capability changed.
      if (physicsChanged) {
        resetEvaluationAccumulators();
        invalidateParallelGeneration();
        benchmarkSuiteRevision++;
        lastCrossGenerationBenchmark = null;
        captureSafeCheckpoint();
      }
      emitTelemetry(true);
      if (isRunning && physicsChanged) startTrainingEngine();
      break;
    }

    case 'SET_TRAINING_FITNESS_CONFIG': {
      const next = sanitizeTrainingFitnessConfig(payload?.trainingFitnessConfig);
      const changed =
        next.runnerPaceTargetPxPerWindow !== trainingFitnessConfig.runnerPaceTargetPxPerWindow ||
        next.runnerPaceRewardPerWindow !== trainingFitnessConfig.runnerPaceRewardPerWindow ||
        next.chaserPursuitRewardPerPlatform !== trainingFitnessConfig.chaserPursuitRewardPerPlatform;
      trainingFitnessConfig = next;
      if (changed) {
        // Do not mix two reward scales inside one generation or benchmark revision.
        resetEvaluationAccumulators();
        invalidateParallelGeneration();
        benchmarkSuiteRevision++;
        lastCrossGenerationBenchmark = null;
        refreshHallOfFameBenchmarkMetadata();
        captureSafeCheckpoint();
      }
      emitTelemetry(true);
      if (isRunning && changed) startTrainingEngine();
      break;
    }

    case 'ANALYSIS_EXPORT_REQUEST': {
      try {
        self.postMessage({
          type: 'ANALYSIS_EXPORT_RESPONSE',
          payload: { requestId: payload?.requestId ?? null, analysis: buildAnalysisExport() },
        });
      } catch (error) {
        self.postMessage({
          type: 'ANALYSIS_EXPORT_RESPONSE',
          payload: { requestId: payload?.requestId ?? null, error: error instanceof Error ? error.message : String(error) },
        });
      }
      break;
    }

    case 'WAKE_TRAINING': {
      // Browsers can suspend background/hidden worker execution. When the UI becomes active again,
      // nudge the engine and aggressively recycle evaluator batches that have been outstanding long
      // enough to be suspicious. This preserves the current generation and retries only in-flight work.
      if (isRunning) {
        if (parallelBackendActive) {
          recoverStalledEvaluators(EVALUATOR_WAKE_TIMEOUT_MS, 'UI wake');
          if (!parallelGenerationPrepared) prepareParallelGeneration();
          dispatchParallelWork();
        } else {
          if (timerId) clearTimeout(timerId);
          timerId = setTimeout(runHeadlessBatch, 0);
        }
      }
      emitTelemetry(true);
      self.postMessage({ type: 'WAKE_TRAINING_ACK', payload: { recoveryCount: evaluatorRecoveryCount } });
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
      captureSafeCheckpoint();
      if (isRunning) startTrainingEngine();
      break;

    case 'CHECKPOINT_REQUEST': {
      const checkpoint = latestSafeCheckpoint || buildEvolutionCheckpoint();
      self.postMessage({
        type: 'CHECKPOINT_RESPONSE',
        payload: {
          requestId: payload?.requestId ?? null,
          checkpoint,
        },
      });
      break;
    }

    case 'RESTORE_CHECKPOINT': {
      try {
        const wasRunning = isRunning;
        if (timerId) clearTimeout(timerId);
        // In-flight evaluator results are invalidated by restoreEvolutionCheckpoint().
        restoreEvolutionCheckpoint(payload?.checkpoint as EvolutionCheckpoint);
        emitTelemetry(true);
        self.postMessage({
          type: 'RESTORE_CHECKPOINT_RESPONSE',
          payload: { requestId: payload?.requestId ?? null, ok: true, generation: chaserPopulation.generation },
        });
        if (wasRunning) startTrainingEngine();
      } catch (error) {
        self.postMessage({
          type: 'RESTORE_CHECKPOINT_RESPONSE',
          payload: {
            requestId: payload?.requestId ?? null,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      break;
    }

    case 'RESET':
      resetEntireEvolutionRun();
      break;
  }
};
