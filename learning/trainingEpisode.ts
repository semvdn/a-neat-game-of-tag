import { EncounterTracker } from './encounters';
import type { LearningAgent } from './agent';
import { writeAgentStateVector } from './state';
import {
  advanceRoleTimers,
  maintainPlatformsForCamera,
  maintainPlatformsForCameraInPlace,
  resolveTagSwap,
  stepAgentPhysics,
  stepAgentPhysicsInPlace,
  updateChaseCameraX,
  stepMovingPlatformsInPlace,
  evaluateChaseEscape,
} from './simulationCore';
import type { ActiveUpgradeState, AgentState, GameState, PlatformState, PursuitDesignConfig, TerrainRuntimeConfig, TerrainVarietyConfig } from '../types';
import { AgentStatus } from '../types';
import { trainingTerrainRuntime, DEFAULT_TERRAIN_VARIETY_CONFIG } from './terrainConfig';
import { applyPlatformRoute, canAgentsPhysicallyInteract } from './terrainRoutes';
import {
  AGENT_COLORS,
  AGENT_WIDTH,
  AGENT_HEIGHT,
  JUMP_ENERGY_COST,
  MAX_ENERGY,
  NEAT_EPISODE_MAX_MS,
  PLATFORM_HEIGHT,
  SPRINT_ENERGY_COST_PER_SEC,
  SPRINT_MAX_SPEED,
  WORLD_REF_HEIGHT,
  WORLD_REF_WIDTH,
  ACTION_SPACE,
  STATE_VECTOR_SIZE,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
  RUNNER_PACE_WINDOW_MS,
  DEFAULT_RUNNER_PACE_TARGET_PX,
  DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW,
  DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM,
  CHASER_PURSUIT_REWARD_CAP_PER_WINDOW,
  RUNNER_PRESSURE_ESCAPE_REWARD,
  RUNNER_PRESSURE_ESCAPE_REWARD_CAP_PER_WINDOW,
  TAG_AFTER_RUNNER_FALL_WINDOW_MS,
} from '../constants';

const DT = 16.67;
const VISUAL_START_Y = 500;
const VISUAL_PLATFORM_ID_START = 10;

export interface TrainingEpisodeResult {
  chaserFitness: number;
  evaderFitness: number;
  /** True when at least one physical contact tag occurred during the scored match. */
  tagged: boolean;
  /** Number of physical contact tags during the match. */
  tags: number;
  /** Kept for backwards compatibility; records the first fall role during the match. */
  terminalFallRole: 'chaser' | 'evader' | null;
  chaserFalls: number;
  evaderFalls: number;
  /** Terminal chase failures caused by the group exceeding the minimum useful camera envelope. */
  chaserEscapes: number;
  /** True when this maximum-horizon match ended early because the Runner group escaped. */
  escaped: boolean;
  /** Reference-view zoom that would have been required at the escape boundary. */
  escapeRequiredZoom: number | null;
  /** Largest Chaser-to-Runner center distance on the escape frame. */
  escapeMaxSeparationPx: number;
  /** Sum of the current chaser's time-since-role-swap at each successful tag. */
  tagTimeTotalMs: number;
  /** Sum of the tagged runner's survival interval at each successful tag. */
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
  chaserDirectionConflictCount: number;
  evaderDirectionConflictCount: number;
  /** Fitness-bearing SAFE rightward progression, averaged across the two runner slots. */
  runnerFrontierExpansionPx: number;
  runnerFrontierExpansionViewports: number;
  runnerLeftFrontierExpansionPx: number;
  /** Raw rightward envelope movement for diagnostics; may include airborne movement not yet banked. */
  runnerRawRightFrontierExpansionPx: number;
  /** SAFE fitness-bearing rightward progression (averaged across the two runner slots). */
  runnerRightFrontierExpansionPx: number;
  /** Legacy diagnostic alias: safe rightward distance remains recorded but is no longer linear fitness. */
  runnerExplorationFitnessBonus: number;
  /** Capped minimum-pace fitness accumulated over 2-second windows. */
  runnerPaceFitnessBonus: number;
  /** Penalty for the unsatisfied fraction of each pace window. */
  runnerPaceShortfallPenalty: number;
  /** Small capped reward for escaping genuine close pressure without a tag or fall. */
  runnerPressureEscapeFitnessBonus: number;
  /** Small capped bootstrap for achieving a genuinely new best Chaser proximity. */
  chaserProximityFitnessBonus: number;
  runnerPaceCompletion: number;
  runnerPaceWindowsSatisfied: number;
  runnerPaceWindowsTotal: number;
  /** Small capped Chaser shaping for safely following Runner-visited platforms. */
  chaserPursuitFitnessBonus: number;
  chaserPursuitLandings: number;
  runnerPlatformLandings: number;
  chaserPlatformLandings: number;
  runnerBranchLandings: number;
  chaserBranchLandings: number;
  closeEncounters: number;
  /** Pressure exits without an intervening tag or either role falling (objective v10). */
  successfulEvades: number;
  meanNearestRunnerDistancePx: number;
  initialNearestRunnerDistancePx: number;
  minNearestRunnerDistancePx: number;
  timeWithin100Ms: number;
  timeWithin200Ms: number;
  timeWithin400Ms: number;
  tagsSoonAfterRunnerFall: number;
  /** Largest per-body SAFE rightward progression achieved during this scored episode. */
  runnerMaxFrontierExpansionPx: number;
  /** Optional compact behavior trace for user-requested diagnostic probes. */
  trace?: TrainingEpisodeTraceSample[];
}

export interface TrainingEpisodeTraceAgent {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: 'chaser' | 'evader';
  status: AgentStatus;
  cooldownMs: number;
  energy: number;
  action: string;
  moveLeft: number;
  moveRight: number;
  jump: number;
  sprint: number;
  directionConflict: boolean;
  jumpReady: boolean;
  grounded: boolean;
  platformId: number | null;
  platformStructure?: PlatformState['structureType'];
}

export interface TrainingEpisodeTraceSample {
  tMs: number;
  cameraX: number;
  runnerFrontierLeftX: number;
  runnerFrontierRightX: number;
  runnerFrontierExpansionPx: number;
  runnerPaceFitnessBonus: number;
  runnerPaceShortfallPenalty: number;
  runnerPressureEscapeFitnessBonus: number;
  chaserProximityFitnessBonus: number;
  chaserPursuitFitnessBonus: number;
  closeEncounters: number;
  successfulEvades: number;
  tags: number;
  chaserFalls: number;
  runnerFalls: number;
  platformMinX: number;
  platformMaxX: number;
  agents: TrainingEpisodeTraceAgent[];
}

export type TrainingStartMode = 'visual' | 'varied' | 'pressure' | 'pressure_close' | 'pressure_normal' | 'pressure_long' | 'midgame' | 'mixed';

