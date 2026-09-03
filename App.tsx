import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { InfoPanel } from './components/InfoPanel';
import { PerformanceDiagnostics } from './components/PerformanceDiagnostics';
import { useGameLoop } from './hooks/useGameLoop';
import { LearningAgent, type AgentControls } from './learning/agent';
import { getPhysiology, stepLocomotion, syncEnergyCapacity } from './learning/movement';
import { createLeaderboardEntries } from './learning/elo';
import { getAgentStateVector } from './learning/state';
import { initAudio, playDynamicJumpSound, playTagSound, playFallSound, playToggleSound } from './services/soundService';
import type {
  GameState,
  AgentState,
  PlatformState,
  RewardBreakdown,
  DiagnosticsState,
  PerformanceDataPoint,
} from './types';
import { AgentStatus } from './types';
import {
  GRAVITY,
  AGENT_WIDTH,
  AGENT_HEIGHT,
  TAG_COOLDOWN,
  FALL_BOUNDARY,
  PLATFORM_MIN_WIDTH,
  PLATFORM_MAX_WIDTH,
  PLATFORM_HEIGHT,
  PLATFORM_SPAWN_BUFFER,
  MIN_PLATFORM_GAP_X,
  MAX_PLATFORM_GAP_X,
  MIN_PLATFORM_GAP_Y,
  MAX_PLATFORM_GAP_Y,
  AGENT_COLORS,
  MAX_ENERGY,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  INITIAL_ELO,
  NEAT_HOF_MAX_SIZE,
  NEAT_HOF_OPPONENTS_PER_GENOME,
  WORLD_REF_WIDTH,
  WORLD_REF_HEIGHT,
} from './constants';
import { Activity, Play, Pause, FastForward, RotateCcw, MonitorPlay, Cpu, Minus, Plus } from 'lucide-react';

const MAX_TRAIL_POINTS = 96;
const TRAIL_SAMPLE_DISTANCE = 4;

const formatTrainingRate = (value: number | undefined) => {
  const safe = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(1)}M`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}k`;
  if (safe >= 100) return safe.toFixed(0);
  if (safe >= 10) return safe.toFixed(1);
  return safe.toFixed(2);
};

// The champion simulation always sees the same logical camera window. The HTML canvas
// may resize freely; GameCanvas scales this world viewport uniformly for presentation.
const CHAMPION_WORLD_VIEWPORT = { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT } as const;

const appendTrailPoint = (trajectory: AgentState['trajectory'] | undefined, position: AgentState['position']) => {
  const trail = trajectory || [];
  const last = trail[trail.length - 1];
  if (last && Math.hypot(position.x - last.x, position.y - last.y) < TRAIL_SAMPLE_DISTANCE) return trail;

  return [...trail.slice(-(MAX_TRAIL_POINTS - 1)), { ...position }];
};

