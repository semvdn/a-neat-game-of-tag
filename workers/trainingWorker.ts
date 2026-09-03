import { LearningAgent, type AgentWeights, type AgentControls } from '../learning/agent';
import { getPhysiology, stepLocomotion } from '../learning/movement';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, cloneGenome, type NeatGenerationMetrics, type NeatGenomeData } from '../learning/neat';
import { getAgentStateVector } from '../learning/state';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import type { AgentState, BalanceTelemetry, CurriculumTelemetry, GameState, ContinuousTrainingTelemetry } from '../types';
import { AgentStatus } from '../types';
import { advanceCurriculum, createCurriculumState, curriculumSnapshot } from '../level/curriculum';
import { countCourseFeatures, generateCourse } from '../level/generator';
import { isPlatformSolid, triggerCrumblingPlatform, updateDynamicPlatforms } from '../level/dynamics';
import { mulberry32 } from '../level/random';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  AGENT_COLORS,
  GRAVITY,
  FALL_BOUNDARY,
  INITIAL_ELO,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  NEAT_POPULATION_SIZE,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_RECENT_SLOTS,
  NEAT_SURVIVAL_SCORE_WINDOW_MS,
  NEAT_TAG_POINT_WEIGHT,
  NEAT_FALL_POINT_WEIGHT,
  NEAT_TRAINING_COURSE_LENGTH,
  NEAT_COMPATIBILITY_THRESHOLD,
  NEAT_TARGET_SPECIES,
  NEAT_CROSSOVER_RATE,
  NEAT_WEIGHT_MUTATION_RATE,
  NEAT_ADD_NODE_RATE,
  NEAT_ADD_CONNECTION_RATE,
  CONTINUOUS_TRAINING_DEFAULT_ARENAS,
  CONTINUOUS_TRAINING_MIN_ARENAS,
  CONTINUOUS_TRAINING_MAX_ARENAS,
  CONTINUOUS_ASSIGNMENT_MIN_MS,
  CONTINUOUS_ASSIGNMENT_MAX_MS,
  CONTINUOUS_LONG_ASSIGNMENT_CHANCE,
  CONTINUOUS_LONG_ASSIGNMENT_MIN_MS,
  CONTINUOUS_LONG_ASSIGNMENT_MAX_MS,
  CONTINUOUS_EXPOSURE_TARGET_MS,
  CONTINUOUS_MIN_ASSIGNMENTS,
  CONTINUOUS_MIN_ARENAS_PER_GENOME,
  CONTINUOUS_MIN_OPPONENTS_PER_GENOME,
  CONTINUOUS_HOF_MATCHUP_CHANCE,
  CONTINUOUS_ARENA_MIN_LIFETIME_MS,
  CONTINUOUS_ARENA_MAX_LIFETIME_MS,
  CONTINUOUS_ARENA_MAX_BOUT_RESETS,
  TAG_COOLDOWN,
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
let arenaCount = CONTINUOUS_TRAINING_DEFAULT_ARENAS;
let timerId: ReturnType<typeof setTimeout> | null = null;
let viewportSize = { width: 1200, height: 800 };
let seededFromStart = false;
let arenaSeedCounter = 1;
let schedulerCursor = 0;

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
const chaserHallOfFame: HallOfFameArchive = { recent: [], reservoir: [], historicalSeen: 0 };
const evaderHallOfFame: HallOfFameArchive = { recent: [], reservoir: [], historicalSeen: 0 };

interface ExposureState {
  activeMs: number;
  fitnessWeightedSum: number;
  fitnessWeightMs: number;
  assignments: number;
  arenas: Set<number>;
  opponents: Set<string>;
}
let chaserExposure: ExposureState[] = [];
let evaderExposure: ExposureState[] = [];

interface AssignmentAccumulator {
  elapsedMs: number;
  tags: number;
  chaserFalls: number;
  evaderFalls: number;
  doubleFalls: number;
  jumps: number;
  continuousSurvivalScore: number;
  platformTransitions: number;
  cumulativeClosestDistance: number;
  distanceSamples: number;
  tagTimeMs: number;
  tagTimeCount: number;
  survivalStreakMs: number;
  survivalStreakCount: number;
}

interface ControllerSlot {
  source: 'current' | 'hof';
  role: 'chaser' | 'evader';
  index: number | null;
  key: string;
  controller: LearningAgent;
}

interface ArenaAssignment {
  chaser: ControllerSlot;
  evader: ControllerSlot;
  targetDurationMs: number;
  stats: AssignmentAccumulator;
}

interface TrainingArena {
  id: number;
  gameState: GameState;
  flowDirection: 1 | -1;
  rng: () => number;
  assignment: ArenaAssignment;
  worldAgeMs: number;
  worldLifetimeMs: number;
  boutResets: number;
  courseSeed: number;
}

let arenas: TrainingArena[] = [];

let generationAssignments = 0;
let generationSimulatedMs = 0;
let generationTags = 0;
let generationAssignmentsWithTag = 0;
let generationAssignmentsWithFall = 0;
let generationTagTimeMs = 0;
let generationTagTimeCount = 0;
let generationSurvivalStreakMs = 0;
let generationSurvivalStreakCount = 0;
let generationChaserFalls = 0;
let generationEvaderFalls = 0;
let generationDoubleFalls = 0;
let generationChaserWins = 0;
let generationEvaderWins = 0;
let generationDraws = 0;
let generationNavigationScoreTotal = 0;
let generationCurrentCurrentAssignments = 0;
let generationHofAssignments = 0;
let lastGenerationBalance: BalanceTelemetry | null = null;
let curriculumState = createCurriculumState();
let lastCurriculumTelemetry: CurriculumTelemetry = curriculumSnapshot(curriculumState);
let lastContinuousTrainingTelemetry: ContinuousTrainingTelemetry | null = null;
let lastCourseSeed = 0;
let lastCourseBranchCount = 0;
let lastCourseMovingPlatforms = 0;
let lastCourseCrumblingPlatforms = 0;