export interface TrainingEpisodeOptions {
  trackChaserActions?: boolean;
  trackEvaderActions?: boolean;
  viewportSize?: { width: number; height: number };
  upgrades?: ActiveUpgradeState;
  /** visual = exact champion reset; varied = randomized fresh reset; midgame = deterministic real-game pre-roll snapshot; mixed = stochastic blend. */
  startMode?: TrainingStartMode;
  runnerPaceTargetPxPerWindow?: number;
  runnerPaceRewardPerWindow?: number;
  chaserPursuitRewardPerPlatform?: number;
  pursuitDesign?: PursuitDesignConfig;
  /** Per-episode terrain feature frequency and geometry controls. */
  terrainConfig?: TerrainVarietyConfig;
  /** Diagnostic-only trace recording; disabled during normal evolutionary evaluation. */
  recordTrace?: boolean;
  traceIntervalMs?: number;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeAgent(id: number, x: number, isChaser: boolean): AgentState {
  const role: 'chaser' | 'evader' = isChaser ? 'chaser' : 'evader';
  return {
    id,
    position: { x, y: VISUAL_START_Y },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    status: isChaser ? AgentStatus.It : AgentStatus.Normal,
    role,
    elo: 0,
    color: AGENT_COLORS[id - 1] || AGENT_COLORS[0],
    // The champion view starts all three bodies airborne at y=500 and lets them fall onto
    // the initial viewport-width ground platform. Training intentionally does the same.
    isOnGround: false,
    cooldownTimer: 0,
    lastAction: 'idle',
    energy: MAX_ENERGY,
    maxEnergy: MAX_ENERGY,
    trajectory: [{ x, y: VISUAL_START_Y, timestamp: 0 }],
    lastPlatformId: 0,
    scale: { x: 1, y: 1 },
    energyAtLastTakeoff: MAX_ENERGY,
    positionAtLastTakeoff: { x, y: VISUAL_START_Y },
    survivalTime: 0,
    timeSinceBecameIt: 0,
    modelId: isChaser ? 'current_chaser' : 'current_evader',
  };
}

/**
 * Training keeps the exact visual game's world setup as its anchor scenario, while exposing the
 * policies to nearby states that naturally occur later in the persistent game. No alternative
 * physics or special training-only platforms are introduced.
 */
function chooseFreshTrainingStart(
  rng: () => number,
  viewportWidth: number,
  mode: 'visual' | 'varied' | 'pressure' | 'pressure_close' | 'pressure_normal' | 'pressure_long'
): { positions: number[]; itId: number } {
  const visualPositions = [100, 400, 700];
  if (mode === 'visual') return { positions: visualPositions, itId: 1 };

  if (mode === 'pressure' || mode === 'pressure_close' || mode === 'pressure_normal' || mode === 'pressure_long') {
    // Pressure curriculum: retain random body identity for the Chaser while placing that role
    // behind both Runners. Gap categories follow the intended 40/30/20/10 chase distribution.
    const itId = 1 + Math.floor(rng() * 3);
    const roll = rng();
    const nearestGap = mode === 'pressure_close'
      ? 160 + rng() * 40
      : mode === 'pressure_normal'
        ? 275 + rng() * 50
        : mode === 'pressure_long'
          ? 375 + rng() * 50
          : roll < 0.40
            ? 220 + rng() * 80
            : roll < 0.70
              ? 140 + rng() * 80
              : roll < 0.90
                ? 300 + rng() * 80
                : 180 + rng() * 180;
    const chaserX = 90 + rng() * 100;
    const secondGap = 170 + rng() * 110;
    const runnerXs = [chaserX + nearestGap, chaserX + nearestGap + secondGap];
    const positions = new Array<number>(3);
    let runnerCursor = 0;
    for (let id = 1; id <= 3; id++) {
      positions[id - 1] = id === itId ? chaserX : runnerXs[runnerCursor++];
    }
    const maxX = Math.max(...positions);
    if (maxX > viewportWidth - 60) {
      const shift = maxX - (viewportWidth - 60);
      for (let i = 0; i < positions.length; i++) positions[i] = Math.max(40, positions[i] - shift);
    }
    return { positions, itId };
  }

  const scenario = rng();
  let positions: number[];
  if (scenario < 0.45) {
    // Same geometry as the visible reset, but any body can begin as It.
    positions = [...visualPositions];
  } else if (scenario < 0.65) {
    // Closer chase geometry: useful for learning immediate evasive/tag decisions.
    positions = [130, 330, 560];
  } else if (scenario < 0.82) {
    // Wide separation: stresses navigation and pursuit across the rolling level.
    positions = [80, 500, 900];
  } else if (scenario < 0.92) {
    // Edge-biased geometry exposes camera/platform ledge states without inventing a new arena.
    positions = [50, 470, 1060];
  } else {
    // Shifted cluster: removes reliance on the left edge/start-line as a role cue.
    positions = [250, 500, 760];
  }

  // Small deterministic jitter prevents memorizing a handful of exact coordinates while keeping
  // the same visual-game scale and a safe non-contact separation at t=0.
  positions = positions.map((x, index) => {
    const jitter = (rng() - 0.5) * 60;
    const minX = 40 + index * 120;
    const maxX = viewportWidth - 80 - (2 - index) * 120;
    return clamp(x + jitter, minX, maxX);
  });
  positions.sort((a, b) => a - b);
  for (let i = 1; i < positions.length; i++) {
    positions[i] = Math.max(positions[i], positions[i - 1] + 130);
  }
  const overflow = positions[positions.length - 1] - (viewportWidth - 60);
  if (overflow > 0) positions = positions.map(x => x - overflow);

  return { positions, itId: 1 + Math.floor(rng() * 3) };
}

interface EpisodeStartState {
  gameState: GameState;
  nextPlatformId: number;
}

const MIDGAME_CACHE_LIMIT = 64;
const midgameStartCache = new Map<string, EpisodeStartState>();

const MIDGAME_WARMUP_UPGRADES: ActiveUpgradeState = {
  sprint: false,
  controlledJump: false,
  sprintChaser: false,
  sprintRunner: false,
  controlledJumpChaser: false,
  controlledJumpRunner: false,
  sprintChaserMaxSpeed: SPRINT_MAX_SPEED,
  sprintRunnerMaxSpeed: SPRINT_MAX_SPEED,
  sprintChaserStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC,
  sprintRunnerStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC,
};

function cloneAgentState(agent: AgentState): AgentState {
  return {
    ...agent,
    position: { ...agent.position },
    velocity: { ...agent.velocity },
    acceleration: { ...agent.acceleration },
    trajectory: agent.trajectory.map(point => ({ ...point })),
    scale: { ...agent.scale },
    positionAtLastTakeoff: { ...agent.positionAtLastTakeoff },
  };
}

function cloneEpisodeStart(start: EpisodeStartState): EpisodeStartState {
  return {
    nextPlatformId: start.nextPlatformId,
    gameState: {
      ...start.gameState,
      agents: start.gameState.agents.map(cloneAgentState),
      platforms: start.gameState.platforms.map(platform => ({
        ...platform,
        position: { ...platform.position },
        motion: platform.motion ? { ...platform.motion } : undefined,
      })),
      cameraPosition: { ...start.gameState.cameraPosition },
      tagEffects: start.gameState.tagEffects.map(effect => ({
        ...effect,
        position: { ...effect.position },
      })),
    },
  };
}

function createFreshEpisodeState(
  rng: () => number,
  viewportSize: { width: number; height: number },
  mode: 'visual' | 'varied' | 'pressure' | 'pressure_close' | 'pressure_normal' | 'pressure_long'
): EpisodeStartState {
  const groundY = viewportSize.height - 100;
  const platforms: PlatformState[] = [
    // This exactly matches initializeGameState()/handleResetChampionGame() in App.tsx.
    { id: 0, position: { x: 0, y: groundY }, width: viewportSize.width, height: PLATFORM_HEIGHT },
  ];
  const start = chooseFreshTrainingStart(rng, viewportSize.width, mode);

  return {
    nextPlatformId: VISUAL_PLATFORM_ID_START,
    gameState: {
      agents: start.positions.map((x, index) => makeAgent(index + 1, x, index + 1 === start.itId)),
      platforms,
      cameraPosition: { x: 0, y: 0 },
      gameTime: 0,
      tagEffects: [],
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
    },
  };
}

function platformForAgent(agent: AgentState, platforms: PlatformState[]): PlatformState | null {
  for (let i = 0; i < platforms.length; i++) {
    if (platforms[i].id === agent.lastPlatformId) return platforms[i];
  }

  let best: PlatformState | null = null;
  let bestDistance = Infinity;
  const centerX = agent.position.x + AGENT_WIDTH / 2;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const center = platform.position.x + platform.width / 2;
    const dx = center - centerX;
    const dy = platform.position.y - (agent.position.y + AGENT_HEIGHT);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = platform;
      bestDistance = distance;
    }
  }
  return best;
}

