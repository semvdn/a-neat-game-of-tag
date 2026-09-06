import { LearningAgent } from './agent';
import { writeAgentStateVector } from './state';
import {
  advanceRoleTimers,
  maintainPlatformsForCamera,
  maintainPlatformsForCameraInPlace,
  resolveTagSwap,
  stepAgentPhysics,
  stepAgentPhysicsInPlace,
  updateRunnerCameraX,
} from './simulationCore';
import type { ActiveUpgradeState, AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
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
  DEFAULT_RUNNER_EXPLORATION_REWARD_PER_VIEWPORT,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
} from '../constants';

const DT = 16.67;
const VISUAL_START_Y = 500;
const VISUAL_PLATFORM_ID_START = 10;

export interface TrainingEpisodeResult {
  chaserFitness: number;
  evaderFitness: number;
  /** True when at least one physical contact tag occurred during the fixed-horizon match. */
  tagged: boolean;
  /** Number of physical contact tags during the match. */
  tags: number;
  /** Kept for backwards compatibility; records the first fall role during the match. */
  terminalFallRole: 'chaser' | 'evader' | null;
  chaserFalls: number;
  evaderFalls: number;
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
  /** Fitness-bearing SAFE rightward progression, averaged across the two runner slots. */
  runnerFrontierExpansionPx: number;
  runnerFrontierExpansionViewports: number;
  runnerLeftFrontierExpansionPx: number;
  /** Raw rightward envelope movement for diagnostics; may include airborne movement not yet banked. */
  runnerRawRightFrontierExpansionPx: number;
  /** SAFE fitness-bearing rightward progression (averaged across the two runner slots). */
  runnerRightFrontierExpansionPx: number;
  /** Fitness contribution from runner frontier expansion. Chaser fitness never receives this bonus. */
  runnerExplorationFitnessBonus: number;
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
  grounded: boolean;
  platformId: number | null;
}

export interface TrainingEpisodeTraceSample {
  tMs: number;
  cameraX: number;
  runnerFrontierLeftX: number;
  runnerFrontierRightX: number;
  runnerFrontierExpansionPx: number;
  tags: number;
  chaserFalls: number;
  runnerFalls: number;
  platformMinX: number;
  platformMaxX: number;
  agents: TrainingEpisodeTraceAgent[];
}

export type TrainingStartMode = 'visual' | 'varied' | 'midgame' | 'mixed';

export interface TrainingEpisodeOptions {
  trackChaserActions?: boolean;
  trackEvaderActions?: boolean;
  viewportSize?: { width: number; height: number };
  upgrades?: ActiveUpgradeState;
  /** visual = exact champion reset; varied = randomized fresh reset; midgame = deterministic real-game pre-roll snapshot; mixed = stochastic blend. */
  startMode?: TrainingStartMode;
  /** Runner exploration reward in fitness points per logical viewport of SAFE per-runner rightward progression. */
  runnerExplorationRewardPerViewport?: number;
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
  mode: 'visual' | 'varied'
): { positions: number[]; itId: number } {
  const visualPositions = [100, 400, 700];
  if (mode === 'visual') return { positions: visualPositions, itId: 1 };

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
  mode: 'visual' | 'varied'
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
  forcedJumpId: number | null = null,
  settleOnly = false
): void {
  const gameState = start.gameState;
  gameState.gameTime += DT;
  advanceRoleTimers(gameState.agents, DT);

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
  gameState.cameraPosition.x = updateRunnerCameraX(
    gameState.agents,
    gameState.cameraPosition.x,
    viewportSize.width
  );
  const platformUpdate = maintainPlatformsForCamera(
    gameState.platforms,
    gameState.agents,
    gameState.cameraPosition.x,
    viewportSize,
    start.nextPlatformId,
    rng
  );
  gameState.platforms = platformUpdate.platforms;
  start.nextPlatformId = platformUpdate.nextPlatformId;
}


function placeRunnerFocusedMidgameState(
  start: EpisodeStartState,
  viewportSize: { width: number; height: number },
  rng: () => number
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
    rng
  );
  return true;
}

function createMidgameEpisodeState(
  seed: number,
  viewportSize: { width: number; height: number }
): EpisodeStartState {
  const cacheKey = `${seed >>> 0}:${viewportSize.width}x${viewportSize.height}`;
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
    stepScriptedMidgameWorld(start, viewportSize, rng, step, phaseSalt);
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
      null,
      true
    );
    settleStep++;
  }

  const runnerFocused = rng() < 0.72 && placeRunnerFocusedMidgameState(start, viewportSize, rng);
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
      stepScriptedMidgameWorld(start, viewportSize, rng, warmupSteps + settleStep, phaseSalt, jumper.id, true);
      for (let i = 1; i < airborneSteps; i++) {
        stepScriptedMidgameWorld(start, viewportSize, rng, warmupSteps + settleStep + i, phaseSalt, null, true);
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
          itAgent.positionAtLastTakeoff = { ...itAgent.position };
          itAgent.cooldownTimer = 0;

          taggableRunner.position = { x: contactX, y: platform.position.y - AGENT_HEIGHT };
          taggableRunner.velocity = { x: 0, y: 0 };
          taggableRunner.isOnGround = true;
          taggableRunner.lastPlatformId = platform.id;
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
  requestedMode: TrainingStartMode
): EpisodeStartState {
  const mode = resolveTrainingStartMode(seed, requestedMode);
  if (mode === 'midgame') return createMidgameEpisodeState(seed, viewportSize);
  return createFreshEpisodeState(rng, viewportSize, mode);
}

