import { LearningAgent, type AgentWeights, type AgentControls } from '../learning/agent';
import { getPhysiology, stepLocomotion } from '../learning/movement';
import { NeatPopulation, DEFAULT_NEAT_CONFIG, cloneGenome, type NeatGenerationMetrics, type NeatGenomeData } from '../learning/neat';
import { getAgentStateVector } from '../learning/state';
import { updateEloRatings, createLeaderboardEntries } from '../learning/elo';
import type { AgentState, BalanceTelemetry, CurriculumTelemetry, GameState } from '../types';
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
  NEAT_OPPONENTS_PER_GENOME,
  NEAT_HOF_OPPONENTS_PER_GENOME,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_RECENT_SLOTS,
  NEAT_MATCH_MIN_MS,
  NEAT_MATCH_MAX_MS,
  NEAT_SURVIVAL_MILESTONE_MS,
  NEAT_TAG_POINT_WEIGHT,
  NEAT_FALL_POINT_WEIGHT,
  NEAT_TRAINING_COURSE_LENGTH,
  TAG_COOLDOWN,
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
let generationPopulationMatchesWithTag = 0;
let generationPopulationTags = 0;
let generationPopulationTagTimeMs = 0;
let generationPopulationTagTimeCount = 0;
let generationPopulationSurvivalStreakMs = 0;
let generationPopulationSurvivalStreakCount = 0;
let generationPopulationChaserFalls = 0;
let generationPopulationEvaderFalls = 0;
let generationPopulationDoubleFalls = 0;
let generationPopulationTimeouts = 0;
let generationPopulationChaserMatchWins = 0;
let generationPopulationEvaderMatchWins = 0;
let generationPopulationDraws = 0;
let generationPopulationSimulatedMs = 0;
let lastGenerationBalance: BalanceTelemetry | null = null;
let curriculumState = createCurriculumState();
let lastCurriculumTelemetry: CurriculumTelemetry = curriculumSnapshot(curriculumState);
let generationNavigationScoreTotal = 0;
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
let lastSampleGameState: GameState | null = null;
const recentSurvivalTimes: number[] = [];
const recentTimesToTag: number[] = [];
const actionCountsChaser: Record<string, number> = {};
const actionCountsEvader: Record<string, number> = {};


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

function createMatchState(seed: number): { gameState: GameState; flowDirection: 1 | -1 } {
  const course = generateCourse({
    seed,
    difficulty: curriculumState.difficulty,
    viewport: viewportSize,
    length: NEAT_TRAINING_COURSE_LENGTH,
  });
  const features = countCourseFeatures(course.platforms);
  lastCourseSeed = seed >>> 0;
  lastCourseBranchCount = course.graph.branchCount;
  lastCourseMovingPlatforms = features.moving;
  lastCourseCrumblingPlatforms = features.crumbling;

  const gameState: GameState = {
    agents: [
      makeAgent(1, course.startXs[0], 'chaser'),
      makeAgent(2, course.startXs[1], 'evader'),
      makeAgent(3, course.startXs[2], 'evader'),
    ],
    platforms: course.platforms,
    cameraPosition: { x: 0, y: 0 },
    gameTime: 0,
    tagEffects: [],
    avgSurvivalTime: 0,
    avgTimeToTag: 0,
    courseGraph: course.graph,
  };

  return { gameState, flowDirection: course.flowDirection };
}

interface MatchStats {
  chaserFitness: number;
  evaderFitness: number;
  chaserPoints: number;
  evaderPoints: number;
  winner: 'chaser' | 'evader' | 'draw';
  elapsedMs: number;
  tags: number;
  chaserFalls: number;
  evaderFalls: number;
  doubleFalls: number;
  falls: number;
  jumps: number;
  navigationScore: number;
  avgTagTimeMs: number | null;
  avgSurvivalStreakMs: number | null;
  gameState: GameState;
}

function cloneResettablePlatforms(platforms: GameState['platforms']): GameState['platforms'] {
  return platforms.map(platform => ({
    ...platform,
    position: { ...(platform.basePosition ?? platform.position) },
    active: true,
    crumblePhase: platform.kind === 'crumbling' ? 'stable' : platform.crumblePhase,
    crumble: platform.crumble
      ? { ...platform.crumble, triggeredAt: undefined }
      : undefined,
  }));
}

