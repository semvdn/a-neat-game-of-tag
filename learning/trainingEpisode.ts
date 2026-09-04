import { LearningAgent, type FastAgentControls } from './agent';
import { getPhysiology, stepLocomotionFast } from './movement';
import { fillAgentStateVectorFast } from './state';
import type { AgentState, GameState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import {
  AGENT_WIDTH,
  AGENT_HEIGHT,
  AGENT_COLORS,
  GRAVITY,
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
  STATE_VECTOR_SIZE,
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
  const physiology = getPhysiology(role);
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
    energy: physiology.energyCapacity,
    maxEnergy: physiology.energyCapacity,
    trajectory: [],
    lastPlatformId: 0,
    scale: { x: 1, y: 1 },
    energyAtLastTakeoff: physiology.energyCapacity,
    positionAtLastTakeoff: { x, y: viewportHeight - 100 - AGENT_HEIGHT },
    survivalTime: 0,
    timeSinceBecameIt: 0,
    modelId: role === 'chaser' ? 'current_chaser' : 'current_evader',
  };
}

function createEpisodeState(seed: number, viewportSize: { width: number; height: number }): { gameState: GameState; flowDirection: 1 | -1 } {
  const rng = mulberry32(seed);
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
      agents: [
        makeAgent(1, startXs[0], 'chaser', viewportSize.height),
        makeAgent(2, startXs[1], 'evader', viewportSize.height),
        makeAgent(3, startXs[2], 'evader', viewportSize.height),
      ],
      platforms,
      cameraPosition: { x: 0, y: 0 },
      gameTime: 0,
      tagEffects: [],
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
    },
  };
}

