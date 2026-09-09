import { DEFAULT_TRAINING_FITNESS_CONFIG, sanitizeTrainingFitnessConfig } from './learning/trainingFitnessConfig';
import { resolveRunnerContacts } from './learning/bodyContacts';
import { useExhibitionMode } from './hooks/useExhibitionMode';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { InfoPanel } from './components/InfoPanel';
import { PerformanceDiagnostics } from './components/PerformanceDiagnostics';
import { useGameLoop } from './hooks/useGameLoop';
import { LearningAgent } from './learning/agent';
import { DEFAULT_NETWORK_ARCHITECTURE_SUITE, sanitizeNetworkArchitectureSuite, type NetworkArchitectureSuiteConfig } from './learning/neat';
import { createLeaderboardEntries } from './learning/elo';
import { getAgentStateVector } from './learning/state';
import { initAudio, playDynamicJumpSound, playTagSound, playFallSound, playToggleSound } from './services/soundService';
import {
  deleteStoredCheckpoint,
  listStoredCheckpoints,
  migrateLegacyLocalStorageCheckpoint,
  readStoredCheckpoint,
  saveStoredCheckpoint,
  validateFullCheckpointJson,
  type StoredCheckpointSummary,
} from './services/checkpointStore';
import {
  advanceRoleTimers,
  maintainPlatformsForCamera,
  resolveTagSwap,
  stepAgentPhysics,
  updateChaseCameraX,
  stepMovingPlatformsInPlace,
  evaluateChaseEscape,
  getVisualChaserEscapeRecovery,
} from './learning/simulationCore';
import type {
  GameState,
  AgentState,
  PlatformState,
  DiagnosticsState,
  PerformanceDataPoint,
  UpgradeConfig,
  UpgradeRule,
  SprintUpgradeRule,
  ActiveUpgradeState,
  TrainingFitnessConfig,
  TerrainVarietyConfig,
} from './types';
import { AgentStatus } from './types';
import {
  AGENT_WIDTH,
  MAX_SPEED,
  PLATFORM_HEIGHT,
  AGENT_COLORS,
  MAX_ENERGY,
  SPRINT_MAX_SPEED,
  SPRINT_ENERGY_COST_PER_SEC,
  SURVIVAL_TIME_HISTORY_LENGTH,
  TIME_TO_TAG_HISTORY_LENGTH,
  INITIAL_ELO,
  POLICY_CONTROL_ACTIVE_THRESHOLD,
  NEW_CHASER_TAG_DELAY_MS,
} from './constants';
import { Activity, Play, Pause, RotateCcw, MonitorPlay, Cpu, Minus, Plus } from 'lucide-react';
import { DEFAULT_TERRAIN_VARIETY_CONFIG, continuousTerrainRuntime, sanitizeTerrainVarietyConfig } from './learning/terrainConfig';
import { DEFAULT_BIOME_WORLD_SEED, stampPlatformVisualBiome } from './world/biomes';
import type { DayNightConfig } from './world/dayNight';
import { DAY_NIGHT_STORAGE_KEY, createDefaultDayNightConfig, resolveWorldHour, sanitizeDayNightConfig } from './world/dayNight';

// Champion trails are visual telemetry only. They are sampled by distance but aged by
// simulation time, so a stationary agent's old path still fades away.
const MAX_TRAIL_POINTS = 128;
const TRAIL_SAMPLE_DISTANCE = 4;
export const TRAIL_LIFETIME_MS = 3200;

const updateTrail = (
  trajectory: AgentState['trajectory'] | undefined,
  position: AgentState['position'],
  nowMs: number
): AgentState['trajectory'] => {
  const cutoff = nowMs - TRAIL_LIFETIME_MS;
  const liveTrail = (trajectory || []).filter(point => point.timestamp >= cutoff);
  const last = liveTrail[liveTrail.length - 1];

  // Do not require movement to age the trail: pruning above happens every physics tick.
  if (last && Math.hypot(position.x - last.x, position.y - last.y) < TRAIL_SAMPLE_DISTANCE) {
    return liveTrail;
  }

  return [
    ...liveTrail.slice(-(MAX_TRAIL_POINTS - 1)),
    { x: position.x, y: position.y, timestamp: nowMs },
  ];
};

const formatTrainingRate = (value: number | undefined) => {
  const safe = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(1)}M`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}k`;
  if (safe >= 100) return safe.toFixed(0);
  if (safe >= 10) return safe.toFixed(1);
  return safe.toFixed(2);
};

const CHAMPION_WORLD_VIEWPORT = { width: 1200, height: 800 } as const;
const DEFAULT_UPGRADE_CONFIG: UpgradeConfig = {
  sprint: {
    mode: 'off', chaserEnabled: true, runnerEnabled: true,
    chaserAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
    runnerAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
  },
  controlledJump: { mode: 'off', chaserEnabled: true, runnerEnabled: true },
};
const UPGRADE_STORAGE_KEY = 'ai_tag_upgrade_config';

const loadUpgradeConfig = (): UpgradeConfig => {
  try {
    const raw = localStorage.getItem(UPGRADE_STORAGE_KEY);
    if (!raw) return DEFAULT_UPGRADE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<UpgradeConfig>;
    const normalize = (rule: Partial<UpgradeRule> | undefined, fallback: UpgradeRule): UpgradeRule => ({
      // Legacy 'auto' configs migrate to off: abilities are manual-only in this build.
      mode: rule?.mode === 'on' ? 'on' : 'off',
      chaserEnabled: typeof rule?.chaserEnabled === 'boolean' ? rule.chaserEnabled : fallback.chaserEnabled,
      runnerEnabled: typeof rule?.runnerEnabled === 'boolean' ? rule.runnerEnabled : fallback.runnerEnabled,
    });
    const normalizeAdvanced = (value: any, fallback: SprintUpgradeRule['chaserAdvanced']) => ({
      maxSpeedOverride: typeof value?.maxSpeedOverride === 'boolean' ? value.maxSpeedOverride : fallback.maxSpeedOverride,
      maxSpeed: Number.isFinite(Number(value?.maxSpeed)) ? Math.max(MAX_SPEED, Math.min(20, Number(value.maxSpeed))) : fallback.maxSpeed,
      staminaCostOverride: typeof value?.staminaCostOverride === 'boolean' ? value.staminaCostOverride : fallback.staminaCostOverride,
      staminaCostPerSec: Number.isFinite(Number(value?.staminaCostPerSec)) ? Math.max(0, Math.min(200, Number(value.staminaCostPerSec))) : fallback.staminaCostPerSec,
    });
    const sprintBase = normalize(parsed.sprint, DEFAULT_UPGRADE_CONFIG.sprint);
    return {
      sprint: {
        ...sprintBase,
        chaserAdvanced: normalizeAdvanced((parsed.sprint as Partial<SprintUpgradeRule> | undefined)?.chaserAdvanced, DEFAULT_UPGRADE_CONFIG.sprint.chaserAdvanced),
        runnerAdvanced: normalizeAdvanced((parsed.sprint as Partial<SprintUpgradeRule> | undefined)?.runnerAdvanced, DEFAULT_UPGRADE_CONFIG.sprint.runnerAdvanced),
      },
      controlledJump: normalize(parsed.controlledJump, DEFAULT_UPGRADE_CONFIG.controlledJump),
    };
  } catch {
    return DEFAULT_UPGRADE_CONFIG;
  }
};

const TRAINING_FITNESS_STORAGE_KEY = 'ai_tag_training_fitness_config_pace_v3';


const loadTrainingFitnessConfig = (): TrainingFitnessConfig => {
  try {
    const raw = localStorage.getItem(TRAINING_FITNESS_STORAGE_KEY);
    if (!raw) return DEFAULT_TRAINING_FITNESS_CONFIG;
    return sanitizeTrainingFitnessConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_TRAINING_FITNESS_CONFIG;
  }
};

const TERRAIN_VARIETY_STORAGE_KEY = 'ai_tag_terrain_variety_config_v1';
const loadTerrainVarietyConfig = (): TerrainVarietyConfig => {
  try {
    const raw = localStorage.getItem(TERRAIN_VARIETY_STORAGE_KEY);
    return raw ? sanitizeTerrainVarietyConfig(JSON.parse(raw)) : { ...DEFAULT_TERRAIN_VARIETY_CONFIG };
  } catch {
    return { ...DEFAULT_TERRAIN_VARIETY_CONFIG };
  }
};