function scriptedMidgameDecision(
  agent: AgentState,
  platforms: PlatformState[],
  step: number,
  phaseSalt: number
): { action: string; strength: number } {
  // The pre-roll deliberately uses only base move/jump behavior. This makes snapshots valid
  // regardless of whether Sprint/Controlled Jump are enabled for the evaluated generation.
  if (agent.isOnGround) {
    const platform = platformForAgent(agent, platforms);
    if (platform) {
      const rightEdgeDistance = platform.position.x + platform.width - (agent.position.x + AGENT_WIDTH);
      const jumpThreshold = 92 + ((agent.id * 19 + phaseSalt) % 38);
      if (rightEdgeDistance < jumpThreshold && agent.energy >= JUMP_ENERGY_COST) {
        return { action: 'jump', strength: 1 };
      }
    }
  }

  // Body-specific pauses spread the three agents across the rolling world instead of producing
  // three copies of the same scripted trajectory. They remain deterministic for a given seed.
  const cycle = (step + agent.id * 41 + phaseSalt) % (155 + agent.id * 17);
  if (cycle < 10 + agent.id * 4) return { action: 'idle', strength: 0 };
  return { action: 'move_right', strength: 0 };
}

function stepScriptedMidgameWorld(
  start: EpisodeStartState,
  viewportSize: { width: number; height: number },
  rng: () => number,
  step: number,
  phaseSalt: number,
  terrainRuntime: TerrainRuntimeConfig,
  forcedJumpId: number | null = null,
  settleOnly = false
): void {
  const gameState = start.gameState;
  gameState.gameTime += DT;
  advanceRoleTimers(gameState.agents, DT);
  stepMovingPlatformsInPlace(gameState.platforms, gameState.agents, DT);

  const agentsBeforePhysics = gameState.agents;
  gameState.agents = agentsBeforePhysics.map(agent => {
    let decision = settleOnly
      ? { action: 'idle', strength: 0 }
      : scriptedMidgameDecision(agent, gameState.platforms, step, phaseSalt);
    if (forcedJumpId === agent.id && agent.isOnGround && agent.energy >= JUMP_ENERGY_COST) {
      decision = { action: 'jump', strength: 1 };
    }
    return stepAgentPhysics(
      agent,
      agentsBeforePhysics,
      gameState.platforms,
      gameState.cameraPosition.x,
      viewportSize,
      DT,
      decision,
      MIDGAME_WARMUP_UPGRADES
    ).agent;
  });

  // Tags and falls during the pre-roll are genuine game transitions, but deliberately do not
  // contribute to evolutionary fitness; they only determine the state from which scoring begins.
  resolveTagSwap(gameState.agents);
  gameState.cameraPosition.x = updateChaseCameraX(
    gameState.agents,
    gameState.platforms,
    gameState.cameraPosition.x,
    viewportSize.width
  );
  const platformUpdate = maintainPlatformsForCamera(
    gameState.platforms,
    gameState.agents,
    gameState.cameraPosition.x,
    viewportSize,
    start.nextPlatformId,
    rng,
    undefined,
    terrainRuntime
  );
  gameState.platforms = platformUpdate.platforms;
  start.nextPlatformId = platformUpdate.nextPlatformId;
}


function placeRunnerFocusedMidgameState(
  start: EpisodeStartState,
  viewportSize: { width: number; height: number },
  rng: () => number,
  terrainRuntime: TerrainRuntimeConfig
): boolean {
  const allEligible = start.gameState.platforms
    .filter(platform => platform.id !== 0 && platform.width >= AGENT_WIDTH + 80)
    .sort((a, b) => a.position.x - b.position.x);
  const laterPlatforms = allEligible.filter(platform => platform.position.x > viewportSize.width * 0.72);
  const platforms = laterPlatforms.length >= 3 ? laterPlatforms : allEligible;
  if (platforms.length < 3) return false;

  const runners = start.gameState.agents.filter(agent => agent.status !== AgentStatus.It);
  const chaser = start.gameState.agents.find(agent => agent.status === AgentStatus.It);
  if (runners.length < 2 || !chaser) return false;

  // Prefer platforms several transitions into the generated world, but stay inside the currently
  // materialized procedural sequence. This deliberately exposes the runner policy to traversal
  // states it otherwise avoids by camping on platform 0.
  const minIndex = Math.min(1, platforms.length - 2);
  const maxBase = Math.max(minIndex, Math.min(platforms.length - 2, 5));
  const baseIndex = minIndex + Math.floor(rng() * (maxBase - minIndex + 1));
  const firstPlatform = platforms[baseIndex];
  const secondPlatform = platforms[Math.min(platforms.length - 1, baseIndex + 1 + Math.floor(rng() * Math.min(2, platforms.length - baseIndex - 1)))];

  const placeGrounded = (agent: AgentState, platform: PlatformState, fraction: number) => {
    const usable = Math.max(0, platform.width - AGENT_WIDTH - 24);
    const x = platform.position.x + 12 + usable * clamp(fraction, 0.05, 0.95);
    agent.position.x = x;
    agent.position.y = platform.position.y - AGENT_HEIGHT;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
    agent.acceleration.x = 0;
    agent.isOnGround = true;
    agent.lastPlatformId = platform.id;
    applyPlatformRoute(agent, platform);
    agent.positionAtLastTakeoff.x = x;
    agent.positionAtLastTakeoff.y = agent.position.y;
    agent.energyAtLastTakeoff = agent.energy;
  };

  // One runner begins around mid-platform, the other nearer the forward edge. This creates both
  // ordinary running and immediate platform-transition problems.
  placeGrounded(runners[0], firstPlatform, 0.45 + rng() * 0.2);
  placeGrounded(runners[1], secondPlatform, 0.70 + rng() * 0.18);

  const chaserPlatform = platforms[Math.max(0, baseIndex - 1)];
  placeGrounded(chaser, chaserPlatform, 0.45 + rng() * 0.2);

  const runnerCenter = (runners[0].position.x + runners[1].position.x + AGENT_WIDTH) / 2;
  start.gameState.cameraPosition.x = runnerCenter - viewportSize.width * 0.45;
  start.nextPlatformId = maintainPlatformsForCameraInPlace(
    start.gameState.platforms,
    start.gameState.agents,
    start.gameState.cameraPosition.x,
    viewportSize,
    start.nextPlatformId,
    rng,
    undefined,
    terrainRuntime
  );
  return true;
}