/**
 * Fixed-horizon headless evaluation driven by the same gameplay core as the visual simulation.
 *
 * Differences are evaluation-only rather than gameplay differences:
 * - terrain randomness is seeded so every compared genome can see identical worlds;
 * - start role/spacing is varied across seeds, with the exact visual reset retained as an anchor;
 * - rendering, sounds, trails and explanatory reward telemetry are omitted.
 *
 * Fitness remains sparse: tags are competitive, falls are self-penalties, and runners receive a non-farmable bonus only when they expand the horizontal world frontier.
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
  const rng = mulberry32(seed >>> 0);
  const episodeStart = createEpisodeState(seed, rng, viewportSize, options.startMode || 'mixed');
  const gameState = episodeStart.gameState;
  let nextPlatformId = episodeStart.nextPlatformId;

  const upgrades: ActiveUpgradeState = options.upgrades || {
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

  let chaserFalls = 0;
  let evaderFalls = 0;
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

  const explorationRewardPerViewport = Math.max(
    0,
    Number.isFinite(options.runnerExplorationRewardPerViewport)
      ? Number(options.runnerExplorationRewardPerViewport)
      : DEFAULT_RUNNER_EXPLORATION_REWARD_PER_VIEWPORT
  );
  const trace = options.recordTrace ? [] as TrainingEpisodeTraceSample[] : undefined;
  const traceIntervalMs = Math.max(DT, options.traceIntervalMs || 250);
  let nextTraceAtMs = 0;

  const chaserActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const evaderActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  let chaserDecisionCount = 0;
  let evaderDecisionCount = 0;
  let chaserIdleCount = 0;
  let evaderIdleCount = 0;
  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);
  // Hot-path buffers are reused for the whole episode: no per-decision state/action arrays.
  const stateBuffers = gameState.agents.map(() => new Float64Array(STATE_VECTOR_SIZE));
  const decisions = gameState.agents.map(() => ({
    action: 'idle',
    actionIndex: -1,
    actionStrength: 0,
    moveLeft: 0,
    moveRight: 0,
    jump: 0,
    sprint: 0,
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
    gameState.gameTime += DT;
    advanceRoleTimers(gameState.agents, DT);

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

      const controller = isChaserRole ? chaser : evader;
      const state = writeAgentStateVector(agent, gameState, viewportSize, stateBuffers[i]);
      const decision = controller.chooseActionInto(state, decisions[i]);

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
      if (decision.sprint >= POLICY_CONTROL_ACTIVE_THRESHOLD) {
        activeControls++;
        if (isChaserRole) { if (trackChaserActions) chaserActionCounts[3]++; }
        else if (trackEvaderActions) evaderActionCounts[3]++;
      }
      if (isChaserRole) {
        if (trackChaserActions) {
          chaserDecisionCount++;
          if (activeControls === 0) chaserIdleCount++;
        }
      } else if (trackEvaderActions) {
        evaderDecisionCount++;
        if (activeControls === 0) evaderIdleCount++;
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
        else evaderFalls++;
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
      }
    }

    const tagTransition = resolveTagSwap(gameState.agents);
    if (tagTransition) {
      tags++;
      tagTimeTotalMs += tagTransition.timeToTagMs;
      taggedSurvivalTimeTotalMs += tagTransition.survivalTimeMs;
    }

    gameState.cameraPosition.x = updateRunnerCameraX(
      gameState.agents,
      gameState.cameraPosition.x,
      viewportSize.width
    );

    nextPlatformId = maintainPlatformsForCameraInPlace(
      gameState.platforms,
      gameState.agents,
      gameState.cameraPosition.x,
      viewportSize,
      nextPlatformId,
      rng
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
          grounded: agent.isOnGround,
          platformId: agent.lastPlatformId,
        })),
      });
      nextTraceAtMs += traceIntervalMs;
    }
  }

  // Tags are the only directly competitive event. A fall penalizes only the controller
  // responsible for that role at the time of the fall; it never grants fitness to the opponent.
  // This prevents either population from succeeding merely because its opponent platformed badly.
  const chaserEventScore = tags - chaserFalls;
  const evaderEventScore = -tags - evaderFalls;
  const FITNESS_BASE = 100;
  const FITNESS_PER_EVENT = 20;
  const safeRightTotalPx = runnerSafeRightExpansionByBody.reduce((sum, value) => sum + value, 0);
  const runnerFrontierExpansionPx = safeRightTotalPx / 2;
  const runnerRightFrontierExpansionPx = runnerFrontierExpansionPx;
  const runnerFrontierExpansionViewports = runnerFrontierExpansionPx / Math.max(1, viewportSize.width);
  const runnerExplorationFitnessBonus = runnerFrontierExpansionViewports * explorationRewardPerViewport;
  const runnerMaxFrontierExpansionPx = Math.max(0, ...runnerSafeRightExpansionByBody);
  const chaserFitness = FITNESS_BASE + chaserEventScore * FITNESS_PER_EVENT;
  const evaderFitness = FITNESS_BASE + evaderEventScore * FITNESS_PER_EVENT + runnerExplorationFitnessBonus;

  return {
    chaserFitness,
    evaderFitness,
    tagged: tags > 0,
    tags,
    terminalFallRole: firstFallRole,
    chaserFalls,
    evaderFalls,
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
    runnerFrontierExpansionPx,
    runnerFrontierExpansionViewports,
    runnerLeftFrontierExpansionPx,
    runnerRawRightFrontierExpansionPx,
    runnerRightFrontierExpansionPx,
    runnerExplorationFitnessBonus,
    runnerMaxFrontierExpansionPx,
    trace,
  };
}