export function runTrainingEpisode(
  chaser: LearningAgent,
  evader: LearningAgent,
  seed: number,
  options: TrainingEpisodeOptions = {}
): TrainingEpisodeResult {
  const viewportSize = options.viewportSize || { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT };
  const trackChaserActions = options.trackChaserActions !== false;
  const trackEvaderActions = options.trackEvaderActions !== false;
  const { gameState, flowDirection } = createEpisodeState(seed, viewportSize);
  const agents = gameState.agents;
  const chaserAgent = agents[0];
  const evaderA = agents[1];
  const evaderB = agents[2];

  const distanceToChaser = (evader: AgentState) => {
    const dx = evader.position.x - chaserAgent.position.x;
    const dy = evader.position.y - chaserAgent.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const initialClosestDistance = Math.min(distanceToChaser(evaderA), distanceToChaser(evaderB));
  const initialChaserX = chaserAgent.position.x;
  const initialEvaderX0 = evaderA.position.x;
  const initialEvaderX1 = evaderB.position.x;
  let maxChaserProgress = 0;
  let maxEvaderProgress0 = 0;
  let maxEvaderProgress1 = 0;
  let chaserFalls = 0;
  let evaderFalls = 0;
  let chaserJumps = 0;
  let evaderJumps = 0;
  let tagged = false;

  const chaserActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const evaderActionCounts = new Array<number>(ACTION_SPACE.length).fill(0);
  const states = [
    new Float64Array(STATE_VECTOR_SIZE),
    new Float64Array(STATE_VECTOR_SIZE),
    new Float64Array(STATE_VECTOR_SIZE),
  ];
  const controls: FastAgentControls[] = [
    { move: 0, jump: 0, sprint: 0, actionIndex: 0 },
    { move: 0, jump: 0, sprint: 0, actionIndex: 0 },
    { move: 0, jump: 0, sprint: 0, actionIndex: 0 },
  ];

  const maxSteps = Math.ceil(NEAT_EPISODE_MAX_MS / DT);
  const tagDistance = (AGENT_WIDTH + AGENT_HEIGHT) / 2;
  const tagDistance2 = tagDistance * tagDistance;
  const platforms = gameState.platforms;

  for (let step = 0; step < maxSteps && !tagged; step++) {
    gameState.gameTime += DT;
    chaserAgent.timeSinceBecameIt += DT;
    evaderA.survivalTime += DT;
    evaderB.survivalTime += DT;

    for (let i = 0; i < 3; i++) {
      const agent = agents[i];
      const controller = i === 0 ? chaser : evader;
      fillAgentStateVectorFast(agent, gameState, viewportSize, states[i]);
      controller.chooseControlsFast(states[i], controls[i]);
      if (i === 0) {
        if (trackChaserActions) chaserActionCounts[controls[i].actionIndex]++;
      } else if (trackEvaderActions) {
        evaderActionCounts[controls[i].actionIndex]++;
      }
    }

    for (let i = 0; i < 3; i++) {
      const agent = agents[i];
      const role: 'chaser' | 'evader' = i === 0 ? 'chaser' : 'evader';
      const jumped = stepLocomotionFast(agent, controls[i], DT, role);
      if (jumped) {
        if (i === 0) chaserJumps++;
        else evaderJumps++;
      }

      let vx = agent.velocity.x;
      let vy = agent.velocity.y + GRAVITY;
      let nextX = agent.position.x + vx;
      let nextY = agent.position.y + vy;
      const minVisibleX = gameState.cameraPosition.x;
      const maxVisibleX = minVisibleX + viewportSize.width - AGENT_WIDTH;
      agent.touchingCameraFrame = false;
      agent.cameraFrameContact = null;
      if (nextX < minVisibleX) {
        nextX = minVisibleX;
        vx = 0;
        agent.touchingCameraFrame = true;
        agent.cameraFrameContact = 'left';
      } else if (nextX > maxVisibleX) {
        nextX = maxVisibleX;
        vx = 0;
        agent.touchingCameraFrame = true;
        agent.cameraFrameContact = 'right';
      }

      let grounded = false;
      let landedPlatformId = agent.lastPlatformId;
      const prevBottom = agent.position.y + AGENT_HEIGHT;
      const nextBottom = nextY + AGENT_HEIGHT;
      if (vy >= 0) {
        for (let pIndex = 0; pIndex < platforms.length; pIndex++) {
          const platform = platforms[pIndex];
          const aligned = nextX + AGENT_WIDTH > platform.position.x && nextX < platform.position.x + platform.width;
          if (aligned && prevBottom <= platform.position.y + 8 && nextBottom >= platform.position.y) {
            nextY = platform.position.y - AGENT_HEIGHT;
            vy = 0;
            grounded = true;
            landedPlatformId = platform.id;
            break;
          }
        }
      }

      if (nextY > FALL_BOUNDARY) {
        if (i === 0) chaserFalls++;
        else evaderFalls++;
        let spawn: PlatformState | null = null;
        let bestDistance = Infinity;
        const cameraLeft = gameState.cameraPosition.x;
        const cameraRight = cameraLeft + viewportSize.width;
        for (let pIndex = 0; pIndex < platforms.length; pIndex++) {
          const platform = platforms[pIndex];
          if (platform.position.x + platform.width < cameraLeft || platform.position.x > cameraRight) continue;
          const d = Math.abs(platform.position.x + platform.width / 2 - agent.position.x);
          if (d < bestDistance) {
            bestDistance = d;
            spawn = platform;
          }
        }
        if (!spawn) {
          for (let pIndex = 0; pIndex < platforms.length; pIndex++) {
            const platform = platforms[pIndex];
            const d = Math.abs(platform.position.x + platform.width / 2 - agent.position.x);
            if (d < bestDistance) {
              bestDistance = d;
              spawn = platform;
            }
          }
        }
        const safeSpawn = spawn || platforms[0];
        nextX = safeSpawn.position.x + safeSpawn.width / 2 - AGENT_WIDTH / 2;
        nextY = safeSpawn.position.y - AGENT_HEIGHT - 20;
        vx = 0;
        vy = 0;
        agent.energy = agent.maxEnergy;
        grounded = false;
        landedPlatformId = safeSpawn.id;
      }

      agent.position.x = nextX;
      agent.position.y = nextY;
      agent.velocity.x = vx;
      agent.velocity.y = vy;
      agent.isOnGround = grounded;
      agent.lastPlatformId = landedPlatformId;
    }

    let dx = chaserAgent.position.x - evaderA.position.x;
    let dy = chaserAgent.position.y - evaderA.position.y;
    if (dx * dx + dy * dy < tagDistance2) tagged = true;
    else {
      dx = chaserAgent.position.x - evaderB.position.x;
      dy = chaserAgent.position.y - evaderB.position.y;
      tagged = dx * dx + dy * dy < tagDistance2;
    }

    const minX = Math.min(evaderA.position.x, evaderB.position.x);
    const maxX = Math.max(evaderA.position.x + AGENT_WIDTH, evaderB.position.x + AGENT_WIDTH);
    const desiredCameraX = (minX + maxX) / 2 - viewportSize.width * 0.45;
    gameState.cameraPosition.x += (desiredCameraX - gameState.cameraPosition.x) * 0.12;

    maxChaserProgress = Math.max(maxChaserProgress, flowDirection * (chaserAgent.position.x - initialChaserX));
    maxEvaderProgress0 = Math.max(maxEvaderProgress0, flowDirection * (evaderA.position.x - initialEvaderX0));
    maxEvaderProgress1 = Math.max(maxEvaderProgress1, flowDirection * (evaderB.position.x - initialEvaderX1));
  }

  const elapsedMs = gameState.gameTime;
  const elapsedSec = elapsedMs / 1000;
  const maxSec = NEAT_EPISODE_MAX_MS / 1000;
  const finalClosestDistance = Math.min(distanceToChaser(evaderA), distanceToChaser(evaderB));
  const closingGain = initialClosestDistance - finalClosestDistance;
  const chaserProgress = Math.max(0, maxChaserProgress);
  const evaderProgress = (Math.max(0, maxEvaderProgress0) + Math.max(0, maxEvaderProgress1)) / 2;

  const timeFraction = Math.max(0, Math.min(1, elapsedSec / Math.max(1e-6, maxSec)));
  const chaserOutcome = tagged ? 100 + 100 * (1 - timeFraction) : 0;
  const evaderOutcome = tagged ? 100 * timeFraction : 200;
  const closingNorm = Math.max(-1, Math.min(1, closingGain / Math.max(150, initialClosestDistance)));
  const chaserProgressNorm = Math.max(0, Math.min(1, chaserProgress / 600));
  const evaderProgressNorm = Math.max(0, Math.min(1, evaderProgress / 600));
  const evaderFallsPerAgent = evaderFalls / 2;
  const chaserShaping = 10 * closingNorm + 5 * chaserProgressNorm - 5 * Math.min(2, chaserFalls);
  const evaderShaping = -10 * closingNorm + 5 * evaderProgressNorm - 5 * Math.min(2, evaderFallsPerAgent);

  return {
    chaserFitness: Math.max(0.01, Math.min(220, chaserOutcome + chaserShaping)),
    evaderFitness: Math.max(0.01, Math.min(220, evaderOutcome + evaderShaping)),
    tagged,
    elapsedMs,
    falls: chaserFalls + evaderFalls,
    jumps: chaserJumps + evaderJumps,
    chaserActionCounts,
    evaderActionCounts,
  };
}