function createMidgameEpisodeState(
  seed: number,
  viewportSize: { width: number; height: number },
  terrainRuntime: TerrainRuntimeConfig
): EpisodeStartState {
  const terrainKey = [terrainRuntime.branchingEnabled ? 1 : 0, terrainRuntime.movingPlatformsEnabled ? 1 : 0, terrainRuntime.branchSpawnChance.toFixed(2), terrainRuntime.movingSpawnChance.toFixed(2), terrainRuntime.movingPlatformMaxSpeed.toFixed(0), terrainRuntime.maxPlatformsPerBranch, terrainRuntime.subBranchingEnabled ? 1 : 0, terrainRuntime.maxBranchDepth, terrainRuntime.movingPlatformsInBranches ? 1 : 0].join(',');
  const cacheKey = `${seed >>> 0}:${viewportSize.width}x${viewportSize.height}:${terrainKey}`;
  const cached = midgameStartCache.get(cacheKey);
  if (cached) return cloneEpisodeStart(cached);

  // Snapshot generation has its own deterministic random stream. Evaluated genomes therefore
  // receive an identical mid-game state for a shared seed, and the subsequent terrain RNG remains
  // independent of the scripted pre-roll.
  const rng = mulberry32(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  const start = createFreshEpisodeState(rng, viewportSize, 'varied');
  const phaseSalt = Math.floor(rng() * 100000);
  const warmupMs = 4200 + Math.floor(rng() * 4800); // 4.2-9.0 s of actual shared-game simulation.
  const warmupSteps = Math.max(1, Math.floor(warmupMs / DT));

  for (let step = 0; step < warmupSteps; step++) {
    stepScriptedMidgameWorld(start, viewportSize, rng, step, phaseSalt, terrainRuntime);
  }

  // Do not sample a random frame while a scripted body is simply plummeting through empty space.
  // First let every body complete its current jump/fall and reach a real landing or fair respawn.
  // This preserves the advanced procedural world/camera state while producing useful starts.
  let settleStep = 0;
  while (start.gameState.agents.some(agent => !agent.isOnGround) && settleStep < 240) {
    stepScriptedMidgameWorld(
      start,
      viewportSize,
      rng,
      warmupSteps + settleStep,
      phaseSalt,
      terrainRuntime,
      null,
      true
    );
    settleStep++;
  }

  const runnerFocused = rng() < 0.72 && placeRunnerFocusedMidgameState(start, viewportSize, rng, terrainRuntime);
  const flavor = rng();
  if (flavor < (runnerFocused ? 0.48 : 0.34)) {
    // A genuine jump-arc start. Runner-focused snapshots preferentially launch a runner from a
    // later procedural platform, while generic snapshots may launch any grounded body.
    const grounded = start.gameState.agents.filter(agent =>
      agent.isOnGround && agent.energy >= JUMP_ENERGY_COST && (!runnerFocused || agent.status !== AgentStatus.It)
    );
    if (grounded.length > 0) {
      const jumper = grounded[Math.floor(rng() * grounded.length)];
      const airborneSteps = 2 + Math.floor(rng() * 5);
      stepScriptedMidgameWorld(start, viewportSize, rng, warmupSteps + settleStep, phaseSalt, terrainRuntime, jumper.id, true);
      for (let i = 1; i < airborneSteps; i++) {
        stepScriptedMidgameWorld(start, viewportSize, rng, warmupSteps + settleStep + i, phaseSalt, terrainRuntime, null, true);
      }
    }
  } else if (!runnerFocused && flavor < 0.58) {
    // Immediate post-tag state. We form a physically valid contact on the chaser's current platform
    // and let the same resolveTagSwap() used by the visual game create both cooldown timers/roles.
    const itAgent = start.gameState.agents.find(agent => agent.status === AgentStatus.It);
    const taggableRunner = start.gameState.agents.find(
      agent => agent.id !== itAgent?.id && agent.status === AgentStatus.Normal && (agent.cooldownTimer || 0) <= 0
    );
    if (itAgent && taggableRunner && itAgent.isOnGround) {
      const platform = start.gameState.platforms.find(p => p.id === itAgent.lastPlatformId);
      if (platform) {
        const minX = platform.position.x + 18;
        const maxX = platform.position.x + platform.width - AGENT_WIDTH - 18;
        if (maxX >= minX) {
          const contactX = clamp(itAgent.position.x, minX, maxX);
          itAgent.position = { x: contactX, y: platform.position.y - AGENT_HEIGHT };
          itAgent.velocity = { x: 0, y: 0 };
          itAgent.isOnGround = true;
          itAgent.lastPlatformId = platform.id;
          applyPlatformRoute(itAgent, platform);
          itAgent.positionAtLastTakeoff = { ...itAgent.position };
          itAgent.cooldownTimer = 0;

          taggableRunner.position = { x: contactX, y: platform.position.y - AGENT_HEIGHT };
          taggableRunner.velocity = { x: 0, y: 0 };
          taggableRunner.isOnGround = true;
          taggableRunner.lastPlatformId = platform.id;
          applyPlatformRoute(taggableRunner, platform);
          taggableRunner.positionAtLastTakeoff = { ...taggableRunner.position };
          taggableRunner.cooldownTimer = 0;
          resolveTagSwap(start.gameState.agents);
        }
      }
    }
  }

  // Stamina is part of the real game state and can legitimately be partially depleted by earlier
  // jumps/sprinting. Add deterministic diversity without changing any physics or reward rule.
  for (const agent of start.gameState.agents) {
    const cap = 35 + rng() * 65;
    agent.energy = Math.min(agent.energy, cap);
    if (agent.isOnGround) agent.energyAtLastTakeoff = agent.energy;
  }

  // This snapshot becomes t=0 for evaluation/telemetry. Physical state, role, cooldown, stamina,
  // camera and procedural world are preserved, while timing metrics begin when scoring begins.
  start.gameState.gameTime = 0;
  for (const agent of start.gameState.agents) {
    agent.survivalTime = 0;
    agent.timeSinceBecameIt = 0;
    agent.trajectory = [{ ...agent.position, timestamp: 0 }];
  }

  const snapshot = cloneEpisodeStart(start);
  midgameStartCache.set(cacheKey, snapshot);
  if (midgameStartCache.size > MIDGAME_CACHE_LIMIT) {
    const oldestKey = midgameStartCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) midgameStartCache.delete(oldestKey);
  }
  return cloneEpisodeStart(snapshot);
}

function resolveTrainingStartMode(seed: number, requested: TrainingStartMode): Exclude<TrainingStartMode, 'mixed'> {
  if (requested !== 'mixed') return requested;
  const rng = mulberry32(((seed >>> 0) ^ 0xa511e9b3) >>> 0);
  const roll = rng();
  if (roll < 0.20) return 'visual';
  if (roll < 0.45) return 'varied';
  return 'midgame';
}

function createEpisodeState(
  seed: number,
  rng: () => number,
  viewportSize: { width: number; height: number },
  requestedMode: TrainingStartMode,
  terrainRuntime: TerrainRuntimeConfig
): EpisodeStartState {
  const mode = resolveTrainingStartMode(seed, requestedMode);
  if (mode === 'midgame') return createMidgameEpisodeState(seed, viewportSize, terrainRuntime);
  return createFreshEpisodeState(rng, viewportSize, mode);
}

/**
 * Headless scored evaluation driven by the same gameplay core as the visual simulation.
 * Episodes normally run to the configured horizon, but a camera-envelope escape is terminal.
 *
 * Differences are evaluation-only rather than gameplay differences:
 * - terrain randomness is seeded so every compared genome can see identical worlds;
 * - start role/spacing is varied across seeds, with the exact visual reset retained as an anchor;
 * - rendering, sounds, trails and explanatory reward telemetry are omitted.
 *
 * Fitness remains sparse: tags are competitive, falls are self-penalties, Runner progress is capped by pace windows, and Chaser traversal shaping is small and capped.
 */