function resetBoutAtRandomSection(
  gameState: GameState,
  flowDirection: 1 | -1,
  rng: () => number,
  preserveEnergy: boolean,
) {
  const currentIt = gameState.agents.find(agent => agent.status === AgentStatus.It) ?? gameState.agents[0];
  const currentItId = currentIt.id;

  // A bout reset restores temporary terrain state, but does not refill stamina. Falling therefore
  // cannot be exploited as an energy-reset shortcut inside the longer evolutionary match.
  gameState.platforms = cloneResettablePlatforms(gameState.platforms);
  gameState.platforms = updateDynamicPlatforms(gameState.platforms, gameState.gameTime).platforms;

  const backbone = gameState.platforms.filter(platform =>
    (platform.routeRole === 'start' || platform.routeRole === 'backbone') && isPlatformSolid(platform)
  );
  if (backbone.length < 2) return;

  // Sample across the first ~45% of the generated backbone. The training course is long enough that
  // even a maximum-duration match retains substantial navigable terrain ahead of the group.
  const maxAnchor = Math.max(0, Math.min(backbone.length - 2, Math.floor((backbone.length - 2) * 0.45)));
  const anchorIndex = Math.floor(rng() * (maxAnchor + 1));
  const chaserPlatform = backbone[anchorIndex];
  const evaderPlatform = backbone[Math.min(backbone.length - 1, anchorIndex + 1)];
  const evaders = gameState.agents.filter(agent => agent.id !== currentItId);

  const placeOnPlatform = (agent: AgentState, platform: GameState['platforms'][number], ratio: number, role: 'chaser' | 'evader') => {
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

  placeOnPlatform(currentIt, chaserPlatform, flowDirection === 1 ? 0.68 : 0.32, 'chaser');
  currentIt.status = AgentStatus.It;
  currentIt.cooldownTimer = preserveEnergy ? 700 : 0;

  evaders.forEach((agent, index) => {
    const ratios = flowDirection === 1 ? [0.30, 0.72] : [0.70, 0.28];
    placeOnPlatform(agent, evaderPlatform, ratios[index] ?? 0.5, 'evader');
    agent.status = preserveEnergy ? AgentStatus.Cooldown : AgentStatus.Normal;
    agent.cooldownTimer = preserveEnergy ? 850 : 0;
  });

  const minX = Math.min(...gameState.agents.map(agent => agent.position.x));
  const maxX = Math.max(...gameState.agents.map(agent => agent.position.x + AGENT_WIDTH));
  gameState.cameraPosition.x = (minX + maxX) / 2 - viewportSize.width / 2;
  gameState.tagEffects = [];
}

function runMatch(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  trackActions: { chaser: boolean; evader: boolean } = { chaser: true, evader: true }
): MatchStats {
  const { gameState, flowDirection } = createMatchState(seed);
  const matchRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const matchDurationMs = NEAT_MATCH_MIN_MS + matchRng() * (NEAT_MATCH_MAX_MS - NEAT_MATCH_MIN_MS);
  resetBoutAtRandomSection(gameState, flowDirection, matchRng, false);

  let tags = 0;
  let chaserFalls = 0;
  let evaderFalls = 0;
  let doubleFalls = 0;
  let chaserJumps = 0;
  let evaderJumps = 0;
  let survivalMilestones = 0;
  let platformTransitions = 0;
  let cumulativeClosestDistance = 0;
  let distanceSamples = 0;
  const tagTimes: number[] = [];
  const survivalStreaks: number[] = [];

  const maxSteps = Math.ceil(matchDurationMs / DT);

  for (let step = 0; step < maxSteps; step++) {
    gameState.gameTime = Math.min(matchDurationMs, gameState.gameTime + DT);

    // Advance cooldowns and role timers before perception. Survival milestones continue throughout
    // the randomized match, so useful evasion remains valuable at 10s, 20s, 30s, ... rather than
    // losing all selection pressure after a fixed first-tag horizon.
    for (const agent of gameState.agents) {
      agent.cooldownTimer = Math.max(0, (agent.cooldownTimer || 0) - DT);
      if (agent.status === AgentStatus.Cooldown && agent.cooldownTimer === 0) {
        agent.status = AgentStatus.Normal;
      }

      if (agent.status === AgentStatus.It) {
        agent.timeSinceBecameIt = (agent.timeSinceBecameIt || 0) + DT;
        agent.survivalTime = 0;
      } else {
        const previousSurvival = agent.survivalTime || 0;
        const nextSurvival = previousSurvival + DT;
        survivalMilestones += Math.max(
          0,
          Math.floor(nextSurvival / NEAT_SURVIVAL_MILESTONE_MS) - Math.floor(previousSurvival / NEAT_SURVIVAL_MILESTONE_MS),
        );
        agent.survivalTime = nextSurvival;
        agent.timeSinceBecameIt = 0;
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
      agent.modelId = role === 'chaser' ? 'current_chaser' : 'current_evader';
      agent.elo = role === 'chaser' ? chaserElo : evaderElo;
      const controller = role === 'chaser' ? chaser : evader;
      const state = getAgentStateVector(agent, gameState, viewportSize);
      const controls = controller.chooseControls(state);
      controlsByAgent.set(agent.id, controls);
      if (trackActions[role]) {
        const counter = role === 'chaser' ? actionCountsChaser : actionCountsEvader;
        counter[controls.action] = (counter[controls.action] || 0) + 1;
      }
    }

    const crumbleContacts = new Set<number>();
    const fallenIds = new Set<number>();
    for (const agent of gameState.agents) {
      const role: 'chaser' | 'evader' = agent.status === AgentStatus.It ? 'chaser' : 'evader';
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
        if (role === 'chaser') chaserJumps++;
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
        if (!isPlatformSolid(platform)) continue;
        const prevBottom = agent.position.y + AGENT_HEIGHT;
        const nextBottom = nextPosition.y + AGENT_HEIGHT;
        const aligned = nextPosition.x + AGENT_WIDTH > platform.position.x && nextPosition.x < platform.position.x + platform.width;
        if (aligned && prevBottom <= platform.position.y + 8 && nextBottom >= platform.position.y && velocity.y >= 0) {
          nextPosition.y = platform.position.y - AGENT_HEIGHT;
          velocity.y = 0;
          grounded = true;
          if (platform.id !== agent.lastPlatformId) platformTransitions++;
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

    if (crumbleContacts.size > 0) {
      gameState.platforms = gameState.platforms.map(platform =>
        crumbleContacts.has(platform.id) ? triggerCrumblingPlatform(platform, gameState.gameTime) : platform
      );
    }

    // A fall ends only the current bout. It is more costly than a tag, and resetting the bout does
    // not refill stamina, so jumping into the void cannot become a rational escape/reset strategy.
    if (fallenIds.size > 0) {
      const currentIt = gameState.agents.find(agent => agent.status === AgentStatus.It);
      const chaserFell = currentIt ? fallenIds.has(currentIt.id) : false;
      const evadersFell = gameState.agents.filter(agent => agent.status !== AgentStatus.It && fallenIds.has(agent.id)).length;
      if (chaserFell) chaserFalls++;
      if (evadersFell > 0) evaderFalls += evadersFell;
      if (chaserFell && evadersFell > 0) doubleFalls++;

      resetBoutAtRandomSection(gameState, flowDirection, matchRng, true);
      continue;
    }

    // Tagging mirrors visual play: the tagged runner becomes It, the old chaser becomes an evader,
    // and the match continues. The role-level genome always controls whichever body currently has
    // that role, exposing both networks to post-tag states during evolution.
    const itAgent = gameState.agents.find(agent => agent.status === AgentStatus.It);
    if (itAgent && (itAgent.cooldownTimer || 0) <= 0) {
      for (const otherAgent of gameState.agents) {
        if (
          otherAgent.id === itAgent.id ||
          otherAgent.status === AgentStatus.It ||
          (otherAgent.cooldownTimer || 0) > 0
        ) continue;

        const dx = (itAgent.position.x + AGENT_WIDTH / 2) - (otherAgent.position.x + AGENT_WIDTH / 2);
        const dy = (itAgent.position.y + AGENT_HEIGHT / 2) - (otherAgent.position.y + AGENT_HEIGHT / 2);
        if (Math.hypot(dx, dy) >= (AGENT_WIDTH + AGENT_HEIGHT) / 2) continue;

        tags++;
        totalTags++;
        tagTimes.push(Math.max(100, itAgent.timeSinceBecameIt || 0));
        survivalStreaks.push(Math.max(100, otherAgent.survivalTime || 0));

        const oldTagger = itAgent;
        const newTagger = otherAgent;

        newTagger.status = AgentStatus.It;
        newTagger.role = 'chaser';
        newTagger.modelId = 'current_chaser';
        newTagger.elo = chaserElo;
        newTagger.cooldownTimer = 600;
        newTagger.survivalTime = 0;
        newTagger.timeSinceBecameIt = 0;
        newTagger.maxEnergy = getPhysiology('chaser').energyCapacity;
        newTagger.energy = Math.min(newTagger.energy, newTagger.maxEnergy);

        oldTagger.status = AgentStatus.Cooldown;
        oldTagger.role = 'evader';
        oldTagger.modelId = 'current_evader';
        oldTagger.elo = evaderElo;
        oldTagger.cooldownTimer = TAG_COOLDOWN;
        oldTagger.survivalTime = 0;
        oldTagger.timeSinceBecameIt = 0;
        oldTagger.maxEnergy = getPhysiology('evader').energyCapacity;
        oldTagger.energy = Math.min(oldTagger.energy, oldTagger.maxEnergy);
        break;
      }
    }

    const activeIt = gameState.agents.find(agent => agent.status === AgentStatus.It);
    const activeEvaders = gameState.agents.filter(agent => agent.status !== AgentStatus.It);
    if (activeIt && activeEvaders.length > 0) {
      const closestDistance = Math.min(...activeEvaders.map(agent =>
        Math.hypot(agent.position.x - activeIt.position.x, agent.position.y - activeIt.position.y)
      ));
      cumulativeClosestDistance += closestDistance;
      distanceSamples++;

      const minX = Math.min(...activeEvaders.map(agent => agent.position.x));
      const maxX = Math.max(...activeEvaders.map(agent => agent.position.x + AGENT_WIDTH));
      const desiredCameraX = (minX + maxX) / 2 - viewportSize.width * 0.45;
      gameState.cameraPosition.x += (desiredCameraX - gameState.cameraPosition.x) * 0.12;
    }

    if (gameState.gameTime >= matchDurationMs) break;
  }

  const finalEvaders = gameState.agents.filter(agent => agent.status !== AgentStatus.It);
  finalEvaders.forEach(agent => survivalStreaks.push(Math.max(100, agent.survivalTime || 0)));

  const elapsedMs = matchDurationMs;
  const elapsedSec = elapsedMs / 1000;
  const fallEvents = chaserFalls + evaderFalls;
  const chaserPoints = tags * NEAT_TAG_POINT_WEIGHT + evaderFalls * NEAT_FALL_POINT_WEIGHT;
  const evaderPoints = survivalMilestones + chaserFalls * NEAT_FALL_POINT_WEIGHT;
  const totalPoints = chaserPoints + evaderPoints;
  const chaserShare = totalPoints > 0 ? chaserPoints / totalPoints : 0.5;
  const evaderShare = 1 - chaserShare;

  const averageClosestDistance = cumulativeClosestDistance / Math.max(1, distanceSamples);
  const separationScore = Math.max(0, Math.min(1, averageClosestDistance / 620));
  const traversalScore = Math.max(0, Math.min(1, platformTransitions / Math.max(1, elapsedSec * gameState.agents.length * 0.18)));
  const fallEventRate = fallEvents / Math.max(1, tags + fallEvents);
  const noFallScore = Math.max(0, 1 - fallEventRate);
  const navigationScore = 0.65 * traversalScore + 0.35 * noFallScore;

  // The main score is a symmetric share of repeated competitive events over the whole match.
  // Distance and navigation shaping are intentionally small so repeated tags / long survival streaks
  // remain the dominant evolutionary objective.
  const chaserOutcome = 25 + 185 * chaserShare;
  const evaderOutcome = 25 + 185 * evaderShare;
  const chaserFitness = Math.max(0.01, Math.min(220, chaserOutcome + 8 * (1 - separationScore) + 4 * navigationScore));
  const evaderFitness = Math.max(0.01, Math.min(220, evaderOutcome + 8 * separationScore + 4 * navigationScore));
  const winner: MatchStats['winner'] = chaserPoints > evaderPoints + 1e-9
    ? 'chaser'
    : evaderPoints > chaserPoints + 1e-9
      ? 'evader'
      : 'draw';

  const avgTagTimeMs = tagTimes.length ? tagTimes.reduce((a, b) => a + b, 0) / tagTimes.length : null;
  const avgSurvivalStreakMs = survivalStreaks.length
    ? survivalStreaks.reduce((a, b) => a + b, 0) / survivalStreaks.length
    : null;

  if (chaserFalls > 0) totalChaserFallTerminations += chaserFalls;
  if (evaderFalls > 0) totalEvaderFallTerminations += evaderFalls;
  if (doubleFalls > 0) totalDoubleFallTerminations += doubleFalls;
  if (tags === 0) totalTimeouts++;
  totalMatches++;
  if (winner === 'chaser') totalChaserMatchWins++;
  else if (winner === 'evader') totalEvaderMatchWins++;
  else totalMatchDraws++;

  gameState.avgSurvivalTime = avgSurvivalStreakMs ?? elapsedMs;
  gameState.avgTimeToTag = avgTagTimeMs ?? elapsedMs;
  gameState.agents.forEach(agent => {
    agent.stateVector = getAgentStateVector(agent, gameState, viewportSize);
    agent.elo = agent.status === AgentStatus.It ? chaserElo : evaderElo;
  });

  return {
    chaserFitness,
    evaderFitness,
    chaserPoints,
    evaderPoints,
    winner,
    elapsedMs,
    tags,
    chaserFalls,
    evaderFalls,
    doubleFalls,
    falls: fallEvents,
    jumps: chaserJumps + evaderJumps,
    navigationScore,
    avgTagTimeMs,
    avgSurvivalStreakMs,
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
  generationPopulationMatchesWithTag = 0;
  generationPopulationTags = 0;
  generationPopulationTagTimeMs = 0;
  generationPopulationTagTimeCount = 0;
  generationPopulationSurvivalStreakMs = 0;
  generationPopulationSurvivalStreakCount = 0;
  generationPopulationChaserFalls = 0;
  generationPopulationEvaderFalls = 0;
  generationPopulationDoubleFalls = 0;
  generationPopulationTimeouts = 0;
  generationPopulationChaserMatchWins = 0;
  generationPopulationEvaderMatchWins = 0;
  generationPopulationDraws = 0;
  generationPopulationSimulatedMs = 0;
  generationNavigationScoreTotal = 0;
}

function recordMatchTelemetry(result: MatchStats, currentPopulationMatch = true) {
  totalSimulatedTime += result.elapsedMs;
  if (result.avgSurvivalStreakMs != null) {
    recentSurvivalTimes.push(result.avgSurvivalStreakMs);
    if (recentSurvivalTimes.length > SURVIVAL_TIME_HISTORY_LENGTH) recentSurvivalTimes.shift();
  }
  if (result.avgTagTimeMs != null) {
    recentTimesToTag.push(result.avgTagTimeMs);
    if (recentTimesToTag.length > TIME_TO_TAG_HISTORY_LENGTH) recentTimesToTag.shift();
  }
  if (currentPopulationMatch) {
    const forcedResult = result.winner;
    const eloResult = updateEloRatings(
      chaserElo,
      evaderElo,
      result.elapsedMs,
      undefined,
      result.tags > 0,
      forcedResult,
    );
    chaserElo = eloResult.newChaserElo;
    evaderElo = eloResult.newEvaderElo;
    lastSampleGameState = result.gameState;
  }
}

function evaluateNextMatch(): boolean {
  const n = chaserPopulation.genomes.length;

  if (evaluationPhase === 'population') {
    const chaserIndex = evaluationIndex;
    // Rotating opponents prevents index-lock coevolution while keeping every role equally sampled.
    const evaderIndex = (evaluationIndex + evaluationRound * 17 + chaserPopulation.generation * 7) % n;
    const environmentSeed = chaserPopulation.generation * 100003 + evaluationRound * 7919;
    const result = runMatch(chaserControllers[chaserIndex], evaderControllers[evaderIndex], environmentSeed);

    chaserFitnessTotals[chaserIndex] += result.chaserFitness;
    chaserFitnessCounts[chaserIndex]++;
    evaderFitnessTotals[evaderIndex] += result.evaderFitness;
    evaderFitnessCounts[evaderIndex]++;

    generationPopulationMatches++;
    generationPopulationSimulatedMs += result.elapsedMs;
    generationNavigationScoreTotal += result.navigationScore;
    generationPopulationTags += result.tags;
    if (result.tags > 0) generationPopulationMatchesWithTag++;
    else generationPopulationTimeouts++;
    generationPopulationChaserFalls += result.chaserFalls;
    generationPopulationEvaderFalls += result.evaderFalls;
    generationPopulationDoubleFalls += result.doubleFalls;
    if (result.avgTagTimeMs != null && result.tags > 0) {
      generationPopulationTagTimeMs += result.avgTagTimeMs * result.tags;
      generationPopulationTagTimeCount += result.tags;
    }
    if (result.avgSurvivalStreakMs != null) {
      generationPopulationSurvivalStreakMs += result.avgSurvivalStreakMs;
      generationPopulationSurvivalStreakCount++;
    }
    if (result.winner === 'chaser') generationPopulationChaserMatchWins++;
    else if (result.winner === 'evader') generationPopulationEvaderMatchWins++;
    else generationPopulationDraws++;
    recordMatchTelemetry(result);

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
      const result = runMatch(chaserControllers[evaluationIndex], opponent.controller, environmentSeed, { chaser: true, evader: false });
      chaserFitnessTotals[evaluationIndex] += result.chaserFitness;
      chaserFitnessCounts[evaluationIndex]++;
      recordMatchTelemetry(result, false);
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
    const result = runMatch(opponent.controller, evaderControllers[evaluationIndex], environmentSeed, { chaser: false, evader: true });
    evaderFitnessTotals[evaluationIndex] += result.evaderFitness;
    evaderFitnessCounts[evaluationIndex]++;
    recordMatchTelemetry(result, false);
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
  const matchDenominator = Math.max(1, generationPopulationMatches);
  const fallEvents = generationPopulationChaserFalls + generationPopulationEvaderFalls;
  const boutEvents = Math.max(1, generationPopulationTags + fallEvents);
  const tagsPer30s = generationPopulationTags * 30000 / Math.max(1, generationPopulationSimulatedMs);

  lastGenerationBalance = {
    generation: evaluatedGeneration,
    matches: generationPopulationMatches,
    tags: generationPopulationTags,
    matchesWithTag: generationPopulationMatchesWithTag,
    timeouts: generationPopulationTimeouts,
    chaserFalls: generationPopulationChaserFalls,
    evaderFalls: generationPopulationEvaderFalls,
    doubleFalls: generationPopulationDoubleFalls,
    tagRate: generationPopulationMatchesWithTag / matchDenominator,
    survivalRate: generationPopulationTimeouts / matchDenominator,
    fallRate: fallEvents / boutEvents,
    chaserWinRate: generationPopulationChaserMatchWins / matchDenominator,
    evaderWinRate: generationPopulationEvaderMatchWins / matchDenominator,
    drawRate: generationPopulationDraws / matchDenominator,
    tagsPer30s,
    avgTagsPerMatch: generationPopulationTags / matchDenominator,
    avgSurvivalStreakMs: generationPopulationSurvivalStreakCount > 0
      ? generationPopulationSurvivalStreakMs / generationPopulationSurvivalStreakCount
      : null,
    avgTagTimeMs: generationPopulationTagTimeCount > 0
      ? generationPopulationTagTimeMs / generationPopulationTagTimeCount
      : null,
  };

  const navigationScore = generationNavigationScoreTotal / matchDenominator;
  const fallTerminationRate = fallEvents / boutEvents;
  const curriculum = advanceCurriculum(curriculumState, { navigationScore, fallTerminationRate });
  lastCurriculumTelemetry = {
    ...curriculum,
    lastCourseSeed,
    lastCourseBranchCount,
    lastCourseMovingPlatforms,
    lastCourseCrumblingPlatforms,
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
    average(recentSurvivalTimes),
    {
      tags: totalTags,
      chaserFalls: totalChaserFallTerminations,
      evaderFalls: totalEvaderFallTerminations,
      timeouts: totalTimeouts,
      doubleFalls: totalDoubleFallTerminations,
      matches: totalMatches,
      chaserMatchWins: totalChaserMatchWins,
      evaderMatchWins: totalEvaderMatchWins,
      draws: totalMatchDraws,
    }
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
      curriculum: lastCurriculumTelemetry,
      hallOfFame: {
        chaserSize: hallOfFamePool(chaserHallOfFame).length,
        evaderSize: hallOfFamePool(evaderHallOfFame).length,
        maxSize: NEAT_HOF_MAX_SIZE,
        opponentsPerGenome: NEAT_HOF_OPPONENTS_PER_GENOME,
        chaserGenerations: hallOfFamePool(chaserHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
        evaderGenerations: hallOfFamePool(evaderHallOfFame).map(entry => entry.generation).sort((a, b) => a - b),
      },
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
      lastSampleGameState = null;
      clearHallOfFame();
      lastGenerationBalance = null;
      curriculumState = createCurriculumState();
      lastCurriculumTelemetry = curriculumSnapshot(curriculumState);
      lastCourseSeed = 0;
      lastCourseBranchCount = 0;
      lastCourseMovingPlatforms = 0;
      lastCourseCrumblingPlatforms = 0;
      resetEvaluationAccumulators();
      emitTelemetry();
      break;
  }
};
