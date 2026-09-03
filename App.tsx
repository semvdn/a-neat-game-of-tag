import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { InfoPanel } from './components/InfoPanel';
import { PerformanceDiagnostics } from './components/PerformanceDiagnostics';
import { useGameLoop } from './hooks/useGameLoop';
import { LearningAgent, type AgentControls } from './learning/agent';
import { getPhysiology, stepLocomotion, syncEnergyCapacity } from './learning/movement';
import { createLeaderboardEntries } from './learning/elo';
import { getAgentStateVector } from './learning/state';
import { generateCourse } from './level/generator';
import { isPlatformSolid, triggerCrumblingPlatform, updateDynamicPlatforms } from './level/dynamics';
import { initAudio, playDynamicJumpSound, playTagSound, playFallSound, playToggleSound } from './services/soundService';
import type {
  GameState,
  AgentState,
  RewardBreakdown,
  DiagnosticsState,
  PerformanceDataPoint,
  PlatformState,
} from './types';
import { AgentStatus } from './types';
import {
  GRAVITY,
  AGENT_WIDTH,
  AGENT_HEIGHT,
  TAG_COOLDOWN,
  FALL_BOUNDARY,
  AGENT_COLORS,
  MAX_ENERGY,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  INITIAL_ELO,
  NEAT_HOF_MAX_SIZE,
  CONTINUOUS_TRAINING_DEFAULT_ARENAS,
  CONTINUOUS_HOF_MATCHUP_CHANCE,
} from './constants';
import { Activity, Play, Pause, FastForward, RotateCcw, MonitorPlay, Cpu } from 'lucide-react';