export function runTrainingEpisode(
  chaser: Pick<LearningAgent, 'chooseActionInto' | 'resetState'>,
  evader: Pick<LearningAgent, 'chooseActionInto' | 'resetState'>,
  seed: number,
  options: TrainingEpisodeOptions = {}
): TrainingEpisodeResult {
  const viewportSize = options.viewportSize || { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT };
  const trackChaserActions = options.trackChaserActions !== false;
  const trackEvaderActions = options.trackEvaderActions !== false;
  chaser.resetState();
  evader.resetState();
  const rng = mulberry32(seed >>> 0);
  const terrainRuntime = trainingTerrainRuntime(options.terrainConfig || DEFAULT_TERRAIN_VARIETY_CONFIG, seed >>> 0);
  const episodeStart = createEpisodeState(seed, rng, viewportSize, options.startMode || 'mixed', terrainRuntime);
  const gameState = episodeStart.gameState;
  let nextPlatformId = episodeStart.nextPlatformId;

  const pursuitDesign = options.pursuitDesign;
  const baseUpgrades: ActiveUpgradeState = options.upgrades || {
    sprint: false,
    controlledJump: false,
    sprintChaser: false,
    sprintRunner: false,
    controlledJumpChaser: false,
    controlledJumpRunner: false,
    sprintChaserMaxSpeed: SPRINT_MAX_SPEED,
    sprintRunnerMaxSpeed: SPRINT_MAX_SPEED,
    sprintChaserStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC,
    sprintRunnerStaminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC,
  };
  const upgrades: ActiveUpgradeState = {
    ...baseUpgrades,
    chaserBaseMaxSpeed: pursuitDesign?.chaserBaseMaxSpeed ?? baseUpgrades.chaserBaseMaxSpeed,
    runnerBaseMaxSpeed: pursuitDesign?.runnerBaseMaxSpeed ?? baseUpgrades.runnerBaseMaxSpeed,
    sprintChaserMaxSpeed: pursuitDesign?.chaserSprintMaxSpeed ?? baseUpgrades.sprintChaserMaxSpeed,
    sprintRunnerMaxSpeed: pursuitDesign?.runnerSprintMaxSpeed ?? baseUpgrades.sprintRunnerMaxSpeed,
    sprintChaserStaminaCostPerSec: pursuitDesign?.chaserSprintStaminaCostPerSec ?? baseUpgrades.sprintChaserStaminaCostPerSec,
    sprintRunnerStaminaCostPerSec: pursuitDesign?.runnerSprintStaminaCostPerSec ?? baseUpgrades.sprintRunnerStaminaCostPerSec,
    postFallRunnerTagProtectionMs: pursuitDesign?.postFallRunnerTagProtectionMs ?? baseUpgrades.postFallRunnerTagProtectionMs,
  };

  let chaserFalls = 0;
  let evaderFalls = 0;
  let chaserEscapes = 0;
  let chaserEscapePenaltyEvents = 0;
  let escapeRequiredZoom: number | null = null;
  let escapeMaxSeparationPx = 0;
  let chaserJumps = 0;
  let evaderJumps = 0;
  let tags = 0;
  let tagTimeTotalMs = 0;
  let taggedSurvivalTimeTotalMs = 0;
  let firstFallRole: 'chaser' | 'evader' | null = null;

  // Exploration diagnostics still track the overall left/right territory envelope, but fitness is
  // based on per-body SAFE rightward progression. A runner can extend its safe frontier while
  // grounded, or bank airborne progress on a successful landing. Falling/respawn teleports never
  // receive credit. Per-body progress is averaged across the two runner slots.
  const runnerRoleActive = new Array<boolean>(gameState.agents.length).fill(false);
  const controllerRoleByBody = gameState.agents.map(agent => agent.status === AgentStatus.It ? 'chaser' as const : 'evader' as const);
  const runnerSafeRightX = new Array<number>(gameState.agents.length).fill(-Infinity);
  const runnerSafeRightExpansionByBody = new Array<number>(gameState.agents.length).fill(0);
  let runnerFrontierLeftX = Infinity;
  let runnerFrontierRightX = -Infinity;
  let runnerLeftFrontierExpansionPx = 0;
  let runnerRawRightFrontierExpansionPx = 0;
  for (let i = 0; i < gameState.agents.length; i++) {
    const agent = gameState.agents[i];
    if (agent.status === AgentStatus.It) continue;
    const centerX = agent.position.x + AGENT_WIDTH / 2;
    runnerRoleActive[i] = true;
    runnerSafeRightX[i] = centerX;
    runnerFrontierLeftX = Math.min(runnerFrontierLeftX, centerX);
    runnerFrontierRightX = Math.max(runnerFrontierRightX, centerX);
  }
  if (!Number.isFinite(runnerFrontierLeftX)) runnerFrontierLeftX = viewportSize.width * 0.5;
  if (!Number.isFinite(runnerFrontierRightX)) runnerFrontierRightX = viewportSize.width * 0.5;

  const runnerPaceTargetPx = Math.max(1, Number.isFinite(options.runnerPaceTargetPxPerWindow)
    ? Number(options.runnerPaceTargetPxPerWindow)
    : DEFAULT_RUNNER_PACE_TARGET_PX);
  const runnerPaceRewardPerWindow = Math.max(0, Number.isFinite(options.runnerPaceRewardPerWindow)
    ? Number(options.runnerPaceRewardPerWindow)
    : DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW);
  const chaserPursuitRewardPerPlatform = Math.max(0, Number.isFinite(options.chaserPursuitRewardPerPlatform)
    ? Number(options.chaserPursuitRewardPerPlatform)
    : DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM);
  const trace = options.recordTrace ? [] as TrainingEpisodeTraceSample[] : undefined;
  const traceIntervalMs = Math.max(DT, options.traceIntervalMs || 250);
  let nextTraceAtMs = 0;

  // Pace reward bookkeeping. Safe progress remains cumulative for diagnostics, but fitness is
  // settled in capped 2-second windows so running faster than the target gives no extra reward.
  const paceWindowStartExpansion = new Array<number>(gameState.agents.length).fill(0);
  let nextPaceWindowAtMs = RUNNER_PACE_WINDOW_MS;
  let runnerPaceFitnessBonus = 0;
  let runnerPaceShortfallPenalty = 0;
  let runnerPressureEscapeFitnessBonus = 0;
  let chaserProximityFitnessBonus = 0;
  let pressureEscapeBonusThisWindow = 0;
  let runnerPaceCompletionSum = 0;
  let runnerPaceWindowsSatisfied = 0;
  let runnerPaceWindowsTotal = 0;

  // Pursuit shaping rewards the Chaser only for first safe arrivals on terrain a Runner has already
  // occupied. It is capped every pace window and can never compete numerically with repeated tags.
  const runnerVisitedPlatformIds = new Set<number>();
  const chaserRewardedRunnerPlatformIds = new Set<number>();
  for (const agent of gameState.agents) {
    if (agent.status !== AgentStatus.It && agent.lastPlatformId != null) runnerVisitedPlatformIds.add(agent.lastPlatformId);
  }
  const previousPlatformIds = gameState.agents.map(agent => agent.lastPlatformId);
  let pursuitBonusThisWindow = 0;
  let chaserPursuitFitnessBonus = 0;
  let chaserPursuitLandings = 0;
  let runnerPlatformLandings = 0;
  let chaserPlatformLandings = 0;
  let runnerBranchLandings = 0;
  let chaserBranchLandings = 0;

  // Interaction diagnostics use distance hysteresis so one prolonged chase counts as one encounter.
  const encounterTracker = new EncounterTracker();
  let closeEncounters = 0;
  let successfulEvades = 0;
  let nearestRunnerDistanceAccum = 0;
  let nearestRunnerDistanceSamples = 0;
  let initialNearestRunnerDistancePx = Infinity;
  let minNearestRunnerDistancePx = Infinity;
  let timeWithin100Ms = 0;
  let timeWithin200Ms = 0;
  let timeWithin400Ms = 0;
  let tagsSoonAfterRunnerFall = 0;
  const lastRunnerFallAtMs = new Array<number>(gameState.agents.length).fill(-Infinity);
  let proximitySegmentChaserId: number | null = null;
  let proximitySegmentStartDistance = Infinity;
  let proximitySegmentBestDistance = Infinity;
  let proximitySegmentRewardEarned = 0;

  const chaserActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const evaderActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  let chaserDecisionCount = 0;
  let evaderDecisionCount = 0;
  let chaserIdleCount = 0;
  let evaderIdleCount = 0;
  let chaserDirectionConflictCount = 0;
  let evaderDirectionConflictCount = 0;
  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);
  // Hot-path buffers are reused for the whole episode: no per-decision state/action arrays.
  const stateBuffers = gameState.agents.map(() => new Float64Array(STATE_VECTOR_SIZE));
  const decisions = gameState.agents.map(() => ({
    action: 'idle',
    actionIndex: -1,
    actionStrength: 0,
    moveLeft: 0,
    moveRight: 0,
    horizontalDrive: 0,
    jump: 0,
    sprint: 0,
    directionConflict: false,
  }));
  // Fixed pre-physics body snapshots preserve the visual Array.map respawn semantics without
  // allocating three AgentState copies on every physics tick. Only id/position are read by respawn.
  const prePhysicsAgents = gameState.agents.map(cloneAgentState);
  const physicsResults = gameState.agents.map(agent => ({
    fell: false,
    jumped: false,
    jumpVelocity: 0,
    roleAtStep: (agent.status === AgentStatus.It ? 'chaser' : 'evader') as 'chaser' | 'evader',
  }));

  for (let step = 0; step < maxSteps; step++) {
    const chaserFallsBeforeStep = chaserFalls;
    gameState.gameTime += DT;
    advanceRoleTimers(gameState.agents, DT);
    stepMovingPlatformsInPlace(gameState.platforms, gameState.agents, DT);

    // Decisions are made before cooldown expiry/physics, exactly as in the visible update loop.
    for (let i = 0; i < gameState.agents.length; i++) {
      const agent = gameState.agents[i];
      const isChaserRole = agent.status === AgentStatus.It;
      agent.role = isChaserRole ? 'chaser' : 'evader';
      agent.modelId = isChaserRole ? 'current_chaser' : 'current_evader';

      if (isChaserRole) {
        runnerRoleActive[i] = false;
      } else if (!runnerRoleActive[i]) {
        // Newly-entered runner role: absorb any position reached as Chaser into the safe baseline
        // with zero reward, so role switching cannot manufacture exploration fitness.
        const centerX = agent.position.x + AGENT_WIDTH / 2;
        runnerFrontierLeftX = Math.min(runnerFrontierLeftX, centerX);
        runnerFrontierRightX = Math.max(runnerFrontierRightX, centerX);
        runnerSafeRightX[i] = Math.max(runnerSafeRightX[i], centerX);
        runnerRoleActive[i] = true;
      }

      const controllerRole = isChaserRole ? 'chaser' as const : 'evader' as const;
      const controller = isChaserRole ? chaser : evader;
      if (controllerRoleByBody[i] !== controllerRole) {
        controller.resetState(agent.id);
        controllerRoleByBody[i] = controllerRole;
      }
      const state = writeAgentStateVector(agent, gameState, viewportSize, stateBuffers[i]);
      const decision = controller.chooseActionInto(state, decisions[i], agent.id);

      let activeControls = 0;
      const horizontalDrive = decision.moveRight - decision.moveLeft;
      const movementIndex = horizontalDrive > POLICY_CONTROL_ACTIVE_THRESHOLD
        ? 1
        : horizontalDrive < -POLICY_CONTROL_ACTIVE_THRESHOLD
          ? 0
          : -1;
      if (movementIndex >= 0) {
        activeControls++;
        if (isChaserRole) {
          if (trackChaserActions) chaserActionCounts[movementIndex]++;
        } else if (trackEvaderActions) {
          evaderActionCounts[movementIndex]++;
        }
      }
      if (decision.jump >= POLICY_CONTROL_ACTIVE_THRESHOLD) {
        activeControls++;
        if (isChaserRole) { if (trackChaserActions) chaserActionCounts[2]++; }
        else if (trackEvaderActions) evaderActionCounts[2]++;
      }
      const sprintEnabledForRole = upgrades.sprint && (isChaserRole ? upgrades.sprintChaser : upgrades.sprintRunner);
      const effectiveSprint = sprintEnabledForRole &&
        Math.abs(horizontalDrive) >= POLICY_CONTROL_ACTIVE_THRESHOLD &&
        decision.sprint >= POLICY_CONTROL_ACTIVE_THRESHOLD &&
        agent.energy > 0;
      if (effectiveSprint) {
        activeControls++;
        if (isChaserRole) { if (trackChaserActions) chaserActionCounts[3]++; }
        else if (trackEvaderActions) evaderActionCounts[3]++;
      }
      if (isChaserRole) {
        if (trackChaserActions) {
          chaserDecisionCount++;
          if (activeControls === 0) chaserIdleCount++;
          if (decision.directionConflict) chaserDirectionConflictCount++;
        }
      } else if (trackEvaderActions) {
        evaderDecisionCount++;
        if (activeControls === 0) evaderIdleCount++;
        if (decision.directionConflict) evaderDirectionConflictCount++;
      }
    }

    // Preserve all pre-step body positions before mutating any body. This is the only state
    // fair respawn needs from the old Array.map snapshot, and the buffers are reused every tick.
    for (let i = 0; i < gameState.agents.length; i++) {
      const source = gameState.agents[i];
      const snapshot = prePhysicsAgents[i];
      snapshot.id = source.id;
      snapshot.position.x = source.position.x;
      snapshot.position.y = source.position.y;
    }

    for (let i = 0; i < gameState.agents.length; i++) {
      const agent = gameState.agents[i];
      const decision = decisions[i];
      const physics = stepAgentPhysicsInPlace(
        agent,
        prePhysicsAgents,
        gameState.platforms,
        gameState.cameraPosition.x,
        viewportSize,
        DT,
        decision,
        upgrades,
        physicsResults[i]
      );

      if (physics.jumped) {
        if (physics.roleAtStep === 'chaser') chaserJumps++;
        else evaderJumps++;
      }
      if (physics.fell) {
        if (!firstFallRole) firstFallRole = physics.roleAtStep;
        if (physics.roleAtStep === 'chaser') chaserFalls++;
        else {
          evaderFalls++;
          lastRunnerFallAtMs[i] = gameState.gameTime;
        }
      }

      const landedOnNewPlatform = !physics.fell && agent.isOnGround && agent.lastPlatformId != null && agent.lastPlatformId !== previousPlatformIds[i];
      if (landedOnNewPlatform) {
        const platform = gameState.platforms.find(p => p.id === agent.lastPlatformId);
        const isBranch = platform?.structureType === 'branch-upper' || platform?.structureType === 'branch-lower';
        if (physics.roleAtStep === 'evader') {
          runnerPlatformLandings++;
          if (isBranch) runnerBranchLandings++;
        } else {
          chaserPlatformLandings++;
          if (isBranch) chaserBranchLandings++;
          if (
            runnerVisitedPlatformIds.has(agent.lastPlatformId) &&
            !chaserRewardedRunnerPlatformIds.has(agent.lastPlatformId) &&
            pursuitBonusThisWindow < CHASER_PURSUIT_REWARD_CAP_PER_WINDOW
          ) {
            const reward = Math.min(
              chaserPursuitRewardPerPlatform,
              CHASER_PURSUIT_REWARD_CAP_PER_WINDOW - pursuitBonusThisWindow
            );
            pursuitBonusThisWindow += reward;
            chaserPursuitFitnessBonus += reward;
            chaserPursuitLandings++;
            chaserRewardedRunnerPlatformIds.add(agent.lastPlatformId);
          }
        }
      }

      if (physics.roleAtStep === 'evader') {
        const centerX = agent.position.x + AGENT_WIDTH / 2;

        // Raw left/right envelope stays diagnostic-only and may include successful airborne travel.
        if (!physics.fell && centerX < runnerFrontierLeftX) {
          runnerLeftFrontierExpansionPx += runnerFrontierLeftX - centerX;
          runnerFrontierLeftX = centerX;
        } else if (!physics.fell && centerX > runnerFrontierRightX) {
          runnerRawRightFrontierExpansionPx += centerX - runnerFrontierRightX;
          runnerFrontierRightX = centerX;
        }

        if (physics.fell) {
          // Respawn may teleport forward. Rebase without reward. A backward respawn retains the old
          // safe frontier, so the runner must genuinely re-traverse that ground before earning more.
          runnerSafeRightX[i] = Math.max(runnerSafeRightX[i], centerX);
          runnerFrontierLeftX = Math.min(runnerFrontierLeftX, centerX);
          runnerFrontierRightX = Math.max(runnerFrontierRightX, centerX);
        } else if (agent.isOnGround && centerX > runnerSafeRightX[i]) {
          // Grounded running banks continuously; an airborne traverse banks only on the first frame
          // of a successful landing. Airborne progress that ends in a fall never reaches this branch.
          const expansion = centerX - runnerSafeRightX[i];
          runnerSafeRightX[i] = centerX;
          runnerSafeRightExpansionByBody[i] += expansion;
        }
        if (agent.isOnGround && agent.lastPlatformId != null) runnerVisitedPlatformIds.add(agent.lastPlatformId);
      }
      previousPlatformIds[i] = agent.lastPlatformId;
    }

    // Escape is a real Chaser failure, not a presentation workaround. If keeping the complete
    // chase group visible would require shrinking below the minimum useful reference zoom, the
    // Runners have escaped. End this scored chase immediately so the Chaser cannot recover fitness
    // by farming later tags after losing contact with the level.
    const escapeEvaluation = evaluateChaseEscape(gameState.agents);
    if (escapeEvaluation.escaped) {
      chaserEscapes++;
      // A fall that itself creates the terminal separation is already a -20 Chaser event. Do not
      // charge a second -20 on the same physics frame; the escape still terminates and is logged.
      if (chaserFalls === chaserFallsBeforeStep) chaserEscapePenaltyEvents++;
      escapeRequiredZoom = escapeEvaluation.requiredReferenceZoom;
      escapeMaxSeparationPx = escapeEvaluation.maxChaserRunnerDistancePx;
      encounterTracker.reset();
      break;
    }

    // Measure actual chase interaction before a tag can swap roles this frame.
    let chaserBody: AgentState | null = null;
    for (const agent of gameState.agents) if (agent.status === AgentStatus.It) { chaserBody = agent; break; }
    let nearestRunnerDistance = Infinity;
    if (chaserBody) {
      const cx = chaserBody.position.x + AGENT_WIDTH / 2;
      const cy = chaserBody.position.y + AGENT_HEIGHT / 2;
      for (const agent of gameState.agents) {
        if (agent.status === AgentStatus.It || !canAgentsPhysicallyInteract(chaserBody, agent)) continue;
        const dx = agent.position.x + AGENT_WIDTH / 2 - cx;
        const dy = agent.position.y + AGENT_HEIGHT / 2 - cy;
        nearestRunnerDistance = Math.min(nearestRunnerDistance, Math.hypot(dx, dy));
      }
    }
    if (Number.isFinite(nearestRunnerDistance)) {
      if (!Number.isFinite(initialNearestRunnerDistancePx)) initialNearestRunnerDistancePx = nearestRunnerDistance;
      minNearestRunnerDistancePx = Math.min(minNearestRunnerDistancePx, nearestRunnerDistance);
      nearestRunnerDistanceAccum += nearestRunnerDistance;
      if (pursuitDesign?.chaserProximityProgressReward && chaserBody) {
        const resetSegment = proximitySegmentChaserId !== chaserBody.id || chaserFalls > chaserFallsBeforeStep;
        if (resetSegment || !Number.isFinite(proximitySegmentStartDistance)) {
          proximitySegmentChaserId = chaserBody.id;
          proximitySegmentStartDistance = nearestRunnerDistance;
          proximitySegmentBestDistance = nearestRunnerDistance;
          proximitySegmentRewardEarned = 0;
        } else if (nearestRunnerDistance < proximitySegmentBestDistance) {
          proximitySegmentBestDistance = nearestRunnerDistance;
          const stepPx = Math.max(1, pursuitDesign.chaserProximityStepPx ?? 50);
          const rewardPerStep = Math.max(0, pursuitDesign.chaserProximityRewardPerStep ?? 1);
          const cap = Math.max(0, pursuitDesign.chaserProximityRewardCapPerSegment ?? 6);
          const earnedTarget = Math.min(
            cap,
            Math.floor(Math.max(0, proximitySegmentStartDistance - proximitySegmentBestDistance) / stepPx) * rewardPerStep
          );
          if (earnedTarget > proximitySegmentRewardEarned) {
            chaserProximityFitnessBonus += earnedTarget - proximitySegmentRewardEarned;
            proximitySegmentRewardEarned = earnedTarget;
          }
        }
      }
      nearestRunnerDistanceSamples++;
      if (nearestRunnerDistance <= 100) timeWithin100Ms += DT;
      if (nearestRunnerDistance <= 200) timeWithin200Ms += DT;
      if (nearestRunnerDistance <= 400) timeWithin400Ms += DT;
    }
    const encounter = encounterTracker.step(nearestRunnerDistance, chaserFalls + evaderFalls);
    if (encounter === 'entered') closeEncounters++;
    if (encounter === 'evaded') {
      successfulEvades++;
      const episodePressureCap = pursuitDesign?.runnerPressureEscapeEpisodeCap ?? Infinity;
      const reward = Math.max(0, Math.min(
        RUNNER_PRESSURE_ESCAPE_REWARD,
        RUNNER_PRESSURE_ESCAPE_REWARD_CAP_PER_WINDOW - pressureEscapeBonusThisWindow,
        episodePressureCap - runnerPressureEscapeFitnessBonus
      ));
      pressureEscapeBonusThisWindow += reward;
      runnerPressureEscapeFitnessBonus += reward;
    }

    const tagTransition = resolveTagSwap(gameState.agents);
    if (tagTransition) {
      tags++;
      tagTimeTotalMs += tagTransition.timeToTagMs;
      taggedSurvivalTimeTotalMs += tagTransition.survivalTimeMs;
      const taggedIndex = gameState.agents.findIndex(agent => agent.id === tagTransition.taggedId);
      if (taggedIndex >= 0) {
        if (gameState.gameTime - lastRunnerFallAtMs[taggedIndex] <= TAG_AFTER_RUNNER_FALL_WINDOW_MS) {
          tagsSoonAfterRunnerFall++;
        }
        // Attribute at most one subsequent tag to a particular fall/respawn.
        lastRunnerFallAtMs[taggedIndex] = -Infinity;
      }
      encounterTracker.reset();
    }

    // Settle the capped pace window after all safe progress for this frame has been banked.
    if (gameState.gameTime + 1e-6 >= nextPaceWindowAtMs) {
      let safeProgressThisWindow = 0;
      for (let i = 0; i < runnerSafeRightExpansionByBody.length; i++) {
        safeProgressThisWindow += Math.max(0, runnerSafeRightExpansionByBody[i] - paceWindowStartExpansion[i]);
        paceWindowStartExpansion[i] = runnerSafeRightExpansionByBody[i];
      }
      const averageRunnerProgress = safeProgressThisWindow / 2;
      const completion = Math.min(1, averageRunnerProgress / runnerPaceTargetPx);
      runnerPaceFitnessBonus += completion * runnerPaceRewardPerWindow;
      // The pace target is a requirement, not merely an optional bonus. With bonus-only shaping a
      // stationary Runner can sit on the +100 fitness baseline, avoid falls, and outperform agents
      // that actually attempt the level. Missing a window therefore carries a modest shortfall cost
      // (2/3 of the configured full-window reward at zero completion), while satisfying the target
      // still tops out at the same positive reward.
      runnerPaceShortfallPenalty += (1 - completion) * runnerPaceRewardPerWindow * (2 / 3);
      runnerPaceCompletionSum += completion;
      runnerPaceWindowsTotal++;
      if (completion >= 0.999) runnerPaceWindowsSatisfied++;
      pursuitBonusThisWindow = 0;
      pressureEscapeBonusThisWindow = 0;
      nextPaceWindowAtMs += RUNNER_PACE_WINDOW_MS;
    }

    gameState.cameraPosition.x = updateChaseCameraX(
      gameState.agents,
      gameState.platforms,
      gameState.cameraPosition.x,
      viewportSize.width
    );

    nextPlatformId = maintainPlatformsForCameraInPlace(
      gameState.platforms,
      gameState.agents,
      gameState.cameraPosition.x,
      viewportSize,
      nextPlatformId,
      rng,
      pursuitDesign?.branchStructureMinX,
      terrainRuntime
    );

    if (trace && gameState.gameTime + 1e-6 >= nextTraceAtMs) {
      let platformMinX = Infinity;
      let platformMaxX = -Infinity;
      for (const platform of gameState.platforms) {
        platformMinX = Math.min(platformMinX, platform.position.x);
        platformMaxX = Math.max(platformMaxX, platform.position.x + platform.width);
      }
      trace.push({
        tMs: gameState.gameTime,
        cameraX: gameState.cameraPosition.x,
        runnerFrontierLeftX,
        runnerFrontierRightX,
        runnerFrontierExpansionPx: runnerSafeRightExpansionByBody.reduce((sum, value) => sum + value, 0) / 2,
        runnerPaceFitnessBonus,
        runnerPaceShortfallPenalty,
        runnerPressureEscapeFitnessBonus,
        chaserProximityFitnessBonus,
        chaserPursuitFitnessBonus,
        closeEncounters,
        successfulEvades,
        tags,
        chaserFalls,
        runnerFalls: evaderFalls,
        platformMinX: Number.isFinite(platformMinX) ? platformMinX : 0,
        platformMaxX: Number.isFinite(platformMaxX) ? platformMaxX : 0,
        agents: gameState.agents.map(agent => ({
          id: agent.id,
          x: agent.position.x,
          y: agent.position.y,
          vx: agent.velocity.x,
          vy: agent.velocity.y,
          role: agent.status === AgentStatus.It ? 'chaser' : 'evader',
          status: agent.status,
          cooldownMs: agent.cooldownTimer || 0,
          energy: agent.energy,
          action: agent.lastAction,
          moveLeft: decisions[gameState.agents.indexOf(agent)]?.moveLeft || 0,
          moveRight: decisions[gameState.agents.indexOf(agent)]?.moveRight || 0,
          jump: decisions[gameState.agents.indexOf(agent)]?.jump || 0,
          sprint: decisions[gameState.agents.indexOf(agent)]?.sprint || 0,
          directionConflict: decisions[gameState.agents.indexOf(agent)]?.directionConflict || false,
          jumpReady: agent.jumpArmed !== false,
          grounded: agent.isOnGround,
          platformId: agent.lastPlatformId,
          platformStructure: gameState.platforms.find(p => p.id === agent.lastPlatformId)?.structureType,
        })),
      });
      nextTraceAtMs += traceIntervalMs;
    }
  }

  // Tags are the only directly competitive event. A fall penalizes only the controller
  // responsible for that role at the time of the fall; it never grants fitness to the opponent.
  // This prevents either population from succeeding merely because its opponent platformed badly.
  const chaserEventScore = tags - chaserFalls - chaserEscapePenaltyEvents;
  const evaderEventScore = -tags - evaderFalls;
  const FITNESS_BASE = 100;
  const FITNESS_PER_EVENT = 20;
  const safeRightTotalPx = runnerSafeRightExpansionByBody.reduce((sum, value) => sum + value, 0);
  const runnerFrontierExpansionPx = safeRightTotalPx / 2;
  const runnerRightFrontierExpansionPx = runnerFrontierExpansionPx;
  const runnerFrontierExpansionViewports = runnerFrontierExpansionPx / Math.max(1, viewportSize.width);
  // Kept as a zero-valued legacy field so older analysis consumers do not mistake distance for fitness.
  const runnerExplorationFitnessBonus = 0;
  const runnerMaxFrontierExpansionPx = Math.max(0, ...runnerSafeRightExpansionByBody);
  const runnerPaceCompletion = runnerPaceWindowsTotal > 0 ? runnerPaceCompletionSum / runnerPaceWindowsTotal : 0;
  const meanNearestRunnerDistancePx = nearestRunnerDistanceSamples > 0
    ? nearestRunnerDistanceAccum / nearestRunnerDistanceSamples
    : 0;
  const chaserFitness = FITNESS_BASE + chaserEventScore * FITNESS_PER_EVENT + chaserPursuitFitnessBonus + chaserProximityFitnessBonus;
  const evaderFitness = FITNESS_BASE + evaderEventScore * FITNESS_PER_EVENT + runnerPaceFitnessBonus - runnerPaceShortfallPenalty + runnerPressureEscapeFitnessBonus;

  return {
    chaserFitness,
    evaderFitness,
    tagged: tags > 0,
    tags,
    terminalFallRole: firstFallRole,
    chaserFalls,
    evaderFalls,
    chaserEscapes,
    escaped: chaserEscapes > 0,
    escapeRequiredZoom,
    escapeMaxSeparationPx,
    tagTimeTotalMs,
    taggedSurvivalTimeTotalMs,
    elapsedMs: gameState.gameTime,
    falls: chaserFalls + evaderFalls,
    jumps: chaserJumps + evaderJumps,
    chaserActionCounts,
    evaderActionCounts,
    chaserDecisionCount,
    evaderDecisionCount,
    chaserIdleCount,
    evaderIdleCount,
    chaserDirectionConflictCount,
    evaderDirectionConflictCount,
    runnerFrontierExpansionPx,
    runnerFrontierExpansionViewports,
    runnerLeftFrontierExpansionPx,
    runnerRawRightFrontierExpansionPx,
    runnerRightFrontierExpansionPx,
    runnerExplorationFitnessBonus,
    runnerPaceFitnessBonus,
    runnerPaceShortfallPenalty,
    runnerPressureEscapeFitnessBonus,
    chaserProximityFitnessBonus,
    runnerPaceCompletion,
    runnerPaceWindowsSatisfied,
    runnerPaceWindowsTotal,
    chaserPursuitFitnessBonus,
    chaserPursuitLandings,
    runnerPlatformLandings,
    chaserPlatformLandings,
    runnerBranchLandings,
    chaserBranchLandings,
    closeEncounters,
    successfulEvades,
    meanNearestRunnerDistancePx,
    initialNearestRunnerDistancePx: Number.isFinite(initialNearestRunnerDistancePx) ? initialNearestRunnerDistancePx : 0,
    minNearestRunnerDistancePx: Number.isFinite(minNearestRunnerDistancePx) ? minNearestRunnerDistancePx : 0,
    timeWithin100Ms,
    timeWithin200Ms,
    timeWithin400Ms,
    tagsSoonAfterRunnerFall,
    runnerMaxFrontierExpansionPx,
    trace,
  };
}