const loadDayNightConfig = (): DayNightConfig => {
  try {
    const raw = localStorage.getItem(DAY_NIGHT_STORAGE_KEY);
    return raw ? sanitizeDayNightConfig(JSON.parse(raw)) : createDefaultDayNightConfig();
  } catch {
    return createDefaultDayNightConfig();
  }
};

const NETWORK_ARCHITECTURE_STORAGE_KEY = 'ai_tag_network_architecture_suite_v1';
const loadNetworkArchitecture = (): NetworkArchitectureSuiteConfig => {
  try {
    const raw = localStorage.getItem(NETWORK_ARCHITECTURE_STORAGE_KEY);
    return raw ? sanitizeNetworkArchitectureSuite(JSON.parse(raw)) : sanitizeNetworkArchitectureSuite(DEFAULT_NETWORK_ARCHITECTURE_SUITE);
  } catch {
    return sanitizeNetworkArchitectureSuite(DEFAULT_NETWORK_ARCHITECTURE_SUITE);
  }
};

export const App: React.FC = () => {
  const { exhibition, setExhibition, controlsVisible, revealControls } = useExhibitionMode();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  // Rendering uses a fixed 1200x800 reference frame; physics and policy senses are world-relative.
  const viewportSize = CHAMPION_WORLD_VIEWPORT;
  const [showTrails, setShowTrails] = useState(true);
  const [showSenses, setShowSenses] = useState(true);

  // The visible champion arena and background evolution are controlled independently.
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [visualSpeed, setVisualSpeed] = useState(1);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [dayNightConfig, setDayNightConfig] = useState<DayNightConfig>(loadDayNightConfig);
  const [isVisualPaused, setIsVisualPaused] = useState(false);
  const [isTrainingPaused, setIsTrainingPaused] = useState(false);
  const [upgradeConfig, setUpgradeConfig] = useState<UpgradeConfig>(loadUpgradeConfig);
  const [trainingFitnessConfig, setTrainingFitnessConfig] = useState<TrainingFitnessConfig>(loadTrainingFitnessConfig);
  const [terrainVarietyConfig, setTerrainVarietyConfig] = useState<TerrainVarietyConfig>(loadTerrainVarietyConfig);
  const [networkArchitecture, setNetworkArchitecture] = useState<NetworkArchitectureSuiteConfig>(loadNetworkArchitecture);
  const [storedCheckpoints, setStoredCheckpoints] = useState<StoredCheckpointSummary[]>([]);
  const [checkpointLibraryBusy, setCheckpointLibraryBusy] = useState(false);
  const [checkpointLibraryMessage, setCheckpointLibraryMessage] = useState<string | null>(null);
  const stepFrameRef = useRef(false);
  const visualStepAccumulatorRef = useRef(0);
  const wakeLockRef = useRef<any>(null);
  const [trainingWakeLockActive, setTrainingWakeLockActive] = useState(false);

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
    totalChaserFalls: 0,
    totalChaserEscapes: 0,
    totalRunnerFalls: 0,
    totalSuccessfulJumps: 0,
    actionDistribution: {},
    chaserActionDistribution: {},
    evaderActionDistribution: {},
    generation: 0,
    chaserElo: INITIAL_ELO,
    evaderElo: INITIAL_ELO,
    eloLeaderboard: createLeaderboardEntries(INITIAL_ELO, INITIAL_ELO, 0, 0, 0, 0, 0, 0, 0),
    hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: 12, opponentsPerGenome: 1, chaserGenerations: [], evaderGenerations: [], chaserRecentSize: 0, evaderRecentSize: 0, chaserDiverseSize: 0, evaderDiverseSize: 0, chaserDiversity: 0, evaderDiversity: 0 },
    lastCrossGenerationBenchmark: null,
    benchmarkHistory: [],
    benchmarkSuiteRevision: 0,
    showcasePair: null,
    lastGenerationBalance: null,
    balanceHistory: [],
    trainingSpeedX: 0,
    trainingEpisodesPerSecond: 0,
    trainingBackend: 'CPU optimized',
    trainingWorkerCount: 1,
    trainingRecoveryCount: 0,
    trainingLastRecoveryReason: '',
    sprintUpgradeActive: false,
    controlledJumpUpgradeActive: false,
    trainingFitnessConfig: loadTrainingFitnessConfig(),
    networkArchitecture: loadNetworkArchitecture(),
    terrainVarietyConfig: loadTerrainVarietyConfig(),
  }));



  const lastTelemetryTimeRef = useRef(0);
  const actionCountsRef = useRef<{
    all: Record<string, number>;
    chaser: Record<string, number>;
    evader: Record<string, number>;
  }>({ all: {}, chaser: {}, evader: {} });
  const totalTagsRef = useRef(0);
  const totalFallsRef = useRef(0);
  const totalJumpsRef = useRef(0);
  const visualTagsRef = useRef(0);
  const visualFallsRef = useRef(0);

  const mainContainerRef = useRef<HTMLDivElement>(null);
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
  const installedChampionGenerationRef = useRef({ chaser: -1, evader: -1 });
  const installedChampionGenomeIdRef = useRef<{ chaser: string | null; evader: string | null }>({ chaser: null, evader: null });
  const checkpointRequestCounterRef = useRef(1);
  const analysisRequestCounterRef = useRef(1);
  const pendingCheckpointActionRef = useRef<{ requestId: number; action: 'library' | 'export'; name?: string } | null>(null);
  const pendingRestoreDiagnosticsRef = useRef<DiagnosticsState | null>(null);
  const diagnosticsStateRef = useRef(diagnosticsState);
  diagnosticsStateRef.current = diagnosticsState;

  const refreshStoredCheckpointLibrary = useCallback(async () => {
    try {
      const items = await listStoredCheckpoints();
      setStoredCheckpoints(items);
    } catch (error) {
      console.error('Failed to read checkpoint library:', error);
      setCheckpointLibraryMessage('Checkpoint library is unavailable in this browser. Export JSON files instead.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateLegacyLocalStorageCheckpoint('ai_tag_studio_models');
        if (!cancelled) await refreshStoredCheckpointLibrary();
      } catch (error) {
        console.error('Failed to initialize checkpoint library:', error);
        if (!cancelled) setCheckpointLibraryMessage('Could not initialize the checkpoint library.');
      }
    })();
    return () => { cancelled = true; };
  }, [refreshStoredCheckpointLibrary]);

  const initializeGameState = useCallback(() => {
    chaserAgent.current = new LearningAgent('chaser');
    evaderAgent.current = new LearningAgent('evader');

    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;

    const initialPlatforms: PlatformState[] = [
      stampPlatformVisualBiome({ id: 0, position: { x: 0, y: viewportSize.height - 100 }, width: viewportSize.width, height: PLATFORM_HEIGHT }, DEFAULT_BIOME_WORLD_SEED),
    ];

    const initialAgents: AgentState[] = [
      {
        id: 1,
        position: { x: 100, y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[0],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'idle',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: 100, y: 500, timestamp: 0 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: 100, y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'current_evader',
      },
      {
        id: 2,
        position: { x: 400, y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[1],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'idle',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: 400, y: 500, timestamp: 0 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: 400, y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'current_evader',
      },
      {
        id: 3,
        position: { x: 700, y: 500 },
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        status: AgentStatus.Normal,
        role: 'evader',
        elo: INITIAL_ELO,
        color: AGENT_COLORS[2],
        isOnGround: false,
        cooldownTimer: 0,
        lastAction: 'idle',
        energy: MAX_ENERGY,
        maxEnergy: MAX_ENERGY,
        trajectory: [{ x: 700, y: 500, timestamp: 0 }],
        lastPlatformId: 0,
        scale: { x: 1, y: 1 },
        energyAtLastTakeoff: MAX_ENERGY,
        positionAtLastTakeoff: { x: 700, y: 500 },
        survivalTime: 0,
        timeSinceBecameIt: 0,
        modelId: 'current_evader',
      },
    ];

    const itAgent = initialAgents[0];
    itAgent.status = AgentStatus.It;
    itAgent.role = 'chaser';
    itAgent.modelId = 'current_chaser';
    itAgent.elo = INITIAL_ELO;

    const newGameState: GameState = {
      agents: initialAgents,
      worldSeed: DEFAULT_BIOME_WORLD_SEED,
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
  }, [viewportSize]);

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
          lastTelemetryTimeRef.current = Date.now();
          if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
          if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
          if (typeof payload.totalTags === 'number') totalTagsRef.current = payload.totalTags;
          if (typeof payload.totalFalls === 'number') totalFallsRef.current = payload.totalFalls;
          if (typeof payload.totalJumps === 'number') totalJumpsRef.current = payload.totalJumps;
          if (payload.networkArchitecture) {
            const incomingArchitecture = sanitizeNetworkArchitectureSuite(payload.networkArchitecture);
            setNetworkArchitecture(prev => JSON.stringify(prev) === JSON.stringify(incomingArchitecture) ? prev : incomingArchitecture);
          }

          // Hot-swap completed-generation champions into the persistent visible arena.
          // The bodies keep their positions, velocity, stamina, roles and game state.
          const generation = payload.generation || 0;
          const chaserChampionGeneration = payload.chaserChampionGeneration ?? payload.lastChaserNeatMetrics?.generation ?? generation;
          const evaderChampionGeneration = payload.evaderChampionGeneration ?? payload.lastEvaderNeatMetrics?.generation ?? generation;
          const chaserChampionId = payload.chaserChampionGenome?.id ?? null;
          const evaderChampionId = payload.evaderChampionGenome?.id ?? null;
          if (payload.chaserChampionGenome && chaserAgent.current && (chaserChampionGeneration !== installedChampionGenerationRef.current.chaser || chaserChampionId !== installedChampionGenomeIdRef.current.chaser)) {
            chaserAgent.current.setWeights(payload.chaserChampionGenome);
            chaserAgent.current.setGeneration(chaserChampionGeneration);
            installedChampionGenerationRef.current.chaser = chaserChampionGeneration;
            installedChampionGenomeIdRef.current.chaser = chaserChampionId;
          }
          if (payload.evaderChampionGenome && evaderAgent.current && (evaderChampionGeneration !== installedChampionGenerationRef.current.evader || evaderChampionId !== installedChampionGenomeIdRef.current.evader)) {
            evaderAgent.current.setWeights(payload.evaderChampionGenome);
            evaderAgent.current.setGeneration(evaderChampionGeneration);
            installedChampionGenerationRef.current.evader = evaderChampionGeneration;
            installedChampionGenomeIdRef.current.evader = evaderChampionId;
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
            const benchmarkMetric = payload.lastCrossGenerationBenchmark;
            const incomingBenchmarkRevision = typeof payload.benchmarkSuiteRevision === 'number'
              ? payload.benchmarkSuiteRevision
              : (prev.benchmarkSuiteRevision ?? 0);
            const benchmarkRevisionChanged = incomingBenchmarkRevision !== (prev.benchmarkSuiteRevision ?? 0);
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
              totalChaserFalls: payload.totalChaserFalls,
              totalChaserEscapes: payload.totalChaserEscapes,
              totalRunnerFalls: payload.totalRunnerFalls,
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
              lastCrossGenerationBenchmark: benchmarkMetric || (benchmarkRevisionChanged ? null : prev.lastCrossGenerationBenchmark),
              benchmarkHistory: appendUnique(benchmarkRevisionChanged ? [] : prev.benchmarkHistory, benchmarkMetric),
              benchmarkSuiteRevision: incomingBenchmarkRevision,
              chaserGeneralistChampion: payload.chaserGeneralistChampion !== undefined ? payload.chaserGeneralistChampion : (prev.chaserGeneralistChampion ?? null),
              evaderGeneralistChampion: payload.evaderGeneralistChampion !== undefined ? payload.evaderGeneralistChampion : (prev.evaderGeneralistChampion ?? null),
              showcasePair: payload.showcasePair !== undefined ? payload.showcasePair : (prev.showcasePair ?? null),
              lastGenerationBalance: balanceMetric || prev.lastGenerationBalance,
              balanceHistory: appendUnique(prev.balanceHistory, balanceMetric),
              trainingSpeedX: typeof payload.trainingSpeedX === 'number' ? payload.trainingSpeedX : prev.trainingSpeedX,
              trainingEpisodesPerSecond: typeof payload.trainingEpisodesPerSecond === 'number' ? payload.trainingEpisodesPerSecond : prev.trainingEpisodesPerSecond,
              trainingBackend: typeof payload.trainingBackend === 'string' ? payload.trainingBackend : prev.trainingBackend,
              trainingWorkerCount: typeof payload.trainingWorkerCount === 'number' ? payload.trainingWorkerCount : prev.trainingWorkerCount,
              trainingRecoveryCount: typeof payload.trainingRecoveryCount === 'number' ? payload.trainingRecoveryCount : prev.trainingRecoveryCount,
              trainingLastRecoveryReason: typeof payload.trainingLastRecoveryReason === 'string' ? payload.trainingLastRecoveryReason : prev.trainingLastRecoveryReason,
              sprintUpgradeActive: typeof payload.sprintUpgradeActive === 'boolean' ? payload.sprintUpgradeActive : prev.sprintUpgradeActive,
              controlledJumpUpgradeActive: typeof payload.controlledJumpUpgradeActive === 'boolean' ? payload.controlledJumpUpgradeActive : prev.controlledJumpUpgradeActive,
              trainingFitnessConfig: payload.trainingFitnessConfig || prev.trainingFitnessConfig,
              terrainVarietyConfig: payload.terrainVarietyConfig || prev.terrainVarietyConfig,
              networkArchitecture: payload.networkArchitecture || prev.networkArchitecture,
              pursuitDesign: payload.pursuitDesign !== undefined ? payload.pursuitDesign : (prev.pursuitDesign ?? null),
              pursuitDesignFlags: payload.pursuitDesignFlags || prev.pursuitDesignFlags,
              selectionAggregation: payload.selectionAggregation || prev.selectionAggregation,
              historicalOpponentPanel: payload.historicalOpponentPanel || prev.historicalOpponentPanel,
              eliteSeeding: payload.eliteSeeding || prev.eliteSeeding,
            };
          });

        } else if (type === 'ANALYSIS_EXPORT_RESPONSE') {
          if (payload?.error || !payload?.analysis) {
            console.error('Failed to build training analysis export:', payload?.error || 'Unknown analysis export error');
            return;
          }
          const exportPayload = {
            ...payload.analysis,
            uiDiagnostics: diagnosticsStateRef.current,
          };
          const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `neat_tag_analysis_gen${payload.analysis.generation || 0}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } else if (type === 'CHECKPOINT_RESPONSE') {
          const pending = pendingCheckpointActionRef.current;
          if (!pending || pending.requestId !== payload?.requestId || !payload?.checkpoint) return;
          pendingCheckpointActionRef.current = null;
          const checkpoint = payload.checkpoint;
          const filePayload = {
            version: '4.2.0',
            algorithm: 'NEAT',
            kind: 'full-evolution-checkpoint',
            timestamp: Date.now(),
            generation: checkpoint.generation,
            evolutionCheckpoint: checkpoint,
            uiDiagnostics: diagnosticsStateRef.current,
          };
          // Pretty-printing a full population checkpoint can double the temporary string footprint.
          // Keep the file compact; it remains ordinary JSON and imports identically.
          const serialized = JSON.stringify(filePayload);
          if (pending.action === 'library') {
            const name = pending.name?.trim() || `Generation ${checkpoint.generation}`;
            saveStoredCheckpoint(serialized, name)
              .then(summary => {
                setCheckpointLibraryMessage(`Saved “${summary.name}” at generation ${summary.generation}.`);
                return refreshStoredCheckpointLibrary();
              })
              .catch(error => {
                console.error('Failed to save checkpoint to library:', error);
                setCheckpointLibraryMessage(`Save failed: ${error instanceof Error ? error.message : 'unknown storage error'}`);
              })
              .finally(() => setCheckpointLibraryBusy(false));
          } else {
            const blob = new Blob([serialized], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `neat_tag_checkpoint_gen${checkpoint.generation}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setCheckpointLibraryMessage(`Exported generation ${checkpoint.generation} checkpoint.`);
            setCheckpointLibraryBusy(false);
          }
        } else if (type === 'RESTORE_CHECKPOINT_RESPONSE') {
          if (!payload?.ok) {
            console.error('Failed to restore full evolution checkpoint:', payload?.message || 'Unknown checkpoint error');
            pendingRestoreDiagnosticsRef.current = null;
            setCheckpointLibraryMessage(`Load failed: ${payload?.message || 'unknown checkpoint error'}`);
            setCheckpointLibraryBusy(false);
          } else {
            if (pendingRestoreDiagnosticsRef.current) setDiagnosticsState(pendingRestoreDiagnosticsRef.current);
            pendingRestoreDiagnosticsRef.current = null;
            setCheckpointLibraryMessage('Checkpoint restored successfully.');
            setCheckpointLibraryBusy(false);
          }
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

  useEffect(() => {
    localStorage.setItem(UPGRADE_STORAGE_KEY, JSON.stringify(upgradeConfig));
    workerRef.current?.postMessage({ type: 'SET_UPGRADE_CONFIG', payload: { upgradeConfig } });
  }, [upgradeConfig]);

  useEffect(() => {
    localStorage.setItem(TRAINING_FITNESS_STORAGE_KEY, JSON.stringify(trainingFitnessConfig));
    workerRef.current?.postMessage({
      type: 'SET_TRAINING_FITNESS_CONFIG',
      payload: { trainingFitnessConfig },
    });
  }, [trainingFitnessConfig]);

  useEffect(() => {
    const sanitized = sanitizeTerrainVarietyConfig(terrainVarietyConfig);
    localStorage.setItem(TERRAIN_VARIETY_STORAGE_KEY, JSON.stringify(sanitized));
    workerRef.current?.postMessage({
      type: 'SET_TERRAIN_VARIETY_CONFIG',
      payload: { terrainVarietyConfig: sanitized },
    });
  }, [terrainVarietyConfig]);

  useEffect(() => {
    localStorage.setItem(DAY_NIGHT_STORAGE_KEY, JSON.stringify(dayNightConfig));
  }, [dayNightConfig]);

  const updateDayNightConfig = useCallback((patch: Partial<DayNightConfig>) => {
    setDayNightConfig(previous => {
      const now = Date.now();
      const visibleHour = resolveWorldHour(previous, now);
      const next = sanitizeDayNightConfig({ ...previous, ...patch }, now);
      // Entering/changing a custom cycle should not visibly jump the sky. Re-anchor it at the
      // exact world hour currently on screen, then let the new period proceed from there.
      if (next.mode === 'cycle' && (previous.mode !== 'cycle' || next.cycleMinutes !== previous.cycleMinutes)) {
        next.cycleAnchorMs = now;
        next.cycleAnchorHour = visibleHour;
      }
      return next;
    });
  }, []);


  // Background evolution is independent from the visible champion arena and always runs
  // at maximum worker throughput unless explicitly paused.
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
        viewportSize,
        upgradeConfig,
        trainingFitnessConfig,
        terrainVarietyConfig,
        networkArchitecture,
      },
    });
  }, [isTrainingPaused, isSimulating, networkArchitecture]);

  // Keep the display awake while training is actively running. Chromium releases screen wake
  // locks automatically when a document becomes hidden, so reacquire it when the page becomes
  // visible again. If the API is unavailable, training still works and the evaluator watchdog
  // below recovers suspended batches after the browser resumes.
  useEffect(() => {
    let cancelled = false;

    const releaseWakeLock = async () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      setTrainingWakeLockActive(false);
      if (lock?.release) {
        try { await lock.release(); } catch { /* already released */ }
      }
    };

    const requestWakeLock = async () => {
      if (cancelled || !isSimulating || (isTrainingPaused && !exhibition) || document.visibilityState !== 'visible') return;
      if (wakeLockRef.current) return;
      const wakeLockApi = (navigator as any).wakeLock;
      if (!wakeLockApi?.request) return;
      try {
        const lock = await wakeLockApi.request('screen');
        if (cancelled) {
          try { await lock.release(); } catch { /* no-op */ }
          return;
        }
        wakeLockRef.current = lock;
        setTrainingWakeLockActive(true);
        lock.addEventListener?.('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
          setTrainingWakeLockActive(false);
        });
      } catch {
        setTrainingWakeLockActive(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
        // A hidden/sleep transition may have suspended a nested evaluator batch. Nudge the worker
        // immediately instead of waiting for the normal stale-telemetry watchdog.
        workerRef.current?.postMessage({ type: 'WAKE_TRAINING' });
      }
    };

    if (isSimulating && (!isTrainingPaused || exhibition)) void requestWakeLock();
    else void releaseWakeLock();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void releaseWakeLock();
    };
  }, [isSimulating, isTrainingPaused, exhibition]);

  // Main-thread health monitor. A healthy trainer emits telemetry several times per second. If
  // telemetry goes quiet while the page is visible, ask the training worker to recover any stalled
  // evaluator slots. This does not reset populations or the current generation.
  useEffect(() => {
    if (!isSimulating || isTrainingPaused) return;
    lastTelemetryTimeRef.current = Date.now();
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const staleForMs = Date.now() - lastTelemetryTimeRef.current;
      if (staleForMs >= 5000) {
        workerRef.current?.postMessage({ type: 'WAKE_TRAINING', payload: { staleForMs } });
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [isSimulating, isTrainingPaused]);

  const sprintUpgradeActive = upgradeConfig.sprint.mode === 'on';
  const controlledJumpUpgradeActive = upgradeConfig.controlledJump.mode === 'on';

  const updateUpgradeRule = useCallback((upgrade: keyof UpgradeConfig, patch: Partial<UpgradeRule> | Partial<SprintUpgradeRule>) => {
    setUpgradeConfig(prev => ({
      ...prev,
      [upgrade]: { ...prev[upgrade], ...patch },
    }));
  }, []);

  const updateTrainingFitnessConfig = useCallback((patch: Partial<TrainingFitnessConfig>) => {
    setTrainingFitnessConfig(prev => sanitizeTrainingFitnessConfig({ ...prev, ...patch }));
  }, []);

  const updateTerrainVarietyConfig = useCallback((patch: Partial<TerrainVarietyConfig>) => {
    setTerrainVarietyConfig(prev => sanitizeTerrainVarietyConfig({ ...prev, ...patch }));
  }, []);

  const updateGame = useCallback(
    (deltaTime: number) => {
      setGameState(prevGameState => {
        if (!prevGameState || !isSimulating) return prevGameState;

        let newState: GameState = {
          ...prevGameState,
          agents: [...prevGameState.agents.map(a => ({ ...a, trajectory: a.trajectory || [] }))],
          platforms: prevGameState.platforms.map(platform => ({
            ...platform,
            position: { ...platform.position },
            motion: platform.motion ? { ...platform.motion } : undefined,
          })),
          gameTime: prevGameState.gameTime + deltaTime,
          tagEffects: [...prevGameState.tagEffects],
          avgSurvivalTime: prevGameState.avgSurvivalTime,
          avgTimeToTag: prevGameState.avgTimeToTag,
        };

        // 1. Update Timers using the same shared rule as headless training.
        advanceRoleTimers(newState.agents, deltaTime);
        if (terrainVarietyConfig.continuousMovingPlatformsEnabled) {
          stepMovingPlatformsInPlace(newState.platforms, newState.agents, deltaTime, terrainVarietyConfig.movingPlatformsInBranches);
        }

        // 2. Champion action selection using 23-input / 3-output signed-axis NEAT controls.
        // Left/right drive, jump and sprint are independent, so agents can run and jump together.
        const agentActions: {
          [key: number]: {
            action: string;
            moveLeft: number;
            moveRight: number;
            jump: number;
            sprint: number;
          }
        } = {};
        newState.agents.forEach(agent => {
          const stateVector = getAgentStateVector(agent, newState, viewportSize);
          const isChaser = agent.status === AgentStatus.It;
          const role: 'chaser' | 'evader' = isChaser ? 'chaser' : 'evader';
          const previousRole = agent.role;
          agent.role = role;
          agent.elo = isChaser ? chaserElo.current : evaderElo.current;
          agent.modelId = isChaser ? 'current_chaser' : 'current_evader';

          const model = isChaser ? chaserAgent.current : evaderAgent.current;
          if (!model) return;
          if (previousRole && previousRole !== role) model.resetState(agent.id);
          const decision = model.chooseAction(stateVector, agent.id);
          agentActions[agent.id] = {
            action: decision.action,
            moveLeft: decision.moveLeft,
            moveRight: decision.moveRight,
            jump: decision.jump,
            sprint: decision.sprint,
          };

          let active = 0;
          const horizontalDrive = decision.moveRight - decision.moveLeft;
          const movementName = horizontalDrive > POLICY_CONTROL_ACTIVE_THRESHOLD
            ? 'move_right'
            : horizontalDrive < -POLICY_CONTROL_ACTIVE_THRESHOLD
              ? 'move_left'
              : null;
          const activeNames: string[] = [];
          if (movementName) activeNames.push(movementName);
          if (decision.jump >= POLICY_CONTROL_ACTIVE_THRESHOLD) activeNames.push('jump');
          const sprintEnabledForRole = sprintUpgradeActive && (isChaser ? upgradeConfig.sprint.chaserEnabled : upgradeConfig.sprint.runnerEnabled);
          if (sprintEnabledForRole && Math.abs(horizontalDrive) >= POLICY_CONTROL_ACTIVE_THRESHOLD && decision.sprint >= POLICY_CONTROL_ACTIVE_THRESHOLD && agent.energy > 0) activeNames.push('sprint');
          for (const name of activeNames) {
            active++;
            actionCountsRef.current.all[name] = (actionCountsRef.current.all[name] || 0) + 1;
            if (isChaser) actionCountsRef.current.chaser[name] = (actionCountsRef.current.chaser[name] || 0) + 1;
            else actionCountsRef.current.evader[name] = (actionCountsRef.current.evader[name] || 0) + 1;
          }
          if (active === 0) {
            actionCountsRef.current.all.idle = (actionCountsRef.current.all.idle || 0) + 1;
            if (isChaser) actionCountsRef.current.chaser.idle = (actionCountsRef.current.chaser.idle || 0) + 1;
            else actionCountsRef.current.evader.idle = (actionCountsRef.current.evader.idle || 0) + 1;
          }
        });

        // 3. Update Physics & Boundaries through the shared simulation core. The core was
        // extracted from this visual loop, so presentation behavior remains authoritative while
        // headless training now executes the exact same movement/fall rules.
        const activePursuitDesign = diagnosticsStateRef.current.pursuitDesign;
        const activeUpgrades: ActiveUpgradeState = {
          sprint: sprintUpgradeActive,
          controlledJump: controlledJumpUpgradeActive,
          sprintChaser: sprintUpgradeActive && upgradeConfig.sprint.chaserEnabled,
          sprintRunner: sprintUpgradeActive && upgradeConfig.sprint.runnerEnabled,
          controlledJumpChaser: controlledJumpUpgradeActive && upgradeConfig.controlledJump.chaserEnabled,
          controlledJumpRunner: controlledJumpUpgradeActive && upgradeConfig.controlledJump.runnerEnabled,
          sprintChaserMaxSpeed: upgradeConfig.sprint.chaserAdvanced.maxSpeedOverride
            ? upgradeConfig.sprint.chaserAdvanced.maxSpeed
            : SPRINT_MAX_SPEED,
          sprintRunnerMaxSpeed: upgradeConfig.sprint.runnerAdvanced.maxSpeedOverride
            ? upgradeConfig.sprint.runnerAdvanced.maxSpeed
            : SPRINT_MAX_SPEED,
          sprintChaserStaminaCostPerSec: upgradeConfig.sprint.chaserAdvanced.staminaCostOverride
            ? upgradeConfig.sprint.chaserAdvanced.staminaCostPerSec
            : SPRINT_ENERGY_COST_PER_SEC,
          sprintRunnerStaminaCostPerSec: upgradeConfig.sprint.runnerAdvanced.staminaCostOverride
            ? upgradeConfig.sprint.runnerAdvanced.staminaCostPerSec
            : SPRINT_ENERGY_COST_PER_SEC,
          chaserBaseMaxSpeed: activePursuitDesign?.chaserBaseMaxSpeed,
          runnerBaseMaxSpeed: activePursuitDesign?.runnerBaseMaxSpeed,
          postFallRunnerTagProtectionMs: activePursuitDesign?.postFallRunnerTagProtectionMs,
        };
        if (activePursuitDesign) {
          const pursuit = activePursuitDesign;
          if (pursuit.chaserSprintMaxSpeed !== undefined) activeUpgrades.sprintChaserMaxSpeed = pursuit.chaserSprintMaxSpeed;
          if (pursuit.runnerSprintMaxSpeed !== undefined) activeUpgrades.sprintRunnerMaxSpeed = pursuit.runnerSprintMaxSpeed;
          if (pursuit.chaserSprintStaminaCostPerSec !== undefined) activeUpgrades.sprintChaserStaminaCostPerSec = pursuit.chaserSprintStaminaCostPerSec;
          if (pursuit.runnerSprintStaminaCostPerSec !== undefined) activeUpgrades.sprintRunnerStaminaCostPerSec = pursuit.runnerSprintStaminaCostPerSec;
        }

        const agentsBeforePhysics = newState.agents;
        const fallenBodyIds = new Set<number>();
        newState.agents = agentsBeforePhysics.map(agent => {
          const actionDecision = agentActions[agent.id];
          const physics = stepAgentPhysics(
            agent,
            agentsBeforePhysics,
            newState.platforms,
            newState.cameraPosition.x,
            viewportSize,
            deltaTime,
            {
              action: actionDecision?.action || agent.lastAction,
              moveLeft: actionDecision?.moveLeft ?? 0,
              moveRight: actionDecision?.moveRight ?? 0,
              jump: actionDecision?.jump ?? 0,
              sprint: actionDecision?.sprint ?? 0,
            },
            activeUpgrades
          );

          if (physics.jumped && !exhibition) playDynamicJumpSound(physics.jumpVelocity);
          if (physics.fell) {
            fallenBodyIds.add(agent.id);
            visualFallsRef.current++;
            if (!exhibition) playFallSound();
          }

          return physics.agent;
        });

        resolveRunnerContacts(newState.agents, agentsBeforePhysics, newState.platforms);
        newState.agents = newState.agents.map(agent => ({
          ...agent,
          trajectory: fallenBodyIds.has(agent.id)
            ? [{ ...agent.position, timestamp: newState.gameTime }]
            : updateTrail(agent.trajectory, agent.position, newState.gameTime),
        }));

        // 4. Escape detection. Training still treats this as a terminal Chaser failure. In the
        // champion view we keep the world/route alive and teleport only the failed Chaser onto a
        // safe platform roughly 220-360px behind the trailing Runner, retaining route labels for
        // diagnostics. Every generated surface remains physically available after recovery.
        const chaseEscape = evaluateChaseEscape(newState.agents);
        if (chaseEscape.escaped) {
          const recovery = getVisualChaserEscapeRecovery(newState.agents, newState.platforms);
          if (recovery) {
            chaserAgent.current?.resetState();
            newState.agents = newState.agents.map(agent => {
              if (agent.id !== recovery.chaserId) return agent;
              return {
                ...agent,
                position: { ...recovery.position },
                velocity: { x: 0, y: 0 },
                acceleration: { x: 0, y: 0 },
                isOnGround: true,
                cooldownTimer: Math.max(agent.cooldownTimer || 0, NEW_CHASER_TAG_DELAY_MS),
                lastAction: 'idle',
                trajectory: [{ x: recovery.position.x, y: recovery.position.y, timestamp: newState.gameTime }],
                lastPlatformId: recovery.platformId,
                activeRoutePath: recovery.activeRoutePath,
                positionAtLastTakeoff: { ...recovery.position },
                energyAtLastTakeoff: agent.energy,
                timeSinceBecameIt: 0,
                jumpArmed: true,
              };
            });
          }
        }

        // 5. Tag Detection & role swap through the shared visual-game rule.
        const tagTransition = resolveTagSwap(newState.agents);
        if (tagTransition) {
          visualTagsRef.current++;

          recentSurvivalTimes.current.push(tagTransition.survivalTimeMs);
          if (recentSurvivalTimes.current.length > SURVIVAL_TIME_HISTORY_LENGTH) {
            recentSurvivalTimes.current.shift();
          }
          recentTimesToTag.current.push(tagTransition.timeToTagMs);
          if (recentTimesToTag.current.length > TIME_TO_TAG_HISTORY_LENGTH) {
            recentTimesToTag.current.shift();
          }

          // Shared gameplay code owns status/role/cooldown changes; the visible game adds only
          // role-specific UI ratings, sound and the contact flash.
          const newTagger = newState.agents.find(a => a.id === tagTransition.taggedId);
          const oldTagger = newState.agents.find(a => a.id === tagTransition.taggerId);
          if (newTagger) newTagger.elo = chaserElo.current;
          if (oldTagger) oldTagger.elo = evaderElo.current;

          if (!exhibition) playTagSound();
          const effectLife = 500;
          newState.tagEffects.push({
            position: { ...tagTransition.position },
            life: effectLife,
            initialLife: effectLife,
          });
        }

        // 6. Performance Averages
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

        // Evolution is intentionally absent from the main thread; the worker owns generations.

        // Evolutionary diagnostics remain worker-owned; the visible game is presentation only.

        // 7. Camera Tracking (shared with headless training)
        newState.cameraPosition.x = updateChaseCameraX(
          newState.agents,
          newState.platforms,
          newState.cameraPosition.x,
          viewportSize.width
        );

        // 8. Platform Generation. The visual game continues to use Math.random; training
        // supplies a seeded RNG to this same rule so all compared genomes see identical terrain.
        const platformUpdate = maintainPlatformsForCamera(
          newState.platforms,
          newState.agents,
          newState.cameraPosition.x,
          viewportSize,
          platformIdCounter.current,
          Math.random,
          activePursuitDesign?.branchStructureMinX,
          continuousTerrainRuntime(terrainVarietyConfig)
        );
        newState.platforms = platformUpdate.platforms.map(platform =>
          stampPlatformVisualBiome(platform, newState.worldSeed ?? DEFAULT_BIOME_WORLD_SEED)
        );
        platformIdCounter.current = platformUpdate.nextPlatformId;

        // 9. Tag Visual Effects
        newState.tagEffects = newState.tagEffects
          .map(effect => ({ ...effect, life: effect.life - deltaTime }))
          .filter(effect => effect.life > 0);

        // Attach only the live policy input vector needed by the optional senses overlay.
        newState.agents = newState.agents.map(agent => ({
          ...agent,
          stateVector: showSenses && !exhibition ? getAgentStateVector(agent, newState, viewportSize) : undefined,
          rewardBreakdown: undefined,
        }));

        return newState;
      });
    },
    [isSimulating, viewportSize, sprintUpgradeActive, controlledJumpUpgradeActive, upgradeConfig, terrainVarietyConfig, showSenses, exhibition]
  );

  const updateSimulation = useCallback(
    (deltaTime: number) => {
      if (isVisualPaused && !stepFrameRef.current) return;

      if (stepFrameRef.current) {
        stepFrameRef.current = false;
        updateGame(16.67);
        return;
      }

      // Fixed-step visual physics driven by real elapsed wall time. This makes 1x playback the
      // same speed on 60/120/144 Hz displays while preserving deterministic 16.67 ms physics steps.
      const safeDeltaMs = Math.min(100, Math.max(0, deltaTime));
      visualStepAccumulatorRef.current += safeDeltaMs * Math.max(0.25, Math.min(10, visualSpeed));
      const wholeSteps = Math.min(60, Math.floor(visualStepAccumulatorRef.current / 16.67));
      visualStepAccumulatorRef.current -= wholeSteps * 16.67;
      for (let i = 0; i < wholeSteps; i++) updateGame(16.67);
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
      if (exhibition) return;
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
  }, [exhibition]);


  const handleResetChampionGame = useCallback(() => {
    chaserAgent.current?.resetState();
    evaderAgent.current?.resetState();
    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    visualTagsRef.current = 0;
    visualFallsRef.current = 0;
    actionCountsRef.current = { all: {}, chaser: {}, evader: {} };
    visualStepAccumulatorRef.current = 0;
    platformIdCounter.current = 10;

    const groundY = viewportSize.height - 100;
    const starts = [100, 400, 700];
    setGameState(prev => {
      if (!prev) return prev;
      const agents = prev.agents.map((agent, index) => {
        const isChaser = index === 0;
        const x = starts[index] ?? starts[starts.length - 1];
        return {
          ...agent,
          position: { x, y: 500 },
          velocity: { x: 0, y: 0 },
          acceleration: { x: 0, y: 0 },
          status: isChaser ? AgentStatus.It : AgentStatus.Normal,
          role: isChaser ? 'chaser' as const : 'evader' as const,
          elo: isChaser ? chaserElo.current : evaderElo.current,
          isOnGround: false,
          cooldownTimer: 0,
          lastAction: 'idle',
          energy: MAX_ENERGY,
          maxEnergy: MAX_ENERGY,
          trajectory: [{ x, y: 500, timestamp: 0 }],
          lastPlatformId: 0,
          activeRoutePath: null,
          scale: { x: 1, y: 1 },
          energyAtLastTakeoff: MAX_ENERGY,
          positionAtLastTakeoff: { x, y: 500 },
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
        platforms: [stampPlatformVisualBiome({ id: 0, position: { x: 0, y: groundY }, width: viewportSize.width, height: PLATFORM_HEIGHT }, prev.worldSeed ?? DEFAULT_BIOME_WORLD_SEED)],
        cameraPosition: { x: 0, y: 0 },
        gameTime: 0,
        tagEffects: [],
        avgSurvivalTime: 0,
        avgTimeToTag: 0,
      };
    });
  }, [viewportSize]);

  const handleApplyNetworkArchitecture = useCallback((next: NetworkArchitectureSuiteConfig) => {
    const sanitized = sanitizeNetworkArchitectureSuite(next);
    setNetworkArchitecture(sanitized);
    localStorage.setItem(NETWORK_ARCHITECTURE_STORAGE_KEY, JSON.stringify(sanitized));
    installedChampionGenerationRef.current = { chaser: -1, evader: -1 };
    installedChampionGenomeIdRef.current = { chaser: null, evader: null };
    chaserElo.current = INITIAL_ELO;
    evaderElo.current = INITIAL_ELO;
    recentSurvivalTimes.current = [];
    recentTimesToTag.current = [];
    actionCountsRef.current = { all: {}, chaser: {}, evader: {} };
    totalTagsRef.current = 0;
    totalFallsRef.current = 0;
    totalJumpsRef.current = 0;
    workerRef.current?.postMessage({ type: 'SET_NETWORK_ARCHITECTURE', payload: { networkArchitecture: sanitized } });
    setDiagnosticsState(prev => ({
      ...prev,
      chaserNeatHistory: [], evaderNeatHistory: [], lastChaserNeatMetrics: null, lastEvaderNeatMetrics: null,
      chaserChampionGenome: null, evaderChampionGenome: null, performanceHistory: [], totalTags: 0, totalFalls: 0,
      totalChaserFalls: 0, totalChaserEscapes: 0, totalRunnerFalls: 0,
      totalSuccessfulJumps: 0, actionDistribution: {}, chaserActionDistribution: {}, evaderActionDistribution: {}, generation: 0,
      chaserElo: INITIAL_ELO, evaderElo: INITIAL_ELO,
      eloLeaderboard: createLeaderboardEntries(INITIAL_ELO, INITIAL_ELO, 0, 0, 0, 0, 0, 0, 0),
      hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: 12, opponentsPerGenome: 1, chaserGenerations: [], evaderGenerations: [], chaserRecentSize: 0, evaderRecentSize: 0, chaserDiverseSize: 0, evaderDiverseSize: 0, chaserDiversity: 0, evaderDiversity: 0 },
      lastCrossGenerationBenchmark: null, benchmarkHistory: [], benchmarkSuiteRevision: 0,
      chaserGeneralistChampion: null, evaderGeneralistChampion: null,
      lastGenerationBalance: null, balanceHistory: [], trainingSpeedX: 0, trainingEpisodesPerSecond: 0,
      networkArchitecture: sanitized,
    }));
  }, []);

  const handleResetWeights = () => {
    installedChampionGenerationRef.current = { chaser: -1, evader: -1 };
    installedChampionGenomeIdRef.current = { chaser: null, evader: null };
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
      totalChaserFalls: 0,
      totalChaserEscapes: 0,
      totalRunnerFalls: 0,
      totalSuccessfulJumps: 0,
      actionDistribution: {},
      chaserActionDistribution: {},
      evaderActionDistribution: {},
      generation: 0,
      chaserElo: INITIAL_ELO,
      evaderElo: INITIAL_ELO,
      eloLeaderboard: createLeaderboardEntries(INITIAL_ELO, INITIAL_ELO, 0, 0, 0, 0, 0, 0, 0),
      hallOfFame: { chaserSize: 0, evaderSize: 0, maxSize: 12, opponentsPerGenome: 1, chaserGenerations: [], evaderGenerations: [], chaserRecentSize: 0, evaderRecentSize: 0, chaserDiverseSize: 0, evaderDiverseSize: 0, chaserDiversity: 0, evaderDiversity: 0 },
      lastCrossGenerationBenchmark: null,
      benchmarkHistory: [],
      benchmarkSuiteRevision: 0,
      chaserGeneralistChampion: null,
      evaderGeneralistChampion: null,
      lastGenerationBalance: null,
      balanceHistory: [],
      trainingSpeedX: 0,
      trainingEpisodesPerSecond: 0,
      trainingBackend: 'CPU optimized',
      trainingWorkerCount: 1,
          sprintUpgradeActive: upgradeConfig.sprint.mode === 'on',
      controlledJumpUpgradeActive: upgradeConfig.controlledJump.mode === 'on',
      trainingFitnessConfig: { ...trainingFitnessConfig },
      networkArchitecture: sanitizeNetworkArchitectureSuite(networkArchitecture),
        }));
  };

  const requestFullCheckpoint = (action: 'library' | 'export', name?: string) => {
    if (!workerRef.current) {
      setCheckpointLibraryMessage('Training worker is not available yet.');
      setCheckpointLibraryBusy(false);
      return;
    }
    const requestId = checkpointRequestCounterRef.current++;
    pendingCheckpointActionRef.current = { requestId, action, name };
    workerRef.current.postMessage({ type: 'CHECKPOINT_REQUEST', payload: { requestId } });
  };

  const restoreModelPayload = (payload: any): boolean => {
    try {
      if (payload?.kind === 'full-evolution-checkpoint' && payload?.evolutionCheckpoint) {
        const checkpoint = payload.evolutionCheckpoint;
        // Validate both champion phenotypes on temporary agents before touching either live model.
        const nextChaser = new LearningAgent('chaser');
        const nextEvader = new LearningAgent('evader');
        nextChaser.setWeights(checkpoint.championChaser);
        nextEvader.setWeights(checkpoint.championEvader);

        chaserAgent.current?.setWeights(checkpoint.championChaser);
        evaderAgent.current?.setWeights(checkpoint.championEvader);
        const chaserGeneration = checkpoint.generalistChampions?.chaser?.generation ?? checkpoint.championChaser?.generation ?? checkpoint.lastChaserMetrics?.generation ?? 0;
        const evaderGeneration = checkpoint.generalistChampions?.evader?.generation ?? checkpoint.championEvader?.generation ?? checkpoint.lastEvaderMetrics?.generation ?? 0;
        installedChampionGenerationRef.current = { chaser: chaserGeneration, evader: evaderGeneration };
        installedChampionGenomeIdRef.current = { chaser: checkpoint.championChaser?.id ?? null, evader: checkpoint.championEvader?.id ?? null };
        chaserAgent.current?.setGeneration(chaserGeneration);
        evaderAgent.current?.setGeneration(evaderGeneration);
        if (typeof checkpoint.chaserElo === 'number') chaserElo.current = checkpoint.chaserElo;
        if (typeof checkpoint.evaderElo === 'number') evaderElo.current = checkpoint.evaderElo;
        if (checkpoint.upgradeConfig) setUpgradeConfig(checkpoint.upgradeConfig);
        if (checkpoint.trainingFitnessConfig) {
          setTrainingFitnessConfig(sanitizeTrainingFitnessConfig(checkpoint.trainingFitnessConfig));
        }
        if (checkpoint.terrainVarietyConfig) {
          setTerrainVarietyConfig(sanitizeTerrainVarietyConfig(checkpoint.terrainVarietyConfig));
        }

        pendingRestoreDiagnosticsRef.current = payload.uiDiagnostics || null;
        const requestId = checkpointRequestCounterRef.current++;
        workerRef.current?.postMessage({
          type: 'RESTORE_CHECKPOINT',
          payload: { requestId, checkpoint },
        });
        return true;
      }

      // Legacy v3 champion-only files remain importable. They seed fresh populations rather than
      // pretending to restore species/Hall-of-Fame/innovation history that the file never stored.
      let nextChaserWeights = chaserAgent.current?.getWeights();
      let nextEvaderWeights = evaderAgent.current?.getWeights();
      if (payload.chaser) {
        const candidate = new LearningAgent('chaser');
        if (!candidate.importJson(JSON.stringify(payload.chaser))) return false;
        nextChaserWeights = candidate.getWeights();
      }
      if (payload.evader) {
        const candidate = new LearningAgent('evader');
        if (!candidate.importJson(JSON.stringify(payload.evader))) return false;
        nextEvaderWeights = candidate.getWeights();
      }
      if (nextChaserWeights && chaserAgent.current) chaserAgent.current.setWeights(nextChaserWeights);
      if (nextEvaderWeights && evaderAgent.current) evaderAgent.current.setWeights(nextEvaderWeights);
      if (typeof payload.chaserElo === 'number') chaserElo.current = payload.chaserElo;
      if (typeof payload.evaderElo === 'number') evaderElo.current = payload.evaderElo;
      workerRef.current?.postMessage({
        type: 'SET_WEIGHTS',
        payload: {
          chaserWeights: chaserAgent.current?.getWeights(),
          evaderWeights: evaderAgent.current?.getWeights(),
          chaserElo: chaserElo.current,
          evaderElo: evaderElo.current,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to restore NEAT save:', error);
      return false;
    }
  };

  const handleSaveCheckpoint = (name: string) => {
    setCheckpointLibraryBusy(true);
    setCheckpointLibraryMessage('Capturing the next safe completed-generation checkpoint…');
    requestFullCheckpoint('library', name);
  };

  const handleLoadStoredCheckpoint = async (id: string): Promise<boolean> => {
    setCheckpointLibraryBusy(true);
    setCheckpointLibraryMessage('Reading checkpoint from the local library…');
    try {
      const serialized = await readStoredCheckpoint(id);
      if (!serialized) throw new Error('Saved checkpoint was not found.');
      const ok = restoreModelPayload(JSON.parse(serialized));
      if (!ok) throw new Error('Checkpoint is incompatible with this build.');
      setCheckpointLibraryMessage('Restoring evolutionary state…');
      return true;
    } catch (error) {
      console.error('Failed to load stored checkpoint:', error);
      setCheckpointLibraryMessage(`Load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      setCheckpointLibraryBusy(false);
      return false;
    }
  };

  const handleDeleteStoredCheckpoint = async (id: string): Promise<void> => {
    setCheckpointLibraryBusy(true);
    try {
      await deleteStoredCheckpoint(id);
      await refreshStoredCheckpointLibrary();
      setCheckpointLibraryMessage('Saved checkpoint deleted.');
    } catch (error) {
      console.error('Failed to delete checkpoint:', error);
      setCheckpointLibraryMessage(`Delete failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setCheckpointLibraryBusy(false);
    }
  };

  const handleExportStoredCheckpoint = async (id: string): Promise<void> => {
    setCheckpointLibraryBusy(true);
    try {
      const serialized = await readStoredCheckpoint(id);
      if (!serialized) throw new Error('Saved checkpoint was not found.');
      const payload = JSON.parse(serialized);
      const generation = payload?.evolutionCheckpoint?.generation || payload?.generation || 0;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `neat_tag_checkpoint_gen${generation}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setCheckpointLibraryMessage(`Exported saved generation ${generation} checkpoint.`);
    } catch (error) {
      console.error('Failed to export stored checkpoint:', error);
      setCheckpointLibraryMessage(`Export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setCheckpointLibraryBusy(false);
    }
  };

  const handleExportModels = () => {
    setCheckpointLibraryBusy(true);
    setCheckpointLibraryMessage('Capturing the next safe completed-generation checkpoint for export…');
    requestFullCheckpoint('export');
  };
  const handleExportAnalysis = () => {
    if (!workerRef.current) return;
    const requestId = analysisRequestCounterRef.current++;
    workerRef.current.postMessage({ type: 'ANALYSIS_EXPORT_REQUEST', payload: { requestId } });
  };

  const handleImportModels = async (jsonString: string, fileName?: string): Promise<boolean> => {
    setCheckpointLibraryBusy(true);
    setCheckpointLibraryMessage('Validating imported model file…');
    try {
      const payload = JSON.parse(jsonString);
      const validation = validateFullCheckpointJson(jsonString);
      if (validation.valid) {
        const baseName = (fileName || `Imported generation ${validation.generation || 0}`).replace(/\.json$/i, '');
        await saveStoredCheckpoint(JSON.stringify(payload), baseName);
        await refreshStoredCheckpointLibrary();
        const ok = restoreModelPayload(payload);
        if (!ok) throw new Error('Imported checkpoint is incompatible with this build.');
        setCheckpointLibraryMessage(`Imported “${baseName}” into the library and started restoring it…`);
        return true;
      }

      // Champion-only legacy JSON is still supported, but it cannot represent a restorable full run.
      const ok = restoreModelPayload(payload);
      if (!ok) throw new Error(validation.message || 'Unsupported model file.');
      setCheckpointLibraryMessage('Imported legacy champion weights. A fresh evolutionary population was seeded.');
      setCheckpointLibraryBusy(false);
      return true;
    } catch (error) {
      console.error('Failed to import models/checkpoint:', error);
      setCheckpointLibraryMessage(`Import failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      setCheckpointLibraryBusy(false);
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
      className={`flex flex-col overflow-hidden bg-gray-950 font-sans ${exhibition ? "" : "p-4 gap-3"}`}
      onPointerMove={exhibition ? revealControls : undefined}
      style={exhibition ? { width: '100vw', height: '100vh', cursor: controlsVisible ? 'default' : 'none' } : scaledViewportStyle}
    >
      <header style={exhibition ? { display: "none" } : undefined} className="flex flex-wrap items-center gap-3 bg-gray-900/80 backdrop-blur border border-gray-800 px-5 py-3 rounded-xl shadow-lg">
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Champion-view controls */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-1" title="Champion game speed">
              <MonitorPlay className="w-3.5 h-3.5 text-cyan-300 ml-1" />
              <span className="text-[10px] uppercase tracking-wider text-cyan-300 mr-1">View</span>
              {[0.5, 1, 2, 5, 10].map(speed => (
                <button key={speed} aria-pressed={visualSpeed === speed} onClick={() => setVisualSpeed(speed)} className={`px-2 py-1 text-[11px] font-mono font-semibold rounded ${visualSpeed === speed ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-900'}`}>{speed}x</button>
              ))}
            </div>
            <div className="flex items-center bg-gray-950 border border-gray-800 rounded-lg p-1" title="Preferred visual zoom. Auto-framing keeps the active chase readable up to the escape boundary without changing physics or agent senses.">
              <button
                onClick={() => changeCameraZoom(-0.25)}
                disabled={cameraZoom <= 0.5}
                className="p-1.5 rounded text-cyan-200 hover:bg-gray-900 disabled:text-gray-700 disabled:hover:bg-transparent"
                title="Lower preferred camera zoom (auto-framing may zoom out farther when agents separate)"
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
                title="Raise preferred camera zoom (auto-framing still protects the active chase frame)"
                aria-label="Zoom camera in"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <button onClick={() => setIsVisualPaused(p => !p)} className="p-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800" aria-label={isVisualPaused ? 'Resume champion game' : 'Pause champion game'} title={isVisualPaused ? 'Resume champion game' : 'Pause champion game'}>
              {isVisualPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button onClick={handleResetChampionGame} className="px-2.5 py-2 rounded-lg border border-gray-700 text-cyan-200 hover:bg-gray-800 flex items-center gap-1.5 text-[11px] font-semibold" title="Reset champion game only">
              <RotateCcw className="w-3.5 h-3.5" />Reset arena
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
              <span className="text-[9px] font-mono text-gray-600" title={diagnosticsState.trainingBackend || 'CPU training'}>
                {diagnosticsState.trainingWorkerCount || 1} worker{(diagnosticsState.trainingWorkerCount || 1) === 1 ? '' : 's'}
              </span>
              <span
                className={`text-[9px] font-mono ${trainingWakeLockActive ? 'text-emerald-400' : 'text-gray-600'}`}
                title={trainingWakeLockActive ? 'Screen wake lock active while training' : 'Screen wake lock unavailable or inactive'}
              >
                {trainingWakeLockActive ? 'wake locked' : isTrainingPaused ? 'wake off' : 'wake n/a'}
              </span>
              {(diagnosticsState.trainingRecoveryCount || 0) > 0 && (
                <span className="text-[9px] font-mono text-orange-300" title={diagnosticsState.trainingLastRecoveryReason || 'Recovered stalled evaluator'}>
                  ↻{diagnosticsState.trainingRecoveryCount}
                </span>
              )}
            </div>
            <button onClick={() => setIsTrainingPaused(p => !p)} className="p-2 rounded-lg border border-gray-700 text-amber-200 hover:bg-gray-800" aria-label={isTrainingPaused ? 'Resume background training' : 'Pause background training'} title={isTrainingPaused ? 'Resume background training' : 'Pause background training'}>
              {isTrainingPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
          </div>

          <button onClick={() => setExhibition(true)} className="px-3 py-2 rounded-lg border border-gray-700 text-cyan-200" title="Exhibition mode (G). F toggles fullscreen; Escape returns to the studio.">Exhibit</button>
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
          className={`flex-grow bg-[#1a202c] overflow-hidden relative ${exhibition ? "" : "rounded-xl border border-gray-800 shadow-2xl"}`}
        >
          {!isSimulating && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4">
              <div className="text-center max-w-md p-6 bg-gray-900 border border-cyan-500/30 rounded-2xl shadow-2xl">
                <h2 className="text-2xl font-bold text-cyan-400 mb-2">Autonomous Agent Arena</h2>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  Three autonomous agents evolve chasing, dodging, jumping, and spatial awareness using
                  dual NEAT populations, speciation, structural mutation, a compact 23-input world-relative state, and headless generation evaluation.
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
          {isSimulating && !exhibition && (
            <div className="absolute top-3 left-3 z-[5] pointer-events-none rounded-lg border border-cyan-500/25 bg-black/65 backdrop-blur px-3 py-2 text-[11px] text-gray-400 shadow-lg">
              <div className="font-semibold text-cyan-200">Champion arena · continuous game</div>
              <div className="font-mono mt-0.5">Chaser G{installedChampionGenerationRef.current.chaser} · Runner G{installedChampionGenerationRef.current.evader}</div>
            </div>
          )}
          {isSimulating && (
            <GameCanvas
              gameState={gameState}
              showTrails={showTrails}
              showSenses={showSenses && !exhibition}
              cameraZoom={cameraZoom}
              dayNightConfig={dayNightConfig}
            />
          )}
        </main>
        {!exhibition && <InfoPanel
          agents={gameState.agents}
            showTrails={showTrails}
          onToggleTrails={handleToggleTrails}
          showSenses={showSenses && !exhibition}
          onToggleSenses={handleToggleSenses}
          dayNightConfig={dayNightConfig}
          onUpdateDayNightConfig={updateDayNightConfig}
          onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
          upgradeConfig={upgradeConfig}
          sprintUpgradeActive={sprintUpgradeActive}
          controlledJumpUpgradeActive={controlledJumpUpgradeActive}
          onUpdateUpgrade={updateUpgradeRule}
          trainingFitnessConfig={trainingFitnessConfig}
          onUpdateTrainingFitnessConfig={updateTrainingFitnessConfig}
          terrainVarietyConfig={terrainVarietyConfig}
          onUpdateTerrainVarietyConfig={updateTerrainVarietyConfig}
        />}
      </div>

      {exhibition && <button onClick={() => setExhibition(false)} onFocus={revealControls} aria-label="Return to studio" style={{ opacity: controlsVisible ? 1 : 0 }} className="fixed top-4 right-4 z-50 px-3 py-2 rounded-lg bg-black/70 text-gray-300 text-xs focus:!opacity-100">Return to studio · G / Esc</button>}
      {/* Full Screen Interactive Performance Diagnostics Suite */}
      <PerformanceDiagnostics
        isOpen={isDiagnosticsOpen && !exhibition}
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
        storedCheckpoints={storedCheckpoints}
        checkpointLibraryBusy={checkpointLibraryBusy}
        checkpointLibraryMessage={checkpointLibraryMessage}
        onSaveCheckpoint={handleSaveCheckpoint}
        onLoadStoredCheckpoint={handleLoadStoredCheckpoint}
        onDeleteStoredCheckpoint={handleDeleteStoredCheckpoint}
        onExportStoredCheckpoint={handleExportStoredCheckpoint}
        onExportModels={handleExportModels}
        onExportAnalysis={handleExportAnalysis}
        onImportModels={handleImportModels}
        networkArchitecture={networkArchitecture}
        onApplyNetworkArchitecture={handleApplyNetworkArchitecture}
      />
    </div>
  );
};

export default App;