export const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const [showTrails, setShowTrails] = useState(true);
  const [showLidar, setShowLidar] = useState(true);

  // Diagnostics & Control State
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [visualSpeed, setVisualSpeed] = useState(1);
  const [workerSpeed, setWorkerSpeed] = useState(50);
  const [trainingArenaCount, setTrainingArenaCount] = useState(CONTINUOUS_TRAINING_DEFAULT_ARENAS);
  const [isVisualPaused, setIsVisualPaused] = useState(false);
  const [isTrainingPaused, setIsTrainingPaused] = useState(false);
  const stepFrameRef = useRef(false);
  const visualStepAccumulatorRef = useRef(0);
  const visualFlowDirectionRef = useRef<1 | -1>(1);

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
    hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: NEAT_HOF_MAX_SIZE, opponentsPerGenome: CONTINUOUS_HOF_MATCHUP_CHANCE, chaserGenerations: [], evaderGenerations: [] },
    lastGenerationBalance: null,
    balanceHistory: [],
  }));


  const lastTelemetryTimeRef = useRef(0);
  const actionCountsRef = useRef<{
    all: Record<string, number>;
    chaser: Record<string, number>;
    evader: Record<string, number>;
  }>({ all: {}, chaser: {}, evader: {} });
  // Worker-owned training totals. Champion-view counters are kept separate so the
  // visible arena can be reset or paused without changing evolutionary telemetry.
  const totalTagsRef = useRef(0);
  const totalFallsRef = useRef(0);
  const totalJumpsRef = useRef(0);
  const visualTagsRef = useRef(0);
  const visualFallsRef = useRef(0);
  const visualJumpsRef = useRef(0);

  const mainContainerRef = useRef<HTMLDivElement>(null);
  const curriculumDifficultyRef = useRef(0.08);

  // Dual Policy Learning State
  const chaserAgent = useRef<LearningAgent | null>(null);
  const evaderAgent = useRef<LearningAgent | null>(null);
  // Role-level Elo is retained as an evaluation signal; evolution itself is population-based in the worker.
  const chaserElo = useRef<number>(INITIAL_ELO);
  const evaderElo = useRef<number>(INITIAL_ELO);

  // Performance Telemetry History
  const recentSurvivalTimes = useRef<number[]>([]);
  const recentTimesToTag = useRef<number[]>([]);

  // The champion arena and evolutionary worker are intentionally independent.
  const workerRef = useRef<Worker | null>(null);
  const viewportSizeRef = useRef(viewportSize);
  const initializedRef = useRef(false);
  const installedChampionGenerationRef = useRef({ chaser: 0, evader: 0 });

  useEffect(() => { viewportSizeRef.current = viewportSize; }, [viewportSize]);

  const initializeGameState = useCallback(() => {
    chaserAgent.current = new LearningAgent('chaser');
    evaderAgent.current = new LearningAgent('evader');

    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;

    const visualCourse = generateCourse({
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      difficulty: curriculumDifficultyRef.current,
      viewport: viewportSize,
      length: 24000,
    });
    visualFlowDirectionRef.current = visualCourse.flowDirection;
    const initialPlatforms = visualCourse.platforms;
    const visualStartXs = visualCourse.startXs;
    const startPlatform = initialPlatforms.find(p => p.id === 0) || initialPlatforms[0];
    const startY = startPlatform.position.y - AGENT_HEIGHT;

    const initialAgents: AgentState[] = [
      {
        id: 1,
        position: { x: visualStartXs[0], y: startY },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[0],
        isOnGround: true,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[0], y: startY },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'champion_evader_g0',
      },
      {
        id: 2,
        position: { x: visualStartXs[1], y: startY },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[1],
        isOnGround: true,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[1], y: startY },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'champion_evader_g0',
      },
      {
        id: 3,
        position: { x: visualStartXs[2], y: startY },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[2],
        isOnGround: true,
        cooldownTimer: 0,
        lastAction: 'wait',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: visualStartXs[2], y: startY },
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
      courseGraph: visualCourse.graph,
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
  }, [viewportSize]);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    if (mainContainerRef.current) {
      observer.observe(mainContainerRef.current);
    }
    return () => observer.disconnect();
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
          if (typeof payload.curriculum?.difficulty === 'number') {
            curriculumDifficultyRef.current = payload.curriculum.difficulty;
          }

          // Hot-swap the latest completed-generation champions into the persistent visual arena.
          // Positions, stamina, roles, platforms and game time are deliberately left untouched.
          const generation = payload.generation || 0;
          const chaserChampionGeneration = payload.lastChaserNeatMetrics?.generation ?? generation;
          const evaderChampionGeneration = payload.lastEvaderNeatMetrics?.generation ?? generation;
          if (
            payload.chaserChampionGenome &&
            chaserAgent.current &&
            chaserChampionGeneration !== installedChampionGenerationRef.current.chaser
          ) {
            chaserAgent.current.setWeights(payload.chaserChampionGenome);
            chaserAgent.current.setGeneration(chaserChampionGeneration);
            installedChampionGenerationRef.current.chaser = chaserChampionGeneration;
          }
          if (
            payload.evaderChampionGenome &&
            evaderAgent.current &&
            evaderChampionGeneration !== installedChampionGenerationRef.current.evader
          ) {
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
              curriculum: payload.curriculum || prev.curriculum,
              continuousTraining: payload.continuousTraining || prev.continuousTraining,
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

  // Background evolution has its own speed and pause state. It never takes over the canvas.
  useEffect(() => {
    if (!workerRef.current || !isSimulating) return;

    if (isTrainingPaused) {
      workerRef.current.postMessage({ type: 'PAUSE' });
      return;
    }

    workerRef.current.postMessage({
      type: 'START',
      payload: {
        speedMultiplier: workerSpeed,
        arenaCount: trainingArenaCount,
        chaserWeights: chaserAgent.current?.getWeights(),
        evaderWeights: evaderAgent.current?.getWeights(),
        chaserElo: chaserElo.current,
        evaderElo: evaderElo.current,
        viewportSize,
      },
    });
  }, [workerSpeed, isTrainingPaused, isSimulating, viewportSize]);

  // Arena count can be changed while training is running or paused without reseeding populations.
  useEffect(() => {
    if (!workerRef.current || !isSimulating) return;
    workerRef.current.postMessage({ type: 'SET_ARENA_COUNT', payload: { arenaCount: trainingArenaCount } });
  }, [trainingArenaCount, isSimulating]);

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
      p => isPlatformSolid(p) && agentCenterX >= p.position.x && agentCenterX <= p.position.x + p.width
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

        const nextGameTime = prevGameState.gameTime + deltaTime;
        const dynamicStep = updateDynamicPlatforms(prevGameState.platforms, nextGameTime);
        let newState = {
          ...prevGameState,
          agents: [...prevGameState.agents.map(a => ({ ...a, position: { ...a.position }, velocity: { ...a.velocity }, trajectory: a.trajectory || [] }))],
          platforms: dynamicStep.platforms,
          gameTime: nextGameTime,
          tagEffects: [...prevGameState.tagEffects],
          avgSurvivalTime: prevGameState.avgSurvivalTime,
          avgTimeToTag: prevGameState.avgTimeToTag,
        };

        // Moving platforms carry grounded agents. A disappearing support immediately releases them.
        newState.agents.forEach(agent => {
          if (!agent.isOnGround || agent.lastPlatformId === null) return;
          const support = newState.platforms.find(p => p.id === agent.lastPlatformId);
          if (!support || !isPlatformSolid(support)) {
            agent.isOnGround = false;
            return;
          }
          const delta = dynamicStep.deltas.get(support.id);
          if (delta) {
            agent.position.x += delta.x;
            agent.position.y += delta.y;
          }
        });

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
          const stateVector = getAgentStateVector(agent, newState, viewportSize);
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
        const crumbleContacts = new Set<number>();
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
          const maxVisibleX = newState.cameraPosition.x + viewportSize.width - AGENT_WIDTH;
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
            if (!isPlatformSolid(platform)) continue;
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
              if (platform.kind === 'crumbling') crumbleContacts.add(platform.id);
              break;
            }
          }

          // Fall Handling. The whole bout is repositioned below after all bodies have been stepped.
          // Stamina is intentionally not refilled, matching evolutionary evaluation.
          if (newPosition.y > FALL_BOUNDARY) {
            fallEvents[agent.id] = true;
            visualFallsRef.current++;
            playFallSound();
            grounded = false;
          }

          return {
            ...agent,
            position: newPosition,
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

        if (crumbleContacts.size > 0) {
          newState.platforms = newState.platforms.map(platform =>
            crumbleContacts.has(platform.id) ? triggerCrumblingPlatform(platform, newState.gameTime) : platform
          );
        }

        const hadFall = Object.keys(fallEvents).length > 0;
        if (hadFall) {
          const currentIt = newState.agents.find(a => a.status === AgentStatus.It) ?? newState.agents[0];
          const itId = currentIt.id;

          // Restore temporary crumble state for the new bout while keeping moving platforms at their
          // current phase. This mirrors headless training rather than teleporting one body in isolation.
          newState.platforms = newState.platforms.map(platform => ({
            ...platform,
            position: { ...(platform.basePosition ?? platform.position) },
            active: true,
            crumblePhase: platform.kind === 'crumbling' ? 'stable' : platform.crumblePhase,
            crumble: platform.crumble ? { ...platform.crumble, triggeredAt: undefined } : undefined,
          }));
          newState.platforms = updateDynamicPlatforms(newState.platforms, newState.gameTime).platforms;

          const backbone = newState.platforms.filter(platform =>
            (platform.routeRole === 'start' || platform.routeRole === 'backbone') && isPlatformSolid(platform)
          );
          if (backbone.length >= 2) {
            const maxAnchor = Math.max(0, Math.min(backbone.length - 2, Math.floor((backbone.length - 2) * 0.45)));
            const anchorIndex = Math.floor(Math.random() * (maxAnchor + 1));
            const chaserPlatform = backbone[anchorIndex];
            const evaderPlatform = backbone[Math.min(backbone.length - 1, anchorIndex + 1)];
            const evaders = newState.agents.filter(a => a.id !== itId);

            const place = (agent: AgentState, platform: PlatformState, ratio: number, role: 'chaser' | 'evader') => {
              const usable = Math.max(AGENT_WIDTH + 8, platform.width - AGENT_WIDTH);
              const x = platform.position.x + Math.max(4, Math.min(usable - 4, usable * ratio));
              const y = platform.position.y - AGENT_HEIGHT;
              agent.position = { x, y };
              agent.velocity = { x: 0, y: 0 };
              agent.acceleration = { x: 0, y: 0 };
              agent.isOnGround = true;
              agent.lastPlatformId = platform.id;
              agent.energy = Math.max(0, Math.min(agent.maxEnergy, agent.energy));
              agent.energyAtLastTakeoff = agent.energy;
              agent.positionAtLastTakeoff = { x, y };
              agent.survivalTime = 0;
              agent.timeSinceBecameIt = 0;
              agent.role = role;
              agent.modelId = role === 'chaser'
                ? `champion_chaser_g${installedChampionGenerationRef.current.chaser}`
                : `champion_evader_g${installedChampionGenerationRef.current.evader}`;
            };

            place(currentIt, chaserPlatform, visualFlowDirectionRef.current === 1 ? 0.68 : 0.32, 'chaser');
            currentIt.status = AgentStatus.It;
            currentIt.cooldownTimer = 700;
            evaders.forEach((agent, index) => {
              const ratios = visualFlowDirectionRef.current === 1 ? [0.30, 0.72] : [0.70, 0.28];
              place(agent, evaderPlatform, ratios[index] ?? 0.5, 'evader');
              agent.status = AgentStatus.Cooldown;
              agent.cooldownTimer = 850;
            });

            const minGroupX = Math.min(...newState.agents.map(a => a.position.x));
            const maxGroupX = Math.max(...newState.agents.map(a => a.position.x + AGENT_WIDTH));
            newState.cameraPosition.x = (minGroupX + maxGroupX) / 2 - viewportSize.width / 2;
          }
        }

        // 4. Tag Detection & role swap between the current NEAT champions
        let tagEvent: { taggerId?: number; taggedId?: number } = {};
        const itAgent = hadFall ? undefined : newState.agents.find(a => a.status === AgentStatus.It);

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
            viewportSize
          );
          rewardBreakdowns[agent.id] = breakdown;
        });

        // Evolution is intentionally absent from the main thread; the worker owns generations.

        // Training diagnostics are worker-owned. The champion view keeps only its local
        // survival/tag-time history so resetting it cannot corrupt evolutionary metrics.

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
        const desiredCameraX = runnersCenterX - viewportSize.width * 0.45;
        newState.cameraPosition.x += (desiredCameraX - newState.cameraPosition.x) * 0.12;

        // 10. Course geometry is generated deterministically at episode/reset boundaries; only dynamic platform state changes here.

        // 11. Tag Visual Effects
        newState.tagEffects = newState.tagEffects
          .map(effect => ({ ...effect, life: effect.life - deltaTime }))
          .filter(effect => effect.life > 0);

        // Attach UI State
        newState.agents = newState.agents.map(agent => {
          const breakdown = rewardBreakdowns[agent.id] || {};
          const stateVector = getAgentStateVector(agent, newState, viewportSize);

          return {
            ...agent,
            stateVector,
            rewardBreakdown: breakdown,
          };
        });

        return newState;
      });
    },
    [isSimulating, viewportSize]
  );

  const updateSimulation = useCallback(
    (_deltaTime: number) => {
      if (isVisualPaused && !stepFrameRef.current) return;
      if (stepFrameRef.current) {
        stepFrameRef.current = false;
        updateGame(16.67);
        return;
      }

      // Champion-view speed is a rendering-time multiplier only. Fractional speeds are
      // supported via an accumulator; training throughput is controlled separately.
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

  const handleToggleLidar = () => {
    playToggleSound(!showLidar);
    setShowLidar(prev => !prev);
  };


  const handleResetChampionGame = useCallback(() => {
    const freshCourse = generateCourse({
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      difficulty: curriculumDifficultyRef.current,
      viewport: viewportSizeRef.current,
      length: 24000,
    });
    visualFlowDirectionRef.current = freshCourse.flowDirection;
    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    visualTagsRef.current = 0;
    visualFallsRef.current = 0;
    visualJumpsRef.current = 0;
    actionCountsRef.current = { all: {}, chaser: {}, evader: {} };
    visualStepAccumulatorRef.current = 0;

    setGameState(prev => {
      if (!prev) return prev;
      const startPlatform = freshCourse.platforms.find(p => p.id === 0) || freshCourse.platforms[0];
      const startY = startPlatform.position.y - AGENT_HEIGHT;
      const agents = prev.agents.map((agent, index) => {
        const isChaser = index === 0;
        return {
          ...agent,
          position: { x: freshCourse.startXs[index] ?? freshCourse.startXs[0], y: startY },
          velocity: { x: 0, y: 0 },
          acceleration: { x: 0, y: 0 },
          status: isChaser ? AgentStatus.It : AgentStatus.Normal,
          role: isChaser ? 'chaser' as const : 'evader' as const,
          cooldownTimer: 0,
          isOnGround: true,
          energy: MAX_ENERGY,
          maxEnergy: MAX_ENERGY,
          lastPlatformId: 0,
          survivalTime: 0,
          timeSinceBecameIt: 0,
          trajectory: [],
          modelId: isChaser
            ? `champion_chaser_g${installedChampionGenerationRef.current.chaser}`
            : `champion_evader_g${installedChampionGenerationRef.current.evader}`,
        };
      });
      return {
        ...prev,
        agents,
        platforms: freshCourse.platforms,
        courseGraph: freshCourse.graph,
        cameraPosition: { x: 0, y: 0 },
        gameTime: 0,
        tagEffects: [],
        avgSurvivalTime: 0,
        avgTimeToTag: 0,
      };
    });
  }, []);

  const handleResetWeights = () => {
    // Evolution reset is independent from the champion arena. The running visible match
    // continues in-place and will hot-swap to the fresh worker champions when they arrive.
    if (chaserAgent.current) chaserAgent.current.resetWeights();
    if (evaderAgent.current) evaderAgent.current.resetWeights();
    installedChampionGenerationRef.current = { chaser: -1, evader: -1 };
    if (workerRef.current) workerRef.current.postMessage({ type: 'RESET' });
    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;
    totalTagsRef.current = 0;
    totalFallsRef.current = 0;
    totalJumpsRef.current = 0;
    curriculumDifficultyRef.current = 0.08;

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
      hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: NEAT_HOF_MAX_SIZE, opponentsPerGenome: CONTINUOUS_HOF_MATCHUP_CHANCE, chaserGenerations: [], evaderGenerations: [] },
      lastGenerationBalance: null,
      balanceHistory: [],
      curriculum: undefined,
      continuousTraining: undefined,
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

  if (isLoading || !gameState) {
    return <div className="flex items-center justify-center h-screen text-cyan-400 font-mono">Loading Artwork...</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 font-sans p-4 gap-3 select-none">
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
            <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-1" title="Persistent champion game speed">
              <MonitorPlay className="w-3.5 h-3.5 text-cyan-300 ml-1" />
              <span className="text-[10px] uppercase tracking-wider text-cyan-300 mr-1">View</span>
              {[0.5, 1, 2, 5, 10].map(speed => (
                <button
                  key={speed}
                  onClick={() => setVisualSpeed(speed)}
                  className={`px-2 py-1 text-[11px] font-mono font-semibold rounded ${visualSpeed === speed ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-900'}`}
                >{speed}x</button>
              ))}
            </div>
            <button onClick={() => setIsVisualPaused(p => !p)} className="p-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800" title={isVisualPaused ? 'Resume champion view' : 'Pause champion view'}>
              {isVisualPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button onClick={handleResetChampionGame} className="px-2.5 py-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800 flex items-center gap-1.5 text-[11px] font-semibold" title="Reset champion game only">
              <RotateCcw className="w-3.5 h-3.5" />Reset view
            </button>
          </div>

          {/* Independent background-training controls */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-1" title="Background worker throughput">
              <Cpu className="w-3.5 h-3.5 text-amber-300 ml-1" />
              <span className="text-[10px] uppercase tracking-wider text-amber-300 mr-1">Train</span>
              {[10, 25, 50, 100, 200].map(speed => (
                <button
                  key={speed}
                  onClick={() => setWorkerSpeed(speed)}
                  className={`px-2 py-1 text-[11px] font-mono font-semibold rounded ${workerSpeed === speed ? 'bg-amber-400 text-black' : 'text-gray-400 hover:text-amber-300 hover:bg-gray-900'}`}
                >{speed}x</button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-1" title="Number of persistent background training arenas">
              <span className="text-[10px] uppercase tracking-wider text-violet-300 ml-1 mr-1">Arenas</span>
              {[2, 4, 6, 8, 12, 16].map(count => (
                <button
                  key={count}
                  onClick={() => setTrainingArenaCount(count)}
                  className={`px-2 py-1 text-[11px] font-mono font-semibold rounded ${trainingArenaCount === count ? 'bg-violet-400 text-black' : 'text-gray-400 hover:text-violet-300 hover:bg-gray-900'}`}
                >{count}</button>
              ))}
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
          ref={mainContainerRef}
          className="flex-grow bg-black rounded-xl border border-gray-800 shadow-2xl overflow-hidden relative"
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
              <div className="font-mono mt-0.5">Chaser G{diagnosticsState.lastChaserNeatMetrics?.generation ?? 0} · Runner G{diagnosticsState.lastEvaderNeatMetrics?.generation ?? 0}</div>
            </div>
          )}
          {isSimulating && mainContainerRef.current && (
            <GameCanvas
              gameState={gameState}
              viewportWidth={viewportSize.width}
              viewportHeight={viewportSize.height}
              onFrameReady={() => {}}
              showTrails={showTrails}
              showLidar={showLidar}
            />
          )}
        </main>
        <InfoPanel
          agents={gameState.agents}
          isSimulating={isSimulating}
            showTrails={showTrails}
          onToggleTrails={handleToggleTrails}
          showLidar={showLidar}
          onToggleLidar={handleToggleLidar}
          avgSurvivalTime={gameState.avgSurvivalTime}
          avgTimeToTag={gameState.avgTimeToTag}
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
        workerSpeed={workerSpeed}
        onSetWorkerSpeed={setWorkerSpeed}
        trainingArenaCount={trainingArenaCount}
        onSetTrainingArenaCount={setTrainingArenaCount}
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