let totalTags = 0;
let totalFalls = 0;
let totalChaserFallTerminations = 0;
let totalEvaderFallTerminations = 0;
let totalDoubleFallTerminations = 0;
let totalTimeouts = 0;
let totalMatches = 0;
let totalChaserMatchWins = 0;
let totalEvaderMatchWins = 0;
let totalMatchDraws = 0;
let totalJumps = 0;
let totalSimulatedTime = 0;
let chaserElo = INITIAL_ELO;
let evaderElo = INITIAL_ELO;
const recentSurvivalTimes: number[] = [];
const recentTimesToTag: number[] = [];
const actionCountsChaser: Record<string, number> = {};
const actionCountsEvader: Record<string, number> = {};

function emptyExposure(): ExposureState {
  return { activeMs: 0, fitnessWeightedSum: 0, fitnessWeightMs: 0, assignments: 0, arenas: new Set(), opponents: new Set() };
}
function resetExposure() {
  chaserExposure = Array.from({ length: NEAT_POPULATION_SIZE }, emptyExposure);
  evaderExposure = Array.from({ length: NEAT_POPULATION_SIZE }, emptyExposure);
}
resetExposure();

function emptyAssignmentStats(): AssignmentAccumulator {
  return {
    elapsedMs: 0,
    tags: 0,
    chaserFalls: 0,
    evaderFalls: 0,
    doubleFalls: 0,
    jumps: 0,
    continuousSurvivalScore: 0,
    platformTransitions: 0,
    cumulativeClosestDistance: 0,
    distanceSamples: 0,
    tagTimeMs: 0,
    tagTimeCount: 0,
    survivalStreakMs: 0,
    survivalStreakCount: 0,
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

function nextCourseSeed(arenaId: number): number {
  return (((arenaSeedCounter++ * 2654435761) ^ (arenaId * 2246822519) ^ (chaserPopulation.generation * 3266489917)) >>> 0);
}

function createWorld(seed: number): { gameState: GameState; flowDirection: 1 | -1 } {
  const course = generateCourse({ seed, difficulty: curriculumState.difficulty, viewport: viewportSize, length: NEAT_TRAINING_COURSE_LENGTH });
  const features = countCourseFeatures(course.platforms);
  lastCourseSeed = seed >>> 0;
  lastCourseBranchCount = course.graph.branchCount;
  lastCourseMovingPlatforms = features.moving;
  lastCourseCrumblingPlatforms = features.crumbling;
  return {
    flowDirection: course.flowDirection,
    gameState: {
      agents: [makeAgent(1, course.startXs[0], 'chaser'), makeAgent(2, course.startXs[1], 'evader'), makeAgent(3, course.startXs[2], 'evader')],
      platforms: course.platforms,
      cameraPosition: { x: 0, y: 0 },
      gameTime: 0,
      tagEffects: [],
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
      courseGraph: course.graph,
    },
  };
}

function cloneResettablePlatforms(platforms: GameState['platforms']): GameState['platforms'] {
  return platforms.map(platform => ({
    ...platform,
    position: { ...(platform.basePosition ?? platform.position) },
    active: true,
    crumblePhase: platform.kind === 'crumbling' ? 'stable' : platform.crumblePhase,
    crumble: platform.crumble ? { ...platform.crumble, triggeredAt: undefined } : undefined,
  }));
}

function resetBoutAtRandomSection(arena: TrainingArena, preserveEnergy = true) {
  const { gameState, flowDirection, rng } = arena;
  const currentIt = gameState.agents.find(agent => agent.status === AgentStatus.It) ?? gameState.agents[0];
  const currentItId = currentIt.id;
  gameState.platforms = cloneResettablePlatforms(gameState.platforms);
  gameState.platforms = updateDynamicPlatforms(gameState.platforms, gameState.gameTime).platforms;
  const backbone = gameState.platforms.filter(platform =>
    (platform.routeRole === 'start' || platform.routeRole === 'backbone') && isPlatformSolid(platform)
  );
  if (backbone.length < 2) return;

  const maxAnchor = Math.max(0, Math.min(backbone.length - 2, Math.floor((backbone.length - 2) * 0.72)));
  const anchorIndex = Math.floor(rng() * (maxAnchor + 1));
  const chaserPlatform = backbone[anchorIndex];
  const evaderPlatform = backbone[Math.min(backbone.length - 1, anchorIndex + 1)];
  const evaders = gameState.agents.filter(agent => agent.id !== currentItId);

  const place = (agent: AgentState, platform: GameState['platforms'][number], ratio: number, role: 'chaser' | 'evader') => {
    const physiology = getPhysiology(role);
    const oldEnergy = agent.energy;
    const usable = Math.max(AGENT_WIDTH + 8, platform.width - AGENT_WIDTH);
    const x = platform.position.x + Math.max(4, Math.min(usable - 4, usable * ratio));
    const y = platform.position.y - AGENT_HEIGHT;
    agent.position = { x, y };
    agent.velocity = { x: 0, y: 0 };
    agent.acceleration = { x: 0, y: 0 };
    agent.isOnGround = true;
    agent.lastPlatformId = platform.id;
    agent.maxEnergy = physiology.energyCapacity;
    agent.energy = preserveEnergy ? Math.max(0, Math.min(agent.maxEnergy, oldEnergy)) : agent.maxEnergy;
    agent.energyAtLastTakeoff = agent.energy;
    agent.positionAtLastTakeoff = { x, y };
    agent.survivalTime = 0;
    agent.timeSinceBecameIt = 0;
    agent.touchingCameraFrame = false;
    agent.cameraFrameContact = null;
    agent.role = role;
    agent.modelId = role === 'chaser' ? 'current_chaser' : 'current_evader';
    agent.elo = role === 'chaser' ? chaserElo : evaderElo;
  };

  place(currentIt, chaserPlatform, flowDirection === 1 ? 0.68 : 0.32, 'chaser');
  currentIt.status = AgentStatus.It;
  currentIt.cooldownTimer = preserveEnergy ? 700 : 0;
  evaders.forEach((agent, index) => {
    const ratios = flowDirection === 1 ? [0.30, 0.72] : [0.70, 0.28];
    place(agent, evaderPlatform, ratios[index] ?? 0.5, 'evader');
    agent.status = preserveEnergy ? AgentStatus.Cooldown : AgentStatus.Normal;
    agent.cooldownTimer = preserveEnergy ? 850 : 0;
  });

  const minX = Math.min(...gameState.agents.map(agent => agent.position.x));
  const maxX = Math.max(...gameState.agents.map(agent => agent.position.x + AGENT_WIDTH));
  gameState.cameraPosition.x = (minX + maxX) / 2 - viewportSize.width / 2;
  gameState.tagEffects = [];
  arena.boutResets++;
}

function hallOfFamePool(archive: HallOfFameArchive): HallOfFameEntry[] {
  return [...archive.reservoir, ...archive.recent];
}

function archiveChampion(archive: HallOfFameArchive, genome: NeatGenomeData, role: 'chaser' | 'evader') {
  const snapshot = cloneGenome(genome, `${role}_hof_g${genome.generation}`);
  snapshot.role = role;
  const entry: HallOfFameEntry = { generation: snapshot.generation, genome: snapshot, controller: new LearningAgent(role, snapshot) };
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
  const rng = mulberry32(((historical.generation + 1) * 2654435761) >>> 0);
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

function exposureFor(role: 'chaser' | 'evader'): ExposureState[] {
  return role === 'chaser' ? chaserExposure : evaderExposure;
}
function controllersFor(role: 'chaser' | 'evader'): LearningAgent[] {
  return role === 'chaser' ? chaserControllers : evaderControllers;
}
function populationFor(role: 'chaser' | 'evader') {
  return role === 'chaser' ? chaserPopulation : evaderPopulation;
}

function isExposureReady(exp: ExposureState): boolean {
  return exp.activeMs >= CONTINUOUS_EXPOSURE_TARGET_MS &&
    exp.assignments >= CONTINUOUS_MIN_ASSIGNMENTS &&
    exp.arenas.size >= Math.min(arenaCount, CONTINUOUS_MIN_ARENAS_PER_GENOME) &&
    exp.opponents.size >= CONTINUOUS_MIN_OPPONENTS_PER_GENOME;
}

function pickCurrentGenome(role: 'chaser' | 'evader', arenaId: number, opponentKey?: string): number {
  const exposures = exposureFor(role);
  let bestIndex = 0;
  let bestScore = Infinity;
  for (let i = 0; i < exposures.length; i++) {
    const exp = exposures[i];
    const readinessPenalty = isExposureReady(exp) ? 1_000_000 : 0;
    const arenaPenalty = exp.arenas.has(arenaId) ? 5_000 : 0;
    const opponentPenalty = opponentKey && exp.opponents.has(opponentKey) ? 12_000 : 0;
    const score = readinessPenalty + exp.activeMs + exp.assignments * 500 + arenaPenalty + opponentPenalty + ((i + schedulerCursor) % exposures.length) * 0.001;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  schedulerCursor = (schedulerCursor + 1) % Math.max(1, exposures.length);
  return bestIndex;
}

function currentSlot(role: 'chaser' | 'evader', index: number): ControllerSlot {
  const genome = populationFor(role).genomes[index];
  return { source: 'current', role, index, key: `${role[0]}:${genome.id}`, controller: controllersFor(role)[index] };
}
function hofSlot(role: 'chaser' | 'evader', entry: HallOfFameEntry): ControllerSlot {
  return { source: 'hof', role, index: null, key: `${role[0]}:hof:g${entry.generation}:${entry.genome.id}`, controller: entry.controller };
}

function pickHof(archive: HallOfFameArchive, rng: () => number): HallOfFameEntry | null {
  const pool = hallOfFamePool(archive);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

function randomAssignmentDuration(rng: () => number): number {
  if (rng() < CONTINUOUS_LONG_ASSIGNMENT_CHANCE) {
    return CONTINUOUS_LONG_ASSIGNMENT_MIN_MS + rng() * (CONTINUOUS_LONG_ASSIGNMENT_MAX_MS - CONTINUOUS_LONG_ASSIGNMENT_MIN_MS);
  }
  return CONTINUOUS_ASSIGNMENT_MIN_MS + rng() * (CONTINUOUS_ASSIGNMENT_MAX_MS - CONTINUOUS_ASSIGNMENT_MIN_MS);
}

function scheduleAssignment(arena: TrainingArena): ArenaAssignment {
  const evaderHof = hallOfFamePool(evaderHallOfFame).length > 0;
  const chaserHof = hallOfFamePool(chaserHallOfFame).length > 0;
  const roll = arena.rng();
  let chaser: ControllerSlot;
  let evader: ControllerSlot;

  if (evaderHof && roll < CONTINUOUS_HOF_MATCHUP_CHANCE / 2) {
    chaser = currentSlot('chaser', pickCurrentGenome('chaser', arena.id));
    evader = hofSlot('evader', pickHof(evaderHallOfFame, arena.rng)!);
  } else if (chaserHof && roll < CONTINUOUS_HOF_MATCHUP_CHANCE) {
    chaser = hofSlot('chaser', pickHof(chaserHallOfFame, arena.rng)!);
    evader = currentSlot('evader', pickCurrentGenome('evader', arena.id));
  } else {
    chaser = currentSlot('chaser', pickCurrentGenome('chaser', arena.id));
    // Prefer an evader genome that has not recently seen this exact chaser. Because the two
    // populations otherwise accumulate exposure at similar rates, a naïve least-exposed scheduler
    // tends to pair equal indices repeatedly and can never satisfy the opponent-diversity quota.
    evader = currentSlot('evader', pickCurrentGenome('evader', arena.id, chaser.key));
  }

  return { chaser, evader, targetDurationMs: randomAssignmentDuration(arena.rng), stats: emptyAssignmentStats() };
}

function createArena(id: number): TrainingArena {
  const seed = nextCourseSeed(id);
  const world = createWorld(seed);
  const rng = mulberry32((seed ^ 0x9e3779b9 ^ id) >>> 0);
  const placeholder = {} as TrainingArena;
  const arena: TrainingArena = Object.assign(placeholder, {
    id,
    gameState: world.gameState,
    flowDirection: world.flowDirection,
    rng,
    assignment: null as unknown as ArenaAssignment,
    worldAgeMs: 0,
    worldLifetimeMs: CONTINUOUS_ARENA_MIN_LIFETIME_MS + rng() * (CONTINUOUS_ARENA_MAX_LIFETIME_MS - CONTINUOUS_ARENA_MIN_LIFETIME_MS),
    boutResets: 0,
    courseSeed: seed,
  });
  resetBoutAtRandomSection(arena, false);
  arena.boutResets = 0;
  arena.assignment = scheduleAssignment(arena);
  return arena;
}

function resizeArenaPool(nextCount: number) {
  const clamped = Math.max(CONTINUOUS_TRAINING_MIN_ARENAS, Math.min(CONTINUOUS_TRAINING_MAX_ARENAS, Math.round(nextCount)));
  if (clamped === arenaCount && arenas.length === clamped) return;
  if (clamped < arenas.length) {
    const removed = arenas.splice(clamped);
    for (const arena of removed) finalizeAssignment(arena, true);
  }
  arenaCount = clamped;
  while (arenas.length < arenaCount) arenas.push(createArena(arenas.length));
}

function regenerateArenaWorld(arena: TrainingArena) {
  const seed = nextCourseSeed(arena.id);
  const world = createWorld(seed);
  arena.gameState = world.gameState;
  arena.flowDirection = world.flowDirection;
  arena.rng = mulberry32((seed ^ 0x9e3779b9 ^ arena.id) >>> 0);
  arena.worldAgeMs = 0;
  arena.worldLifetimeMs = CONTINUOUS_ARENA_MIN_LIFETIME_MS + arena.rng() * (CONTINUOUS_ARENA_MAX_LIFETIME_MS - CONTINUOUS_ARENA_MIN_LIFETIME_MS);
  arena.boutResets = 0;
  arena.courseSeed = seed;
  resetBoutAtRandomSection(arena, false);
  arena.boutResets = 0;
}

function assignmentFitness(stats: AssignmentAccumulator): { chaserFitness: number; evaderFitness: number; navigationScore: number; winner: 'chaser' | 'evader' | 'draw' } {
  const elapsedMs = Math.max(DT, stats.elapsedMs);
  const elapsedSec = elapsedMs / 1000;
  const fallEvents = stats.chaserFalls + stats.evaderFalls;
  const chaserPoints = stats.tags * NEAT_TAG_POINT_WEIGHT + stats.evaderFalls * NEAT_FALL_POINT_WEIGHT;
  const evaderPoints = stats.continuousSurvivalScore + stats.chaserFalls * NEAT_FALL_POINT_WEIGHT;
  const durationScale = 30_000 / elapsedMs;
  const nc = chaserPoints * durationScale;
  const ne = evaderPoints * durationScale;
  const total = nc + ne;
  const chaserShare = total > 0 ? nc / total : 0.5;
  const evaderShare = 1 - chaserShare;
  const averageClosestDistance = stats.cumulativeClosestDistance / Math.max(1, stats.distanceSamples);
  const separationScore = Math.max(0, Math.min(1, averageClosestDistance / 620));
  const traversalScore = Math.max(0, Math.min(1, stats.platformTransitions / Math.max(1, elapsedSec * 3 * 0.18)));
  const fallEventRate = fallEvents / Math.max(1, stats.tags + fallEvents);
  const navigationScore = 0.65 * traversalScore + 0.35 * Math.max(0, 1 - fallEventRate);
  const chaserOutcome = 25 + 185 * chaserShare;
  const evaderOutcome = 25 + 185 * evaderShare;
  const chaserFitness = Math.max(0.01, Math.min(220, chaserOutcome + 8 * (1 - separationScore) + 4 * navigationScore));
  const evaderFitness = Math.max(0.01, Math.min(220, evaderOutcome + 8 * separationScore + 4 * navigationScore));
  const winner = chaserPoints > evaderPoints + 1e-9 ? 'chaser' : evaderPoints > chaserPoints + 1e-9 ? 'evader' : 'draw';
  return { chaserFitness, evaderFitness, navigationScore, winner };
}

function recordExposure(slot: ControllerSlot, opponent: ControllerSlot, arenaId: number, elapsedMs: number, fitness: number) {
  if (slot.source !== 'current' || slot.index == null) return;
  const exp = exposureFor(slot.role)[slot.index];
  exp.activeMs += elapsedMs;
  exp.fitnessWeightedSum += fitness * elapsedMs;
  exp.fitnessWeightMs += elapsedMs;
  exp.assignments++;
  exp.arenas.add(arenaId);
  exp.opponents.add(opponent.key);
}

function finalizeAssignment(arena: TrainingArena, partial = false) {
  const assignment = arena.assignment;
  const stats = assignment.stats;
  if (!assignment || stats.elapsedMs < DT) {
    arena.assignment = scheduleAssignment(arena);
    return;
  }
  const result = assignmentFitness(stats);
  recordExposure(assignment.chaser, assignment.evader, arena.id, stats.elapsedMs, result.chaserFitness);
  recordExposure(assignment.evader, assignment.chaser, arena.id, stats.elapsedMs, result.evaderFitness);

  generationAssignments++;
  generationSimulatedMs += stats.elapsedMs;
  generationTags += stats.tags;
  if (stats.tags > 0) generationAssignmentsWithTag++;
  if (stats.chaserFalls + stats.evaderFalls > 0) generationAssignmentsWithFall++;
  generationChaserFalls += stats.chaserFalls;
  generationEvaderFalls += stats.evaderFalls;
  generationDoubleFalls += stats.doubleFalls;
  generationNavigationScoreTotal += result.navigationScore;
  generationTagTimeMs += stats.tagTimeMs;
  generationTagTimeCount += stats.tagTimeCount;
  generationSurvivalStreakMs += stats.survivalStreakMs;
  generationSurvivalStreakCount += stats.survivalStreakCount;
  if (result.winner === 'chaser') generationChaserWins++;
  else if (result.winner === 'evader') generationEvaderWins++;
  else generationDraws++;
  if (assignment.chaser.source === 'hof' || assignment.evader.source === 'hof') generationHofAssignments++;
  else generationCurrentCurrentAssignments++;

  totalMatches++;
  if (result.winner === 'chaser') totalChaserMatchWins++;
  else if (result.winner === 'evader') totalEvaderMatchWins++;
  else totalMatchDraws++;
  if (stats.tags === 0) totalTimeouts++;
  if (stats.chaserFalls) totalChaserFallTerminations += stats.chaserFalls;
  if (stats.evaderFalls) totalEvaderFallTerminations += stats.evaderFalls;
  if (stats.doubleFalls) totalDoubleFallTerminations += stats.doubleFalls;
  if (stats.tagTimeCount > 0) {
    recentTimesToTag.push(stats.tagTimeMs / stats.tagTimeCount);
    if (recentTimesToTag.length > TIME_TO_TAG_HISTORY_LENGTH) recentTimesToTag.shift();
  }
  if (stats.survivalStreakCount > 0) {
    recentSurvivalTimes.push(stats.survivalStreakMs / stats.survivalStreakCount);
    if (recentSurvivalTimes.length > SURVIVAL_TIME_HISTORY_LENGTH) recentSurvivalTimes.shift();
  }

  if (assignment.chaser.source === 'current' && assignment.evader.source === 'current') {
    const eloResult = updateEloRatings(chaserElo, evaderElo, stats.elapsedMs, undefined, stats.tags > 0, result.winner);
    chaserElo = eloResult.newChaserElo;
    evaderElo = eloResult.newEvaderElo;
  }

  arena.assignment = scheduleAssignment(arena);
  if (!partial && (arena.worldAgeMs >= arena.worldLifetimeMs || arena.boutResets >= CONTINUOUS_ARENA_MAX_BOUT_RESETS)) regenerateArenaWorld(arena);
}

function stepArena(arena: TrainingArena) {
  const gameState = arena.gameState;
  const stats = arena.assignment.stats;
  stats.elapsedMs += DT;
  arena.worldAgeMs += DT;
  gameState.gameTime += DT;
  totalSimulatedTime += DT;

  for (const agent of gameState.agents) {
    agent.cooldownTimer = Math.max(0, (agent.cooldownTimer || 0) - DT);
    if (agent.status === AgentStatus.Cooldown && agent.cooldownTimer === 0) agent.status = AgentStatus.Normal;
    if (agent.status === AgentStatus.It) {
      agent.timeSinceBecameIt = (agent.timeSinceBecameIt || 0) + DT;
      agent.survivalTime = 0;
    } else {
      agent.survivalTime = (agent.survivalTime || 0) + DT;
      agent.timeSinceBecameIt = 0;
      stats.continuousSurvivalScore += DT / NEAT_SURVIVAL_SCORE_WINDOW_MS;
    }
  }

  const dynamicStep = updateDynamicPlatforms(gameState.platforms, gameState.gameTime);
  gameState.platforms = dynamicStep.platforms;
  for (const agent of gameState.agents) {
    if (!agent.isOnGround || agent.lastPlatformId === null) continue;
    const support = gameState.platforms.find(p => p.id === agent.lastPlatformId);
    if (!support || !isPlatformSolid(support)) {
      agent.isOnGround = false;
      continue;
    }
    const delta = dynamicStep.deltas.get(support.id);
    if (delta) {
      agent.position.x += delta.x;
      agent.position.y += delta.y;
    }
  }

  const controlsByAgent = new Map<number, AgentControls>();
  for (const agent of gameState.agents) {
    const role: 'chaser' | 'evader' = agent.status === AgentStatus.It ? 'chaser' : 'evader';
    agent.role = role;
    agent.modelId = arena.assignment[role].key;
    agent.elo = role === 'chaser' ? chaserElo : evaderElo;
    const state = getAgentStateVector(agent, gameState, viewportSize);
    const controls = arena.assignment[role].controller.chooseControls(state);
    controlsByAgent.set(agent.id, controls);
    const counter = role === 'chaser' ? actionCountsChaser : actionCountsEvader;
    counter[controls.action] = (counter[controls.action] || 0) + 1;
  }

  const crumbleContacts = new Set<number>();
  const fallenIds = new Set<number>();
  for (const agent of gameState.agents) {
    const role: 'chaser' | 'evader' = agent.status === AgentStatus.It ? 'chaser' : 'evader';
    const controls = controlsByAgent.get(agent.id) || { move: 0, jump: 0, sprint: 0, outputs: [0, 0, 0, 0], action: 'left_drive', actionIndex: 0, label: 'wait' };
    agent.lastAction = controls.label;
    const locomotion = stepLocomotion(agent, controls, DT, role);
    agent.acceleration.x = locomotion.accelerationX;
    agent.maxEnergy = getPhysiology(role).energyCapacity;
    agent.energy = locomotion.energy;
    const velocity = locomotion.velocity;
    if (locomotion.jumped) {
      totalJumps++;
      stats.jumps++;
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
      if (!isPlatformSolid(platform)) continue;
      const prevBottom = agent.position.y + AGENT_HEIGHT;
      const nextBottom = nextPosition.y + AGENT_HEIGHT;
      const aligned = nextPosition.x + AGENT_WIDTH > platform.position.x && nextPosition.x < platform.position.x + platform.width;
      if (aligned && prevBottom <= platform.position.y + 8 && nextBottom >= platform.position.y && velocity.y >= 0) {
        nextPosition.y = platform.position.y - AGENT_HEIGHT;
        velocity.y = 0;
        grounded = true;
        if (platform.id !== agent.lastPlatformId) stats.platformTransitions++;
        landedPlatformId = platform.id;
        if (platform.kind === 'crumbling') crumbleContacts.add(platform.id);
        break;
      }
    }
    if (nextPosition.y > FALL_BOUNDARY) {
      totalFalls++;
      fallenIds.add(agent.id);
      grounded = false;
    }
    agent.position = nextPosition;
    agent.velocity = velocity;
    agent.isOnGround = grounded;
    agent.lastPlatformId = landedPlatformId;
  }

  if (crumbleContacts.size) {
    gameState.platforms = gameState.platforms.map(platform => crumbleContacts.has(platform.id) ? triggerCrumblingPlatform(platform, gameState.gameTime) : platform);
  }

  if (fallenIds.size) {
    const currentIt = gameState.agents.find(agent => agent.status === AgentStatus.It);
    const chaserFell = currentIt ? fallenIds.has(currentIt.id) : false;
    const evadersFell = gameState.agents.filter(agent => agent.status !== AgentStatus.It && fallenIds.has(agent.id)).length;
    if (chaserFell) stats.chaserFalls++;
    if (evadersFell > 0) stats.evaderFalls += evadersFell;
    if (chaserFell && evadersFell > 0) stats.doubleFalls++;
    resetBoutAtRandomSection(arena, true);
  } else {
    const itAgent = gameState.agents.find(agent => agent.status === AgentStatus.It);
    if (itAgent && (itAgent.cooldownTimer || 0) <= 0) {
      for (const otherAgent of gameState.agents) {
        if (otherAgent.id === itAgent.id || otherAgent.status === AgentStatus.It || (otherAgent.cooldownTimer || 0) > 0) continue;
        const dx = (itAgent.position.x + AGENT_WIDTH / 2) - (otherAgent.position.x + AGENT_WIDTH / 2);
        const dy = (itAgent.position.y + AGENT_HEIGHT / 2) - (otherAgent.position.y + AGENT_HEIGHT / 2);
        if (Math.hypot(dx, dy) >= (AGENT_WIDTH + AGENT_HEIGHT) / 2) continue;
        stats.tags++;
        totalTags++;
        stats.tagTimeMs += Math.max(100, itAgent.timeSinceBecameIt || 0);
        stats.tagTimeCount++;
        stats.survivalStreakMs += Math.max(100, otherAgent.survivalTime || 0);
        stats.survivalStreakCount++;

        const oldTagger = itAgent;
        const newTagger = otherAgent;
        newTagger.status = AgentStatus.It;
        newTagger.role = 'chaser';
        newTagger.cooldownTimer = 600;
        newTagger.survivalTime = 0;
        newTagger.timeSinceBecameIt = 0;
        newTagger.maxEnergy = getPhysiology('chaser').energyCapacity;
        newTagger.energy = Math.min(newTagger.energy, newTagger.maxEnergy);
        oldTagger.status = AgentStatus.Cooldown;
        oldTagger.role = 'evader';
        oldTagger.cooldownTimer = TAG_COOLDOWN;
        oldTagger.survivalTime = 0;
        oldTagger.timeSinceBecameIt = 0;
        oldTagger.maxEnergy = getPhysiology('evader').energyCapacity;
        oldTagger.energy = Math.min(oldTagger.energy, oldTagger.maxEnergy);
        break;
      }
    }
  }

  const activeIt = gameState.agents.find(agent => agent.status === AgentStatus.It);
  const activeEvaders = gameState.agents.filter(agent => agent.status !== AgentStatus.It);
  if (activeIt && activeEvaders.length) {
    const closestDistance = Math.min(...activeEvaders.map(agent => Math.hypot(agent.position.x - activeIt.position.x, agent.position.y - activeIt.position.y)));
    stats.cumulativeClosestDistance += closestDistance;
    stats.distanceSamples++;
    const minX = Math.min(...activeEvaders.map(agent => agent.position.x));
    const maxX = Math.max(...activeEvaders.map(agent => agent.position.x + AGENT_WIDTH));
    const desiredCameraX = (minX + maxX) / 2 - viewportSize.width * 0.45;
    gameState.cameraPosition.x += (desiredCameraX - gameState.cameraPosition.x) * 0.12;
  }

  if (stats.elapsedMs >= arena.assignment.targetDurationMs) finalizeAssignment(arena);
}

function allGenomesReady(): boolean {
  return chaserExposure.every(isExposureReady) && evaderExposure.every(isExposureReady);
}

function exposureProgress(): number {
  const progress = (exp: ExposureState) => {
    const time = Math.min(1, exp.activeMs / CONTINUOUS_EXPOSURE_TARGET_MS);
    const assignments = Math.min(1, exp.assignments / CONTINUOUS_MIN_ASSIGNMENTS);
    const arenaProgress = Math.min(1, exp.arenas.size / Math.min(arenaCount, CONTINUOUS_MIN_ARENAS_PER_GENOME));
    const opponents = Math.min(1, exp.opponents.size / CONTINUOUS_MIN_OPPONENTS_PER_GENOME);
    return 0.55 * time + 0.15 * assignments + 0.15 * arenaProgress + 0.15 * opponents;
  };
  const values = [...chaserExposure.map(progress), ...evaderExposure.map(progress)];
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function refreshControllers() {
  chaserControllers = chaserPopulation.genomes.map(g => new LearningAgent('chaser', g));
  evaderControllers = evaderPopulation.genomes.map(g => new LearningAgent('evader', g));
}

function resetGenerationAccumulators() {
  resetExposure();
  generationAssignments = 0;
  generationSimulatedMs = 0;
  generationTags = 0;
  generationAssignmentsWithTag = 0;
  generationAssignmentsWithFall = 0;
  generationTagTimeMs = 0;
  generationTagTimeCount = 0;
  generationSurvivalStreakMs = 0;
  generationSurvivalStreakCount = 0;
  generationChaserFalls = 0;
  generationEvaderFalls = 0;
  generationDoubleFalls = 0;
  generationChaserWins = 0;
  generationEvaderWins = 0;
  generationDraws = 0;
  generationNavigationScoreTotal = 0;
  generationCurrentCurrentAssignments = 0;
  generationHofAssignments = 0;
}

function finishGeneration() {
  // Close the current snippets before breeding so no old-generation controller remains active.
  for (const arena of arenas) finalizeAssignment(arena, true);

  for (let i = 0; i < NEAT_POPULATION_SIZE; i++) {
    const ce = chaserExposure[i];
    const ee = evaderExposure[i];
    chaserPopulation.genomes[i].fitness = ce.fitnessWeightMs > 0 ? ce.fitnessWeightedSum / ce.fitnessWeightMs : 0.01;
    evaderPopulation.genomes[i].fitness = ee.fitnessWeightMs > 0 ? ee.fitnessWeightedSum / ee.fitnessWeightMs : 0.01;
  }

  const completedGeneration = chaserPopulation.generation;
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

  const avgNav = generationNavigationScoreTotal / Math.max(1, generationAssignments);
  const fallRate = generationAssignmentsWithFall / Math.max(1, generationAssignments);
  const curriculum = advanceCurriculum(curriculumState, { navigationScore: avgNav, fallTerminationRate: fallRate });
  lastCurriculumTelemetry = {
    ...curriculum,
    lastCourseSeed,
    lastCourseBranchCount,
    lastCourseMovingPlatforms,
    lastCourseCrumblingPlatforms,
  };

  lastGenerationBalance = {
    generation: completedGeneration,
    matches: generationAssignments,
    tags: generationTags,
    matchesWithTag: generationAssignmentsWithTag,
    timeouts: Math.max(0, generationAssignments - generationAssignmentsWithTag),
    chaserFalls: generationChaserFalls,
    evaderFalls: generationEvaderFalls,
    doubleFalls: generationDoubleFalls,
    tagRate: generationAssignmentsWithTag / Math.max(1, generationAssignments),
    survivalRate: generationEvaderWins / Math.max(1, generationAssignments),
    fallRate,
    chaserWinRate: generationChaserWins / Math.max(1, generationAssignments),
    evaderWinRate: generationEvaderWins / Math.max(1, generationAssignments),
    drawRate: generationDraws / Math.max(1, generationAssignments),
    tagsPer30s: generationTags * 30_000 / Math.max(DT, generationSimulatedMs),
    avgTagsPerMatch: generationTags / Math.max(1, generationAssignments),
    avgSurvivalStreakMs: generationSurvivalStreakCount ? generationSurvivalStreakMs / generationSurvivalStreakCount : null,
    avgTagTimeMs: generationTagTimeCount ? generationTagTimeMs / generationTagTimeCount : null,
  };

  lastContinuousTrainingTelemetry = makeContinuousTrainingTelemetry();
  refreshControllers();
  resetGenerationAccumulators();
  // The worlds continue. Only controllers are swapped to the new generation.
  for (const arena of arenas) arena.assignment = scheduleAssignment(arena);
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function makeContinuousTrainingTelemetry(): ContinuousTrainingTelemetry {
  const chaserReady = chaserExposure.filter(isExposureReady).length;
  const evaderReady = evaderExposure.filter(isExposureReady).length;
  const avgActive = (xs: ExposureState[]) => xs.reduce((s, x) => s + x.activeMs, 0) / Math.max(1, xs.length);
  const avgAssignments = (xs: ExposureState[]) => xs.reduce((s, x) => s + x.assignments, 0) / Math.max(1, xs.length);
  return {
    arenaCount,
    assignmentMinMs: CONTINUOUS_ASSIGNMENT_MIN_MS,
    assignmentMaxMs: CONTINUOUS_ASSIGNMENT_MAX_MS,
    longAssignmentChance: CONTINUOUS_LONG_ASSIGNMENT_CHANCE,
    longAssignmentMinMs: CONTINUOUS_LONG_ASSIGNMENT_MIN_MS,
    longAssignmentMaxMs: CONTINUOUS_LONG_ASSIGNMENT_MAX_MS,
    exposureTargetMs: CONTINUOUS_EXPOSURE_TARGET_MS,
    minAssignments: CONTINUOUS_MIN_ASSIGNMENTS,
    minArenas: Math.min(arenaCount, CONTINUOUS_MIN_ARENAS_PER_GENOME),
    minOpponents: CONTINUOUS_MIN_OPPONENTS_PER_GENOME,
    generationProgress: exposureProgress(),
    chaserReady,
    evaderReady,
    populationSize: NEAT_POPULATION_SIZE,
    avgChaserExposureMs: avgActive(chaserExposure),
    avgEvaderExposureMs: avgActive(evaderExposure),
    avgChaserAssignments: avgAssignments(chaserExposure),
    avgEvaderAssignments: avgAssignments(evaderExposure),
    currentCurrentAssignments: generationCurrentCurrentAssignments,
    hallOfFameAssignments: generationHofAssignments,
    hallOfFameChance: CONTINUOUS_HOF_MATCHUP_CHANCE,
  };
}

function emitTelemetry() {
  const generation = Math.max(lastChaserMetrics?.generation || 0, lastEvaderMetrics?.generation || 0);
  const leaderboard = createLeaderboardEntries(
    chaserElo, evaderElo, totalTags, totalFalls, generation, average(recentTimesToTag), average(recentSurvivalTimes),
    { tags: totalTags, chaserFalls: totalChaserFallTerminations, evaderFalls: totalEvaderFallTerminations, timeouts: totalTimeouts, doubleFalls: totalDoubleFallTerminations, matches: totalMatches, chaserMatchWins: totalChaserMatchWins, evaderMatchWins: totalEvaderMatchWins, draws: totalMatchDraws }
  );
  const continuousTraining = makeContinuousTrainingTelemetry();
  lastContinuousTrainingTelemetry = continuousTraining;
  self.postMessage({
    type: 'TELEMETRY',
    payload: {
      algorithm: 'NEAT',
      generation,
      evaluationProgress: continuousTraining.generationProgress,
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
      curriculum: lastCurriculumTelemetry,
      continuousTraining,
      hallOfFame: {
        chaserSize: hallOfFamePool(chaserHallOfFame).length,
        evaderSize: hallOfFamePool(evaderHallOfFame).length,
        maxSize: NEAT_HOF_MAX_SIZE,
        opponentsPerGenome: CONTINUOUS_HOF_MATCHUP_CHANCE,
        chaserGenerations: hallOfFamePool(chaserHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
        evaderGenerations: hallOfFamePool(evaderHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
      },
    },
  });
}

function runHeadlessBatch() {
  if (!isRunning) return;
  if (!arenas.length) resizeArenaPool(arenaCount);

  // Speed controls total simulated arena-frames per worker tick, not frames *per arena*.
  // Increasing arena count therefore increases state diversity without silently multiplying the
  // requested throughput setting by the number of arenas.
  const totalArenaSteps = Math.max(arenas.length, Math.round(speedMultiplier));
  for (let i = 0; i < totalArenaSteps; i++) {
    const arena = arenas[i % arenas.length];
    stepArena(arena);
    if (allGenomesReady()) {
      finishGeneration();
      break;
    }
  }

  emitTelemetry();
  if (isRunning) timerId = setTimeout(runHeadlessBatch, 16);
}

function seedPopulations(chaserWeights?: AgentWeights, evaderWeights?: AgentWeights, archiveSeed = false) {
  clearHallOfFame();
  lastGenerationBalance = null;
  lastCurriculumTelemetry = curriculumSnapshot(curriculumState);
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
  resetGenerationAccumulators();
  arenas = [];
  resizeArenaPool(arenaCount);
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;
  switch (type) {
    case 'START': {
      if (typeof payload?.speedMultiplier === 'number') speedMultiplier = Math.max(1, Math.min(200, payload.speedMultiplier));
      if (typeof payload?.arenaCount === 'number') arenaCount = Math.max(CONTINUOUS_TRAINING_MIN_ARENAS, Math.min(CONTINUOUS_TRAINING_MAX_ARENAS, Math.round(payload.arenaCount)));
      if (payload?.viewportSize) viewportSize = payload.viewportSize;
      if (!seededFromStart && (payload?.chaserWeights || payload?.evaderWeights)) {
        seedPopulations(payload?.chaserWeights, payload?.evaderWeights);
        seededFromStart = true;
      }
      if (typeof payload?.chaserElo === 'number') chaserElo = payload.chaserElo;
      if (typeof payload?.evaderElo === 'number') evaderElo = payload.evaderElo;
      resizeArenaPool(arenaCount);
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
    case 'SET_ARENA_COUNT':
      if (typeof payload?.arenaCount === 'number') resizeArenaPool(payload.arenaCount);
      emitTelemetry();
      break;
    case 'SYNC_WEIGHTS_REQUEST':
      self.postMessage({ type: 'SYNC_WEIGHTS_RESPONSE', payload: { algorithm: 'NEAT', chaserWeights: championChaser.getWeights(), evaderWeights: championEvader.getWeights(), chaserElo, evaderElo, generation: Math.max(lastChaserMetrics?.generation || 0, lastEvaderMetrics?.generation || 0) } });
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
      totalChaserFallTerminations = 0;
      totalEvaderFallTerminations = 0;
      totalDoubleFallTerminations = 0;
      totalTimeouts = 0;
      totalMatches = 0;
      totalChaserMatchWins = 0;
      totalEvaderMatchWins = 0;
      totalMatchDraws = 0;
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
      curriculumState = createCurriculumState();
      lastCurriculumTelemetry = curriculumSnapshot(curriculumState);
      lastContinuousTrainingTelemetry = null;
      lastCourseSeed = 0;
      lastCourseBranchCount = 0;
      lastCourseMovingPlatforms = 0;
      lastCourseCrumblingPlatforms = 0;
      arenaSeedCounter = 1;
      arenas = [];
      resetGenerationAccumulators();
      resizeArenaPool(arenaCount);
      emitTelemetry();
      break;
  }
};