export const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [showSenses, setShowSenses] = useState(false);

  // Diagnostics & Control State
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [visualSpeed, setVisualSpeed] = useState(1);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [isVisualPaused, setIsVisualPaused] = useState(false);
  const [isTrainingPaused, setIsTrainingPaused] = useState(false);
  const stepFrameRef = useRef(false);
  const visualStepAccumulatorRef = useRef(0);

  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>(() => ({
    chaserNeatHistory: [],
    evaderNeatHistory: [],
    lastChaserNeatMetrics: null,
    lastEvaderNeatMetrics: null,
    chaserChampionGenome: null,
    evaderChampionGenome: null,
    performanceHistory: [],
    totalTags: 0,
    totalFalls: 0,
    totalSuccessfulJumps: 0,
    actionDistribution: {},
    chaserActionDistribution: {},
    evaderActionDistribution: {},
    generation: 0,
    chaserElo: INITIAL_ELO,
    evaderElo: INITIAL_ELO,
    eloLeaderboard: createLeaderboardEntries(INITIAL_ELO, INITIAL_ELO, 0, 0, 0, 0, 0),
    hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: NEAT_HOF_MAX_SIZE, opponentsPerGenome: NEAT_HOF_OPPONENTS_PER_GENOME, chaserGenerations: [], evaderGenerations: [] },
    lastGenerationBalance: null,
    balanceHistory: [],
    trainingSpeedX: 0,
    trainingEpisodesPerSecond: 0,
  }));


  const lastTelemetryTimeRef = useRef(0);
  const actionCountsRef = useRef<{
    all: Record<string, number>;
    chaser: Record<string, number>;
    evader: Record<string, number>;
  }>({ all: {}, chaser: {}, evader: {} });
  // Worker-owned evolutionary counters. Visual champion-game counters stay separate.
  const totalTagsRef = useRef(0);
  const totalFallsRef = useRef(0);
  const totalJumpsRef = useRef(0);
  const visualTagsRef = useRef(0);
  const visualFallsRef = useRef(0);
  const visualJumpsRef = useRef(0);

  const platformIdCounter = useRef(10);

  // Dual Policy Learning State
  const chaserAgent = useRef<LearningAgent | null>(null);
  const evaderAgent = useRef<LearningAgent | null>(null);
  // Role-level Elo is retained as an evaluation signal; evolution itself is population-based in the worker.
  const chaserElo = useRef<number>(INITIAL_ELO);
  const evaderElo = useRef<number>(INITIAL_ELO);

  // Performance Telemetry History
  const recentSurvivalTimes = useRef<number[]>([]);
  const recentTimesToTag = useRef<number[]>([]);

  // Web Worker for Headless Accelerated Simulation
  const workerRef = useRef<Worker | null>(null);
  const initializedRef = useRef(false);
  const installedChampionGenerationRef = useRef({ chaser: 0, evader: 0 });

  const initializeGameState = useCallback(() => {
    chaserAgent.current = new LearningAgent('chaser');
    evaderAgent.current = new LearningAgent('evader');

    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;

    const initialPlatforms: PlatformState[] = [
      { id: 0, position: { x: 0, y: WORLD_REF_HEIGHT - 100 }, width: WORLD_REF_WIDTH, height: PLATFORM_HEIGHT },
    ];

    // Visual playback also randomizes direction/spacing so champions are not only demonstrated moving right.
    const mirroredStart = Math.random() < 0.5;
    const startSpread = 0.90 + Math.random() * 0.20;
    const startShift = (Math.random() - 0.5) * 70;
    let visualStartXs = [100 + startShift, 100 + 300 * startSpread + startShift, 100 + 600 * startSpread + startShift];
    if (mirroredStart) visualStartXs = visualStartXs.map(x => WORLD_REF_WIDTH - x - AGENT_WIDTH);

    const initialAgents: AgentState[] = [
      {
        id: 1,
        position: { x: visualStartXs[0], y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[0],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: visualStartXs[0], y: 500 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[0], y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'champion_evader_g0',
      },
      {
        id: 2,
        position: { x: visualStartXs[1], y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[1],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: visualStartXs[1], y: 500 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[1], y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'champion_evader_g0',
      },
      {
        id: 3,
        position: { x: visualStartXs[2], y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[2],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: visualStartXs[2], y: 500 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[2], y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'champion_evader_g0',
      },
    ];

    const itAgent = initialAgents[0];
    itAgent.status = AgentStatus.It;
    itAgent.role = 'chaser';
    itAgent.modelId = 'champion_chaser_g0';
    itAgent.elo = INITIAL_ELO;

    initialAgents.forEach(agent => {
      syncEnergyCapacity(agent, agent.status === AgentStatus.It ? 'chaser' : 'evader');
      agent.energyAtLastTakeoff = agent.energy;
    });

    const newGameState: GameState = {
      agents: initialAgents,
      platforms: initialPlatforms,
      cameraPosition: { x: 0, y: 0 },
      gameTime: 0,
      tagEffects: [],
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
    };
    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    setGameState(newGameState);

    // Seed initial baseline telemetry point
    const initialPoint: PerformanceDataPoint = {
      timestamp: Date.now(),
      gameTime: 0,
      generation: 0,
      avgSurvivalTime: 0,
      avgTimeToTag: 0,
      fallsPerMinute: 0,
      tagsPerMinute: 0,
      chaserElo: INITIAL_ELO,
      evaderElo: INITIAL_ELO,
    };
    setDiagnosticsState(prev => ({
      ...prev,
      performanceHistory: prev.performanceHistory.length === 0 ? [initialPoint] : prev.performanceHistory,
    }));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initializeGameState();
  }, [initializeGameState]);

  // --- Web Worker Setup & Communication ---
  useEffect(() => {
    try {
      const worker = new Worker(new URL('./workers/trainingWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data;

        if (type === 'TELEMETRY') {
          if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
          if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
          if (typeof payload.totalTags === 'number') totalTagsRef.current = payload.totalTags;
          if (typeof payload.totalFalls === 'number') totalFallsRef.current = payload.totalFalls;
          if (typeof payload.totalJumps === 'number') totalJumpsRef.current = payload.totalJumps;

          // Hot-swap completed-generation champions into the persistent visible arena.
          // The bodies keep their positions, velocity, stamina, roles and game state.
          const generation = payload.generation || 0;
          const chaserChampionGeneration = payload.lastChaserNeatMetrics?.generation ?? generation;
          const evaderChampionGeneration = payload.lastEvaderNeatMetrics?.generation ?? generation;
          if (payload.chaserChampionGenome && chaserAgent.current && chaserChampionGeneration !== installedChampionGenerationRef.current.chaser) {
            chaserAgent.current.setWeights(payload.chaserChampionGenome);
            chaserAgent.current.setGeneration(chaserChampionGeneration);
            installedChampionGenerationRef.current.chaser = chaserChampionGeneration;
          }
          if (payload.evaderChampionGenome && evaderAgent.current && evaderChampionGeneration !== installedChampionGenerationRef.current.evader) {
            evaderAgent.current.setWeights(payload.evaderChampionGenome);
            evaderAgent.current.setGeneration(evaderChampionGeneration);
            installedChampionGenerationRef.current.evader = evaderChampionGeneration;
          }

          const now = Date.now();

          setDiagnosticsState(prev => {
            const shouldSamplePerf =
              prev.performanceHistory.length === 0 ||
              now - (prev.performanceHistory[prev.performanceHistory.length - 1]?.timestamp || 0) >= 800;

            const updatedPerformanceHistory = shouldSamplePerf
              ? [
                  ...prev.performanceHistory.slice(-59),
                  {
                    timestamp: now,
                    gameTime: payload.gameTime || 0,
                    generation,
                    avgSurvivalTime: (payload.avgSurvivalTime || 0) / 1000,
                    avgTimeToTag: (payload.avgTimeToTag || 0) / 1000,
                    fallsPerMinute: (payload.totalFalls || 0) / Math.max(0.1, (payload.gameTime || 1000) / 60000),
                    tagsPerMinute: (payload.totalTags || 0) / Math.max(0.1, (payload.gameTime || 1000) / 60000),
                    chaserElo: payload.chaserElo ?? chaserElo.current,
                    evaderElo: payload.evaderElo ?? evaderElo.current,
                  },
                ]
              : prev.performanceHistory;

            const chaserMetric = payload.lastChaserNeatMetrics;
            const evaderMetric = payload.lastEvaderNeatMetrics;
            const balanceMetric = payload.lastGenerationBalance;
            const appendUnique = <T extends { generation: number },>(history: T[] | undefined, metric?: T) => {
              if (!metric) return history || [];
              const current = history || [];
              if (current[current.length - 1]?.generation === metric.generation) return current;
              return [...current.slice(-79), metric];
            };

            return {
              ...prev,
              chaserElo: payload.chaserElo,
              evaderElo: payload.evaderElo,
              generation: generation,
              totalTags: payload.totalTags,
              totalFalls: payload.totalFalls,
              totalSuccessfulJumps: payload.totalJumps,
              chaserActionDistribution: payload.actionCountsChaser || prev.chaserActionDistribution,
              evaderActionDistribution: payload.actionCountsEvader || prev.evaderActionDistribution,
              actionDistribution: {
                ...Object.fromEntries(
                  Array.from(new Set([
                    ...Object.keys(payload.actionCountsChaser || {}),
                    ...Object.keys(payload.actionCountsEvader || {}),
                  ])).map(action => [
                    action,
                    (payload.actionCountsChaser?.[action] || 0) + (payload.actionCountsEvader?.[action] || 0),
                  ])
                ),
              },
              eloLeaderboard: payload.eloLeaderboard || prev.eloLeaderboard,
              performanceHistory: updatedPerformanceHistory,
              chaserNeatHistory: appendUnique(prev.chaserNeatHistory, chaserMetric),
              evaderNeatHistory: appendUnique(prev.evaderNeatHistory, evaderMetric),
              lastChaserNeatMetrics: chaserMetric || prev.lastChaserNeatMetrics,
              lastEvaderNeatMetrics: evaderMetric || prev.lastEvaderNeatMetrics,
              chaserChampionGenome: payload.chaserChampionGenome || prev.chaserChampionGenome,
              evaderChampionGenome: payload.evaderChampionGenome || prev.evaderChampionGenome,
              hallOfFame: payload.hallOfFame || prev.hallOfFame,
              lastGenerationBalance: balanceMetric || prev.lastGenerationBalance,
              balanceHistory: appendUnique(prev.balanceHistory, balanceMetric),
              trainingSpeedX: typeof payload.trainingSpeedX === 'number' ? payload.trainingSpeedX : prev.trainingSpeedX,
              trainingEpisodesPerSecond: typeof payload.trainingEpisodesPerSecond === 'number' ? payload.trainingEpisodesPerSecond : prev.trainingEpisodesPerSecond,
            };
          });

        } else if (type === 'SYNC_WEIGHTS_RESPONSE') {
          if (payload.chaserWeights && chaserAgent.current) {
            chaserAgent.current.setWeights(payload.chaserWeights);
          }
          if (payload.evaderWeights && evaderAgent.current) {
            evaderAgent.current.setWeights(payload.evaderWeights);
          }
          if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
          if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
        }
      };

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch (err) {
      console.warn('Web Worker initialization fallback:', err);
    }
  }, []);

  // Background evolution runs at maximum worker throughput with an independent pause state.
  // It never owns the canvas.
  useEffect(() => {
    if (!workerRef.current || !isSimulating) return;

    if (isTrainingPaused) {
      workerRef.current.postMessage({ type: 'PAUSE' });
      return;
    }

    workerRef.current.postMessage({
      type: 'START',
      payload: {
        chaserWeights: chaserAgent.current?.getWeights(),
        evaderWeights: evaderAgent.current?.getWeights(),
        chaserElo: chaserElo.current,
        evaderElo: evaderElo.current,
        viewportSize: { width: WORLD_REF_WIDTH, height: WORLD_REF_HEIGHT },
      },
    });
  }, [isTrainingPaused, isSimulating]);

  const calculateReward = (
    agent: AgentState,
    prevState: AgentState,
    currentGameState: GameState,
    tagEvent: { taggerId?: number; taggedId?: number },
    fell: boolean,
    size: { width: number; height: number }
  ): { total: number; breakdown: RewardBreakdown } => {
    const breakdown: RewardBreakdown = {};

    if (fell) {
      breakdown['fallPenalty'] = -20;
      return { total: -20, breakdown };
    }

    if (agent.lastAction === 'wait') {
      breakdown['inactivity'] = -0.02;
    }

    const agentCenterX = agent.position.x + AGENT_WIDTH / 2;
    const platformBelow = currentGameState.platforms.find(
      p => agentCenterX >= p.position.x && agentCenterX <= p.position.x + p.width
    );

    if (platformBelow) {
      const platformCenterX = platformBelow.position.x + platformBelow.width / 2;
      const distFromCenter = Math.abs(agentCenterX - platformCenterX);
      const halfWidth = platformBelow.width / 2;
      if (agent.isOnGround && platformBelow.id === agent.lastPlatformId) {
        breakdown['stayOnPlatform'] = (1 - distFromCenter / halfWidth) * 0.01;
      }
    }

    const landedOnNewPlatform =
      agent.isOnGround && !prevState.isOnGround && agent.lastPlatformId !== prevState.lastPlatformId && prevState.lastPlatformId !== null;
    if (landedOnNewPlatform) {
      visualJumpsRef.current++;
      breakdown['successfulJump'] = 2.0;
    }

    // Energy is intentionally not rewarded directly. It matters only through locomotion capability.
    const isTouchingLeftEdge = agent.touchingCameraFrame && agent.cameraFrameContact === 'left';

    if (agent.status === AgentStatus.It) {
      if (tagEvent.taggerId === agent.id) {
        breakdown['successfulTag'] = 20;
      } else {
        const evaders = currentGameState.agents.filter(a => a.status !== AgentStatus.It) || [];
        if (evaders.length > 0) {
          const prevClosestDist = Math.min(
            ...evaders.map(e => Math.hypot(prevState.position.x - e.position.x, prevState.position.y - e.position.y))
          );
          const currentClosestDist = Math.min(
            ...evaders.map(e => Math.hypot(agent.position.x - e.position.x, agent.position.y - e.position.y))
          );
          breakdown['closingDistance'] = (prevClosestDist - currentClosestDist) * 0.05;
          const maxVisibleDistance = Math.hypot(size.width, size.height);
          const normalizedDistance = Math.min(1, currentClosestDist / maxVisibleDistance);
          breakdown['proximityToTarget'] = Math.pow(1 - normalizedDistance, 2) * 0.16;
        }
        breakdown['timePenalty'] = -0.04;
      }
    } else {
      if (tagEvent.taggedId === agent.id) {
        breakdown['wasTagged'] = -20;
      } else {
        const itAgent = currentGameState.agents.find(a => a.status === AgentStatus.It);
        if (itAgent) {
          const prevDist = Math.hypot(prevState.position.x - itAgent.position.x, prevState.position.y - itAgent.position.y);
          const currentDist = Math.hypot(agent.position.x - itAgent.position.x, agent.position.y - itAgent.position.y);
          breakdown['increasingDistance'] = (currentDist - prevDist) * 0.05;
          if (!isTouchingLeftEdge) {
            const maxVisibleDistance = Math.hypot(size.width, size.height);
            const normalizedDistance = Math.min(1, currentDist / maxVisibleDistance);
            breakdown['distanceFromTagger'] = Math.pow(normalizedDistance, 2) * 0.16;
            breakdown['survival'] = 0.02;
          } else {
            breakdown['survival'] = 0;
          }
        } else {
          breakdown['survival'] = isTouchingLeftEdge ? 0 : 0.02;
        }
      }
    }

    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    return { total, breakdown };
  };

  const updateGame = useCallback(
    (deltaTime: number) => {
      setGameState(prevGameState => {
        if (!prevGameState || !isSimulating) return prevGameState;

        let newState = {
          ...prevGameState,
          agents: [...prevGameState.agents.map(a => ({ ...a, trajectory: a.trajectory || [] }))],
          platforms: [...prevGameState.platforms],
          gameTime: prevGameState.gameTime + deltaTime,
          tagEffects: [...prevGameState.tagEffects],
          avgSurvivalTime: prevGameState.avgSurvivalTime,
          avgTimeToTag: prevGameState.avgTimeToTag,
        };

        // 1. Update Timers
        newState.agents.forEach(agent => {
          if (agent.status !== AgentStatus.It) {
            agent.survivalTime = (agent.survivalTime || 0) + deltaTime;
            agent.timeSinceBecameIt = 0;
          } else {
            agent.timeSinceBecameIt = (agent.timeSinceBecameIt || 0) + deltaTime;
            agent.survivalTime = 0;
          }
        });

        // 2. Champion control selection. The four NEAT outputs are continuous drive/jump/sprint signals.
        const agentControls: { [key: number]: AgentControls } = {};
        newState.agents.forEach(agent => {
          const stateVector = getAgentStateVector(agent, newState, CHAMPION_WORLD_VIEWPORT);
          const isChaser = agent.status === AgentStatus.It;
          const role: 'chaser' | 'evader' = isChaser ? 'chaser' : 'evader';
          agent.role = role;
          agent.elo = isChaser ? chaserElo.current : evaderElo.current;
          agent.modelId = isChaser
            ? `champion_chaser_g${installedChampionGenerationRef.current.chaser}`
            : `champion_evader_g${installedChampionGenerationRef.current.evader}`;

          const model = isChaser ? chaserAgent.current : evaderAgent.current;
          if (!model) return;
          const controls = model.chooseControls(stateVector);
          agentControls[agent.id] = controls;

          actionCountsRef.current.all[controls.action] = (actionCountsRef.current.all[controls.action] || 0) + 1;
          if (isChaser) actionCountsRef.current.chaser[controls.action] = (actionCountsRef.current.chaser[controls.action] || 0) + 1;
          else actionCountsRef.current.evader[controls.action] = (actionCountsRef.current.evader[controls.action] || 0) + 1;
        });

        // 3. Update Physics & Boundaries
        let fallEvents: { [id: number]: boolean } = {};
        newState.agents = newState.agents.map(agent => {
          let newPosition = { ...agent.position };
          let newCooldownTimer = Math.max(0, agent.cooldownTimer - deltaTime);
          let newStatus = agent.status;

          if (newStatus === AgentStatus.Cooldown && newCooldownTimer === 0) {
            newStatus = AgentStatus.Normal;
          }

          const role: 'chaser' | 'evader' = newStatus === AgentStatus.It ? 'chaser' : 'evader';
          const controls = agentControls[agent.id] || {
            move: 0, jump: 0, sprint: 0, outputs: [0, 0, 0, 0], action: 'left_drive', actionIndex: 0, label: 'wait',
          };
          agent.lastAction = controls.label;

          const locomotion = stepLocomotion(agent, controls, deltaTime, role);
          let newVelocity = locomotion.velocity;
          let newEnergy = locomotion.energy;
          const newMaxEnergy = getPhysiology(role).energyCapacity;
          agent.acceleration.x = locomotion.accelerationX;

          if (locomotion.jumped) playDynamicJumpSound(locomotion.jumpImpulse);

          newVelocity.y += GRAVITY;
          newPosition.x += newVelocity.x;
          newPosition.y += newVelocity.y;

          // Camera Frame Wall Collisions
          const minVisibleX = newState.cameraPosition.x;
          const maxVisibleX = newState.cameraPosition.x + CHAMPION_WORLD_VIEWPORT.width - AGENT_WIDTH;
          let isTouchingFrame = false;
          let contactSide: 'left' | 'right' | null = null;

          if (newPosition.x < minVisibleX) {
            newPosition.x = minVisibleX;
            newVelocity.x = 0;
            isTouchingFrame = true;
            contactSide = 'left';
          } else if (newPosition.x > maxVisibleX) {
            newPosition.x = maxVisibleX;
            newVelocity.x = 0;
            isTouchingFrame = true;
            contactSide = 'right';
          }

          // Platform Landing Collisions
          let grounded = false;
          let landedPlatformId = agent.lastPlatformId;

          for (const platform of newState.platforms) {
            const prevBottom = agent.position.y + AGENT_HEIGHT;
            const newBottom = newPosition.y + AGENT_HEIGHT;
            const isHorizontallyAligned =
              newPosition.x + AGENT_WIDTH > platform.position.x && newPosition.x < platform.position.x + platform.width;

            if (
              isHorizontallyAligned &&
              prevBottom <= platform.position.y + 8 &&
              newBottom >= platform.position.y &&
              newVelocity.y >= 0
            ) {
              newPosition.y = platform.position.y - AGENT_HEIGHT;
              newVelocity.y = 0;
              grounded = true;
              landedPlatformId = platform.id;
              break;
            }
          }

          // Fall Handling
          if (newPosition.y > FALL_BOUNDARY) {
            fallEvents[agent.id] = true;
            visualFallsRef.current++;
            playFallSound();
            agent.survivalTime = 0;

            const visiblePlats = newState.platforms.filter(
              p => p.position.x + p.width >= minVisibleX && p.position.x <= maxVisibleX + AGENT_WIDTH
            );
            const spawnPlatform = visiblePlats.length > 0 ? visiblePlats[0] : newState.platforms[0];
            newPosition.x = spawnPlatform.position.x + spawnPlatform.width / 2 - AGENT_WIDTH / 2;
            newPosition.y = spawnPlatform.position.y - AGENT_HEIGHT - 30;
            newVelocity.x = 0;
            newVelocity.y = 0;
            newEnergy = newMaxEnergy;
            grounded = false;
            landedPlatformId = spawnPlatform.id;
          }

          // Keep a short, distance-sampled world-space trail. A fall teleports the body,
          // so start a fresh trail there instead of drawing a streak across the arena.
          const newTrajectory = fallEvents[agent.id]
            ? [{ ...newPosition }]
            : appendTrailPoint(agent.trajectory, newPosition);

          return {
            ...agent,
            position: newPosition,
            trajectory: newTrajectory,
            velocity: newVelocity,
            isOnGround: grounded,
            energy: newEnergy,
            maxEnergy: newMaxEnergy,
            status: newStatus,
            cooldownTimer: newCooldownTimer,
            lastPlatformId: landedPlatformId,
            touchingCameraFrame: isTouchingFrame,
            cameraFrameContact: contactSide,
            survivalTime: agent.survivalTime || 0,
            timeSinceBecameIt: agent.timeSinceBecameIt || 0,
          };
        });

        // 4. Tag Detection & role swap between the current NEAT champions
        let tagEvent: { taggerId?: number; taggedId?: number } = {};
        const itAgent = newState.agents.find(a => a.status === AgentStatus.It);

        if (itAgent && (itAgent.cooldownTimer || 0) <= 0) {
          for (const otherAgent of newState.agents) {
            if (
              otherAgent.id !== itAgent.id &&
              otherAgent.status !== AgentStatus.It &&
              (otherAgent.cooldownTimer || 0) <= 0
            ) {
              const dx = itAgent.position.x + AGENT_WIDTH / 2 - (otherAgent.position.x + AGENT_WIDTH / 2);
              const dy = itAgent.position.y + AGENT_HEIGHT / 2 - (otherAgent.position.y + AGENT_HEIGHT / 2);
              const distance = Math.hypot(dx, dy);

              if (distance < (AGENT_WIDTH + AGENT_HEIGHT) / 2) {
                tagEvent = { taggerId: itAgent.id, taggedId: otherAgent.id };
                visualTagsRef.current++;

                const recordedSurvival = Math.max(otherAgent.survivalTime || 0, 100);
                const recordedTimeToTag = Math.max(itAgent.timeSinceBecameIt || 0, 100);

                recentSurvivalTimes.current.push(recordedSurvival);
                if (recentSurvivalTimes.current.length > SURVIVAL_TIME_HISTORY_LENGTH) {
                  recentSurvivalTimes.current.shift();
                }
                recentTimesToTag.current.push(recordedTimeToTag);
                if (recentTimesToTag.current.length > TIME_TO_TAG_HISTORY_LENGTH) {
                  recentTimesToTag.current.shift();
                }

                // Role swap; each role always uses its latest evolved champion
                const oldTagger = itAgent;
                const newTagger = otherAgent;

                // New tagger becomes It with a short transition cooldown
                newTagger.status = AgentStatus.It;
                newTagger.role = 'chaser';
                newTagger.elo = chaserElo.current;
                newTagger.cooldownTimer = 600;
                newTagger.survivalTime = 0;
                newTagger.timeSinceBecameIt = 0;

                newTagger.modelId = `champion_chaser_g${installedChampionGenerationRef.current.chaser}`;
                syncEnergyCapacity(newTagger, 'chaser');

                // Old tagger becomes evader with full tag-immunity cooldown to escape safely
                oldTagger.status = AgentStatus.Cooldown;
                oldTagger.role = 'evader';
                oldTagger.elo = evaderElo.current;
                oldTagger.cooldownTimer = TAG_COOLDOWN;
                oldTagger.survivalTime = 0;
                oldTagger.timeSinceBecameIt = 0;

                oldTagger.modelId = `champion_evader_g${installedChampionGenerationRef.current.evader}`;
                syncEnergyCapacity(oldTagger, 'evader');

                playTagSound();
                const effectLife = 500;
                newState.tagEffects.push({
                  position: { ...otherAgent.position },
                  life: effectLife,
                  initialLife: effectLife,
                });
                break;
              }
            }
          }
        }

        // 5. Performance Averages
        const activeEvaders = newState.agents.filter(a => a.status !== AgentStatus.It);
        const liveEvaderSurvivalAvg = activeEvaders.length > 0
          ? activeEvaders.reduce((sum, a) => sum + (a.survivalTime || 0), 0) / activeEvaders.length
          : 0;

        if (recentSurvivalTimes.current.length > 0) {
          newState.avgSurvivalTime =
            recentSurvivalTimes.current.reduce((a, b) => a + b, 0) / recentSurvivalTimes.current.length;
        } else {
          newState.avgSurvivalTime = liveEvaderSurvivalAvg;
        }

        const currentActiveTagger = newState.agents.find(a => a.status === AgentStatus.It);
        if (recentTimesToTag.current.length > 0) {
          newState.avgTimeToTag =
            recentTimesToTag.current.reduce((a, b) => a + b, 0) / recentTimesToTag.current.length;
        } else if (currentActiveTagger) {
          newState.avgTimeToTag = currentActiveTagger.timeSinceBecameIt || 0;
        }

        // 6. Visual reward breakdown is retained only as explanatory UI telemetry.
        const rewardBreakdowns: { [id: number]: RewardBreakdown } = {};
        newState.agents.forEach(agent => {
          const prevState = prevGameState.agents.find(a => a.id === agent.id)!;
          const { breakdown } = calculateReward(
            agent,
            prevState,
            newState,
            tagEvent,
            fallEvents[agent.id] || false,
            CHAMPION_WORLD_VIEWPORT
          );
          rewardBreakdowns[agent.id] = breakdown;
        });

        // Evolution is intentionally absent from the main thread; the worker owns generations.

        // Evolutionary diagnostics remain worker-owned; the visible game is presentation only.

        // 7. Camera Tracking (Runners have dominant authority over camera progression)
        const evaders = newState.agents.filter(a => a.status !== AgentStatus.It);
        const trackingGroup = evaders.length > 0 ? evaders : newState.agents;

        let minRunnerX = Infinity,
          maxRunnerX = -Infinity;
        trackingGroup.forEach(a => {
          minRunnerX = Math.min(minRunnerX, a.position.x);
          maxRunnerX = Math.max(maxRunnerX, a.position.x + AGENT_WIDTH);
        });

        // Center on runner cluster with slight forward horizon bias (+5% right)
        const runnersCenterX = (minRunnerX + maxRunnerX) / 2;
        const desiredCameraX = runnersCenterX - CHAMPION_WORLD_VIEWPORT.width * 0.45;
        newState.cameraPosition.x += (desiredCameraX - newState.cameraPosition.x) * 0.12;

        // 10. Platform Generation
        const rightGenerationEdge = newState.cameraPosition.x + CHAMPION_WORLD_VIEWPORT.width + PLATFORM_SPAWN_BUFFER;
        const leftGenerationEdge = newState.cameraPosition.x - PLATFORM_SPAWN_BUFFER;
        const despawnMargin = PLATFORM_SPAWN_BUFFER * 2;
        newState.platforms = newState.platforms.filter(
          p =>
            p.position.x + p.width > newState.cameraPosition.x - despawnMargin &&
            p.position.x < newState.cameraPosition.x + CHAMPION_WORLD_VIEWPORT.width + despawnMargin
        );

        const sortedPlatforms = [...newState.platforms].sort((a, b) => a.position.x - b.position.x);

        function generatePlatform(baseX: number, baseY: number, toLeft: boolean = false): PlatformState {
          let gapX = MIN_PLATFORM_GAP_X + Math.random() * (MAX_PLATFORM_GAP_X - MIN_PLATFORM_GAP_X);
          const gapY = (Math.random() - 0.5) * MAX_PLATFORM_GAP_Y * 1.5;
          const newY = baseY + gapY;
          const clampedY = Math.min(WORLD_REF_HEIGHT - 120, Math.max(250, newY));
          const verticalDifference = clampedY - baseY;

          if (verticalDifference < -100) gapX = Math.max(MIN_PLATFORM_GAP_X, Math.min(gapX, 90));
          else if (verticalDifference > 80) gapX = Math.max(gapX, 140);

          const newWidth = Math.random() * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH) + PLATFORM_MIN_WIDTH;
          return {
            id: platformIdCounter.current++,
            width: newWidth,
            height: PLATFORM_HEIGHT,
            position: {
              x: toLeft ? baseX - newWidth - gapX : baseX + gapX,
              y: clampedY,
            },
          };
        }

        if (sortedPlatforms.length > 0) {
          let rightmostPlatform = sortedPlatforms[sortedPlatforms.length - 1];
          while (rightmostPlatform.position.x + rightmostPlatform.width < rightGenerationEdge) {
            const newPlatform = generatePlatform(
              rightmostPlatform.position.x + rightmostPlatform.width,
              rightmostPlatform.position.y
            );
            newState.platforms.push(newPlatform);
            rightmostPlatform = newPlatform;
          }
        }
        if (sortedPlatforms.length > 0) {
          let leftmostPlatform = sortedPlatforms[0];
          while (leftmostPlatform.position.x > leftGenerationEdge) {
            const newPlatform = generatePlatform(leftmostPlatform.position.x, leftmostPlatform.position.y, true);
            newState.platforms.unshift(newPlatform);
            leftmostPlatform = newPlatform;
          }
        }

        // 11. Tag Visual Effects
        newState.tagEffects = newState.tagEffects
          .map(effect => ({ ...effect, life: effect.life - deltaTime }))
          .filter(effect => effect.life > 0);

        // Attach UI State
        newState.agents = newState.agents.map(agent => {
          const breakdown = rewardBreakdowns[agent.id] || {};
          const stateVector = getAgentStateVector(agent, newState, CHAMPION_WORLD_VIEWPORT, showSenses);

          return {
            ...agent,
            stateVector,
            rewardBreakdown: breakdown,
          };
        });

        return newState;
      });
    },
    [isSimulating, showSenses]
  );

  const updateSimulation = useCallback(
    (_deltaTime: number) => {
      if (isVisualPaused && !stepFrameRef.current) return;
      if (stepFrameRef.current) {
        stepFrameRef.current = false;
        updateGame(16.67);
        return;
      }

      // Champion-view speed only affects local rendering. Fractional speeds use an accumulator.
      visualStepAccumulatorRef.current += Math.max(0.25, Math.min(10, visualSpeed));
      const steps = Math.floor(visualStepAccumulatorRef.current);
      visualStepAccumulatorRef.current -= steps;
      for (let i = 0; i < steps; i++) updateGame(16.67);
    },
    [isVisualPaused, visualSpeed, updateGame]
  );

  useGameLoop(updateSimulation);

  const startSimulation = () => {
    initAudio();
    setIsSimulating(true);
  };

  const handleToggleTrails = () => {
    playToggleSound(!showTrails);
    setShowTrails(prev => !prev);
  };

  const handleToggleSenses = () => {
    playToggleSound(!showSenses);
    setShowSenses(prev => !prev);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      setShowSenses(prev => {
        playToggleSound(!prev);
        return !prev;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  const handleResetChampionGame = useCallback(() => {
    const mirroredStart = Math.random() < 0.5;
    const startSpread = 0.90 + Math.random() * 0.20;
    const startShift = (Math.random() - 0.5) * 70;
    let xs = [100 + startShift, 100 + 300 * startSpread + startShift, 100 + 600 * startSpread + startShift];
    if (mirroredStart) xs = xs.map(x => WORLD_REF_WIDTH - x - AGENT_WIDTH);

    const groundY = WORLD_REF_HEIGHT - 100;
    const startY = Math.max(40, groundY - AGENT_HEIGHT - 30);
    const platforms: PlatformState[] = [
      { id: 0, position: { x: 0, y: groundY }, width: WORLD_REF_WIDTH, height: PLATFORM_HEIGHT },
    ];

    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    visualTagsRef.current = 0;
    visualFallsRef.current = 0;
    visualJumpsRef.current = 0;
    actionCountsRef.current = { all: {}, chaser: {}, evader: {} };
    visualStepAccumulatorRef.current = 0;
    platformIdCounter.current = 10;

    setGameState(prev => {
      if (!prev) return prev;
      const agents = prev.agents.map((agent, index) => {
        const isChaser = index === 0;
        const role: 'chaser' | 'evader' = isChaser ? 'chaser' : 'evader';
        return {
          ...agent,
          position: { x: xs[index] ?? xs[xs.length - 1], y: startY },
          velocity: { x: 0, y: 0 },
          acceleration: { x: 0, y: 0 },
          status: isChaser ? AgentStatus.It : AgentStatus.Normal,
          role,
          elo: isChaser ? chaserElo.current : evaderElo.current,
          isOnGround: false,
          cooldownTimer: 0,
          lastAction: 'wait',
          energy: MAX_ENERGY,
          maxEnergy: MAX_ENERGY,
          trajectory: [{ x: xs[index] ?? xs[xs.length - 1], y: startY }],
          lastPlatformId: 0,
          energyAtLastTakeoff: MAX_ENERGY,
          positionAtLastTakeoff: { x: xs[index] ?? xs[xs.length - 1], y: startY },
          survivalTime: 0,
          timeSinceBecameIt: 0,
          modelId: isChaser
            ? `champion_chaser_g${installedChampionGenerationRef.current.chaser}`
            : `champion_evader_g${installedChampionGenerationRef.current.evader}`,
        };
      });
      return {
        ...prev,
        agents,
        platforms,
        cameraPosition: { x: 0, y: 0 },
        gameTime: 0,
        tagEffects: [],
        avgSurvivalTime: 0,
        avgTimeToTag: 0,
      };
    });
  }, []);


  const handleResetWeights = () => {
    // Reset evolution without resetting the visible champion game. Fresh worker champions
    // are hot-swapped into the running bodies as soon as RESET telemetry arrives.
    installedChampionGenerationRef.current = { chaser: -1, evader: -1 };
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESET' });
    }
    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;
    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    actionCountsRef.current = { all: {}, chaser: {}, evader: {} };
    totalTagsRef.current = 0;
    totalFallsRef.current = 0;
    totalJumpsRef.current = 0;

    setDiagnosticsState(prev => ({
      ...prev,
              chaserNeatHistory: [],
      evaderNeatHistory: [],
      lastChaserNeatMetrics: null,
      lastEvaderNeatMetrics: null,
      chaserChampionGenome: null,
      evaderChampionGenome: null,
      performanceHistory: [],
      totalTags: 0,
      totalFalls: 0,
      totalSuccessfulJumps: 0,
      actionDistribution: {},
      chaserActionDistribution: {},
      evaderActionDistribution: {},
      generation: 0,
      chaserElo: INITIAL_ELO,
      evaderElo: INITIAL_ELO,
      eloLeaderboard: createLeaderboardEntries(INITIAL_ELO, INITIAL_ELO, 0, 0, 0, 0, 0),
      hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: NEAT_HOF_MAX_SIZE, opponentsPerGenome: NEAT_HOF_OPPONENTS_PER_GENOME, chaserGenerations: [], evaderGenerations: [] },
      lastGenerationBalance: null,
      balanceHistory: [],
    }));
  };

  const handleSaveModels = () => {
    if (!chaserAgent.current || !evaderAgent.current) return;
    const payload = {
      version: '3.0.0',
      algorithm: 'NEAT',
      timestamp: Date.now(),
      chaser: JSON.parse(chaserAgent.current.exportJson()),
      evader: JSON.parse(evaderAgent.current.exportJson()),
      chaserElo: chaserElo.current,
      evaderElo: evaderElo.current,
      diagnostics: {
        totalTags: totalTagsRef.current,
        totalFalls: totalFallsRef.current,
      },
    };
    localStorage.setItem('ai_tag_studio_models', JSON.stringify(payload));
  };

  const handleLoadModels = (): boolean => {
    try {
      const raw = localStorage.getItem('ai_tag_studio_models');
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (payload.chaser && chaserAgent.current) {
        chaserAgent.current.importJson(JSON.stringify(payload.chaser));
      }
      if (payload.evader && evaderAgent.current) {
        evaderAgent.current.importJson(JSON.stringify(payload.evader));
      }
      installedChampionGenerationRef.current = {
        chaser: chaserAgent.current?.getGeneration() || 0,
        evader: evaderAgent.current?.getGeneration() || 0,
      };
      if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
      if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'SET_WEIGHTS',
          payload: {
            chaserWeights: chaserAgent.current?.getWeights(),
            evaderWeights: evaderAgent.current?.getWeights(),
            chaserElo: chaserElo.current,
            evaderElo: evaderElo.current,
          },
        });
      }
      return true;
    } catch (e) {
      console.error('Failed to load models:', e);
      return false;
    }
  };

  const handleExportModels = () => {
    if (!chaserAgent.current || !evaderAgent.current) return;
    const payload = {
      version: '3.0.0',
      algorithm: 'NEAT',
      timestamp: Date.now(),
      chaser: JSON.parse(chaserAgent.current.exportJson()),
      evader: JSON.parse(evaderAgent.current.exportJson()),
      chaserElo: chaserElo.current,
      evaderElo: evaderElo.current,
      diagnostics: {
        totalTags: totalTagsRef.current,
        totalFalls: totalFallsRef.current,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neat_tag_champions_gen${diagnosticsState.generation}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportModels = (jsonString: string): boolean => {
    try {
      const payload = JSON.parse(jsonString);
      if (payload.chaser && chaserAgent.current) {
        chaserAgent.current.importJson(JSON.stringify(payload.chaser));
      }
      if (payload.evader && evaderAgent.current) {
        evaderAgent.current.importJson(JSON.stringify(payload.evader));
      }
      installedChampionGenerationRef.current = {
        chaser: chaserAgent.current?.getGeneration() || 0,
        evader: evaderAgent.current?.getGeneration() || 0,
      };
      if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
      if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'SET_WEIGHTS',
          payload: {
            chaserWeights: chaserAgent.current?.getWeights(),
            evaderWeights: evaderAgent.current?.getWeights(),
            chaserElo: chaserElo.current,
            evaderElo: evaderElo.current,
          },
        });
      }
      return true;
    } catch (e) {
      console.error('Failed to parse uploaded models JSON:', e);
      return false;
    }
  };

  const handleStepFrame = () => {
    stepFrameRef.current = true;
  };

  const changeCameraZoom = (delta: number) => {
    setCameraZoom(current => {
      const next = Math.round((current + delta) * 100) / 100;
      return Math.max(0.5, Math.min(2, next));
    });
  };

  const uiScale = 0.75;
  const scaledViewportStyle = {
    width: `${100 / uiScale}vw`,
    height: `${100 / uiScale}vh`,
    transform: `scale(${uiScale})`,
    transformOrigin: 'top left',
  };

  if (isLoading || !gameState) {
    return (
      <div
        className="flex items-center justify-center bg-gray-950 text-cyan-400 font-mono"
        style={scaledViewportStyle}
      >
        Loading Artwork...
      </div>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-gray-950 font-sans p-4 gap-3 select-none"
      style={scaledViewportStyle}
    >
      <header className="flex items-center justify-between bg-gray-900/80 backdrop-blur border border-gray-800 px-5 py-3 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center text-white font-bold shadow-md shadow-cyan-500/20">
            AI
          </div>
          <div>
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400">
              NEAT Multi-Agent Tag Studio
            </h1>
            <p className="text-xs text-gray-400">
              Persistent Champion Arena + Independent Background NEAT Evolution
            </p>
          </div>
        </div>

        {/* Global Controls & Diagnostics Launcher */}
        <div className="flex items-center gap-3">
          {/* Champion-view controls */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-1" title="Champion game speed">
              <MonitorPlay className="w-3.5 h-3.5 text-cyan-300 ml-1" />
              <span className="text-[10px] uppercase tracking-wider text-cyan-300 mr-1">View</span>
              {[0.5, 1, 2, 5, 10].map(speed => (
                <button key={speed} onClick={() => setVisualSpeed(speed)} className={`px-2 py-1 text-[11px] font-mono font-semibold rounded ${visualSpeed === speed ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-900'}`}>{speed}x</button>
              ))}
            </div>
            <div className="flex items-center bg-gray-950 border border-gray-800 rounded-lg p-1" title="Visual camera zoom only; does not change physics or agent senses">
              <button
                onClick={() => changeCameraZoom(-0.25)}
                disabled={cameraZoom <= 0.5}
                className="p-1.5 rounded text-cyan-200 hover:bg-gray-900 disabled:text-gray-700 disabled:hover:bg-transparent"
                title="Zoom camera out"
                aria-label="Zoom camera out"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCameraZoom(1)}
                className="min-w-[52px] px-1 text-[10px] font-mono font-semibold text-gray-300 hover:text-cyan-200"
                title="Reset camera zoom to 100%"
              >
                {Math.round(cameraZoom * 100)}%
              </button>
              <button
                onClick={() => changeCameraZoom(0.25)}
                disabled={cameraZoom >= 2}
                className="p-1.5 rounded text-cyan-200 hover:bg-gray-900 disabled:text-gray-700 disabled:hover:bg-transparent"
                title="Zoom camera in"
                aria-label="Zoom camera in"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <button onClick={() => setIsVisualPaused(p => !p)} className="p-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800" title={isVisualPaused ? 'Resume champion game' : 'Pause champion game'}>
              {isVisualPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button onClick={handleResetChampionGame} className="px-2.5 py-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800 flex items-center gap-1.5 text-[11px] font-semibold" title="Reset champion game only">
              <RotateCcw className="w-3.5 h-3.5" />Reset view
            </button>
          </div>

          {/* Independent background-training controls */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 bg-gray-950 border border-gray-800 rounded-lg px-2 py-1.5" title="Background training always runs as fast as this device can process it">
              <Cpu className="w-3.5 h-3.5 text-amber-300 ml-1" />
              <span className="text-[10px] uppercase tracking-wider text-amber-300">Train</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 text-[9px] font-bold uppercase tracking-wider text-amber-200">Max</span>
              <span className="text-[11px] font-mono font-semibold text-amber-100 min-w-[54px] text-right">
                {isTrainingPaused ? 'paused' : `${formatTrainingRate(diagnosticsState.trainingSpeedX)}×`}
              </span>
              <span className="text-[9px] font-mono text-gray-500 min-w-[58px]">
                {formatTrainingRate(diagnosticsState.trainingEpisodesPerSecond)} ep/s
              </span>
            </div>
            <button onClick={() => setIsTrainingPaused(p => !p)} className="p-2 rounded-lg border border-gray-700 text-amber-200 hover:bg-gray-800" title={isTrainingPaused ? 'Resume background training' : 'Pause background training'}>
              {isTrainingPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
          </div>

          {/* Diagnostics Button */}
          <button
            onClick={() => setIsDiagnosticsOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold rounded-lg shadow-lg shadow-cyan-600/30 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Activity className="w-4 h-4 text-cyan-200" />
            <span>Diagnostics</span>
            <span className="ml-1 px-1.5 py-0.5 bg-black/40 text-cyan-300 rounded text-[10px] font-mono">
              Gen {diagnosticsState.generation}
            </span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">
        <main
          className="flex-grow bg-[#1a202c] rounded-xl border border-gray-800 shadow-2xl overflow-hidden relative"
        >
          {!isSimulating && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4">
              <div className="text-center max-w-md p-6 bg-gray-900 border border-cyan-500/30 rounded-2xl shadow-2xl">
                <h2 className="text-2xl font-bold text-cyan-400 mb-2">Autonomous Agent Arena</h2>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  Three autonomous agents evolve chasing, dodging, jumping, and spatial awareness using
                  dual NEAT populations, speciation, structural mutation, 8-ray lidar, and headless generation evaluation.
                </p>
                <button
                  onClick={startSimulation}
                  className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-black font-bold rounded-xl text-lg shadow-lg shadow-cyan-500/25 transition-all transform hover:scale-[1.02]"
                >
                  Start Simulation
                </button>
              </div>
            </div>
          )}
          {isSimulating && (
            <div className="absolute top-3 left-3 z-[5] pointer-events-none rounded-lg border border-cyan-500/25 bg-black/65 backdrop-blur px-3 py-2 text-[11px] text-gray-400 shadow-lg">
              <div className="font-semibold text-cyan-200">Champion arena · continuous game</div>
              <div className="font-mono mt-0.5">Chaser G{installedChampionGenerationRef.current.chaser} · Runner G{installedChampionGenerationRef.current.evader}</div>
            </div>
          )}
          {isSimulating && (
            <GameCanvas
              gameState={gameState}
              onFrameReady={() => {}}
              showTrails={showTrails}
              showSenses={showSenses}
              cameraZoom={cameraZoom}
            />
          )}
        </main>
        <InfoPanel
          agents={gameState.agents}
          isSimulating={isSimulating}
            showTrails={showTrails}
          onToggleTrails={handleToggleTrails}
          showSenses={showSenses}
          onToggleSenses={handleToggleSenses}
          chaserElo={chaserElo.current}
          evaderElo={evaderElo.current}
          onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        />
      </div>

      {/* Full Screen Interactive Performance Diagnostics Suite */}
      <PerformanceDiagnostics
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        diagnostics={diagnosticsState}
        visualSpeed={visualSpeed}
        onSetVisualSpeed={setVisualSpeed}
        isVisualPaused={isVisualPaused}
        onToggleVisualPause={() => setIsVisualPaused(p => !p)}
        isTrainingPaused={isTrainingPaused}
        onToggleTrainingPause={() => setIsTrainingPaused(p => !p)}
        onResetChampionGame={handleResetChampionGame}
        onStepFrame={handleStepFrame}
        onResetWeights={handleResetWeights}
        avgSurvivalTime={gameState.avgSurvivalTime}
        avgTimeToTag={gameState.avgTimeToTag}
        onSaveLocalStorage={handleSaveModels}
        onLoadLocalStorage={handleLoadModels}
        onExportModels={handleExportModels}
        onImportModels={handleImportModels}
        hasSavedModel={Boolean(localStorage.getItem('ai_tag_studio_models'))}
      />
    </div>
  );
};

export default App;
