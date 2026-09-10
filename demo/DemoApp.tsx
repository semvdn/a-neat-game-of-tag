import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameCanvas } from '../components/GameCanvas';
import { useGameLoop } from '../hooks/useGameLoop';
import { LearningAgent } from '../learning/agent';
import { resolveRunnerContacts } from '../learning/bodyContacts';
import { getAgentStateVector } from '../learning/state';
import {
  advanceRoleTimers,
  evaluateChaseEscape,
  getVisualChaserEscapeRecovery,
  maintainPlatformsForCamera,
  resolveTagSwap,
  stepAgentPhysics,
  stepMovingPlatformsInPlace,
  updateChaseCameraX,
} from '../learning/simulationCore';
import { continuousTerrainRuntime, DEFAULT_TERRAIN_VARIETY_CONFIG, sanitizeTerrainVarietyConfig } from '../learning/terrainConfig';
import {
  getMaxVisualAgentSeparation,
  getVisualGroupSeparationRecovery,
  VISUAL_SEPARATION_FAILSAFE_DISTANCE_PX,
  VISUAL_SEPARATION_FAILSAFE_DURATION_MS,
} from '../learning/visualFailsafe';
import {
  AGENT_COLORS,
  MAX_ENERGY,
  NEW_CHASER_TAG_DELAY_MS,
  PLATFORM_HEIGHT,
  SPRINT_ENERGY_COST_PER_SEC,
  SPRINT_MAX_SPEED,
} from '../constants';
import type {
  ActiveUpgradeState,
  AgentState,
  GameState,
  PursuitDesignConfig,
  TerrainVarietyConfig,
  UpgradeConfig,
} from '../types';
import { AgentStatus } from '../types';
import { DEFAULT_BIOME_WORLD_SEED, stampPlatformVisualBiome } from '../world/biomes';
import { createDefaultDayNightConfig, type DayNightConfig } from '../world/dayNight';
import type { NeatGenomeData } from '../learning/neat';

const VIEWPORT = { width: 1200, height: 800 } as const;
const SHOWCASE_URL = './showcase/showcase_pair_gen7422.json';
const TRAIL_LIFETIME_MS = 3200;
const MAX_TRAIL_POINTS = 128;
const TRAIL_SAMPLE_DISTANCE = 4;

interface ShowcasePairAsset {
  format: 'neat-tag-showcase-pair';
  version: number;
  sourceCheckpointGeneration: number;
  selectedAtGeneration: number;
  worldSeed?: number;
  chaser: { id: string; generation: number; genome: NeatGenomeData };
  runner: { id: string; generation: number; genome: NeatGenomeData };
  activeUpgrades?: { sprint?: boolean; controlledJump?: boolean };
  upgradeConfig?: UpgradeConfig;
  terrainVarietyConfig?: TerrainVarietyConfig;
  pursuitDesign?: PursuitDesignConfig | null;
  showcaseMetrics?: {
    tagsPerEpisode?: number;
    runnerPaceCompletion?: number;
    branchLandingsPerEpisode?: number;
  } | null;
}

const DEFAULT_UPGRADES: UpgradeConfig = {
  sprint: {
    mode: 'off',
    chaserEnabled: true,
    runnerEnabled: true,
    chaserAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
    runnerAdvanced: { maxSpeedOverride: false, maxSpeed: SPRINT_MAX_SPEED, staminaCostOverride: false, staminaCostPerSec: SPRINT_ENERGY_COST_PER_SEC },
  },
  controlledJump: { mode: 'off', chaserEnabled: true, runnerEnabled: true },
};

const updateTrail = (
  trajectory: AgentState['trajectory'] | undefined,
  position: AgentState['position'],
  nowMs: number,
): AgentState['trajectory'] => {
  const cutoff = nowMs - TRAIL_LIFETIME_MS;
  const liveTrail = (trajectory || []).filter(point => point.timestamp >= cutoff);
  const last = liveTrail[liveTrail.length - 1];
  if (last && Math.hypot(position.x - last.x, position.y - last.y) < TRAIL_SAMPLE_DISTANCE) return liveTrail;
  return [...liveTrail.slice(-(MAX_TRAIL_POINTS - 1)), { x: position.x, y: position.y, timestamp: nowMs }];
};

const createInitialState = (worldSeed = DEFAULT_BIOME_WORLD_SEED): GameState => {
  const groundY = VIEWPORT.height - 100;
  const starts = [100, 400, 700];
  const agents: AgentState[] = starts.map((x, index) => ({
    id: index + 1,
    position: { x, y: 500 },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    status: index === 0 ? AgentStatus.It : AgentStatus.Normal,
    role: index === 0 ? 'chaser' : 'evader',
    color: AGENT_COLORS[index],
    isOnGround: false,
    cooldownTimer: 0,
    lastAction: 'idle',
    energy: MAX_ENERGY,
    maxEnergy: MAX_ENERGY,
    trajectory: [{ x, y: 500, timestamp: 0 }],
    lastPlatformId: 0,
    scale: { x: 1, y: 1 },
    energyAtLastTakeoff: MAX_ENERGY,
    positionAtLastTakeoff: { x, y: 500 },
    survivalTime: 0,
    timeSinceBecameIt: 0,
    modelId: index === 0 ? 'showcase_chaser' : 'showcase_runner',
  }));

  return {
    agents,
    worldSeed,
    platforms: [stampPlatformVisualBiome({ id: 0, position: { x: 0, y: groundY }, width: VIEWPORT.width, height: PLATFORM_HEIGHT }, worldSeed)],
    cameraPosition: { x: 0, y: 0 },
    gameTime: 0,
    tagEffects: [],
    avgSurvivalTime: 0,
    avgTimeToTag: 0,
  };
};

const DemoApp: React.FC = () => {
  const [asset, setAsset] = useState<ShowcasePairAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>(() => createInitialState());
  const [paused, setPaused] = useState(false);
  const [visualSpeed, setVisualSpeed] = useState(1);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [showTrails, setShowTrails] = useState(true);
  const [showSenses, setShowSenses] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [introVisible, setIntroVisible] = useState(true);
  const sourceUrl = (import.meta as any).env?.VITE_REPOSITORY_URL as string | undefined;
  const [dayNightConfig, setDayNightConfig] = useState<DayNightConfig>(() => ({
    ...createDefaultDayNightConfig(),
    mode: 'cycle',
    cycleMinutes: 10,
    cycleAnchorHour: 8,
  }));

  const chaserAgent = useRef<LearningAgent | null>(null);
  const runnerAgent = useRef<LearningAgent | null>(null);
  const platformIdCounter = useRef(10);
  const visualStepAccumulator = useRef(0);
  const separationFailsafeMs = useRef(0);
  const controlsHideTimer = useRef<number | null>(null);

  const terrainConfig = useMemo(
    () => sanitizeTerrainVarietyConfig(asset?.terrainVarietyConfig ?? DEFAULT_TERRAIN_VARIETY_CONFIG),
    [asset],
  );
  const upgradeConfig = asset?.upgradeConfig ?? DEFAULT_UPGRADES;
  const pursuitDesign = asset?.pursuitDesign ?? undefined;
  const sprintActive = Boolean(asset?.activeUpgrades?.sprint);
  const controlledJumpActive = Boolean(asset?.activeUpgrades?.controlledJump);

  useEffect(() => {
    let cancelled = false;
    fetch(SHOWCASE_URL)
      .then(response => {
        if (!response.ok) throw new Error(`Showcase asset failed to load (${response.status}).`);
        return response.json();
      })
      .then((next: ShowcasePairAsset) => {
        if (cancelled) return;
        if (next?.format !== 'neat-tag-showcase-pair' || !next.chaser?.genome || !next.runner?.genome) {
          throw new Error('Showcase asset is incompatible with this build.');
        }
        const chaser = new LearningAgent('chaser');
        const runner = new LearningAgent('evader');
        chaser.setWeights(next.chaser.genome);
        runner.setWeights(next.runner.genome);
        chaser.setGeneration(next.chaser.generation);
        runner.setGeneration(next.runner.generation);
        chaserAgent.current = chaser;
        runnerAgent.current = runner;
        setAsset(next);
        setGameState(createInitialState(next.worldSeed ?? DEFAULT_BIOME_WORLD_SEED));
      })
      .catch(error => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load the showcase.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setIntroVisible(false), 4200);
    return () => window.clearTimeout(id);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) window.clearTimeout(controlsHideTimer.current);
    controlsHideTimer.current = window.setTimeout(() => setControlsVisible(false), 4200);
  }, []);

  useEffect(() => {
    revealControls();
    return () => {
      if (controlsHideTimer.current !== null) window.clearTimeout(controlsHideTimer.current);
    };
  }, [revealControls]);

  const resetArena = useCallback(() => {
    chaserAgent.current?.resetState();
    runnerAgent.current?.resetState();
    platformIdCounter.current = 10;
    visualStepAccumulator.current = 0;
    separationFailsafeMs.current = 0;
    setGameState(createInitialState(asset?.worldSeed ?? DEFAULT_BIOME_WORLD_SEED));
  }, [asset?.worldSeed]);

  const updateGame = useCallback((deltaTime: number) => {
    if (!asset || !chaserAgent.current || !runnerAgent.current) return;

    setGameState(previous => {
      let next: GameState = {
        ...previous,
        agents: previous.agents.map(agent => ({ ...agent, trajectory: agent.trajectory || [] })),
        platforms: previous.platforms.map(platform => ({
          ...platform,
          position: { ...platform.position },
          motion: platform.motion ? { ...platform.motion } : undefined,
        })),
        gameTime: previous.gameTime + deltaTime,
        tagEffects: [...previous.tagEffects],
      };

      advanceRoleTimers(next.agents, deltaTime);
      if (terrainConfig.continuousMovingPlatformsEnabled) {
        stepMovingPlatformsInPlace(next.platforms, next.agents, deltaTime, terrainConfig.movingPlatformsInBranches);
      }

      const actions: Record<number, { action: string; moveLeft: number; moveRight: number; jump: number; sprint: number }> = {};
      for (const agent of next.agents) {
        const isChaser = agent.status === AgentStatus.It;
        const role: 'chaser' | 'evader' = isChaser ? 'chaser' : 'evader';
        const previousRole = agent.role;
        agent.role = role;
        agent.modelId = isChaser ? `showcase_chaser_g${asset.chaser.generation}` : `showcase_runner_g${asset.runner.generation}`;
        const model = isChaser ? chaserAgent.current : runnerAgent.current;
        if (previousRole && previousRole !== role) model.resetState(agent.id);
        const decision = model.chooseAction(getAgentStateVector(agent, next, VIEWPORT), agent.id);
        actions[agent.id] = {
          action: decision.action,
          moveLeft: decision.moveLeft,
          moveRight: decision.moveRight,
          jump: decision.jump,
          sprint: decision.sprint,
        };
      }

      const activeUpgrades: ActiveUpgradeState = {
        sprint: sprintActive,
        controlledJump: controlledJumpActive,
        sprintChaser: sprintActive && upgradeConfig.sprint.chaserEnabled,
        sprintRunner: sprintActive && upgradeConfig.sprint.runnerEnabled,
        controlledJumpChaser: controlledJumpActive && upgradeConfig.controlledJump.chaserEnabled,
        controlledJumpRunner: controlledJumpActive && upgradeConfig.controlledJump.runnerEnabled,
        sprintChaserMaxSpeed: pursuitDesign?.chaserSprintMaxSpeed ?? (upgradeConfig.sprint.chaserAdvanced.maxSpeedOverride ? upgradeConfig.sprint.chaserAdvanced.maxSpeed : SPRINT_MAX_SPEED),
        sprintRunnerMaxSpeed: pursuitDesign?.runnerSprintMaxSpeed ?? (upgradeConfig.sprint.runnerAdvanced.maxSpeedOverride ? upgradeConfig.sprint.runnerAdvanced.maxSpeed : SPRINT_MAX_SPEED),
        sprintChaserStaminaCostPerSec: pursuitDesign?.chaserSprintStaminaCostPerSec ?? (upgradeConfig.sprint.chaserAdvanced.staminaCostOverride ? upgradeConfig.sprint.chaserAdvanced.staminaCostPerSec : SPRINT_ENERGY_COST_PER_SEC),
        sprintRunnerStaminaCostPerSec: pursuitDesign?.runnerSprintStaminaCostPerSec ?? (upgradeConfig.sprint.runnerAdvanced.staminaCostOverride ? upgradeConfig.sprint.runnerAdvanced.staminaCostPerSec : SPRINT_ENERGY_COST_PER_SEC),
        chaserBaseMaxSpeed: pursuitDesign?.chaserBaseMaxSpeed,
        runnerBaseMaxSpeed: pursuitDesign?.runnerBaseMaxSpeed,
        postFallRunnerTagProtectionMs: pursuitDesign?.postFallRunnerTagProtectionMs,
      };

      const agentsBeforePhysics = next.agents;
      const fallenIds = new Set<number>();
      next.agents = agentsBeforePhysics.map(agent => {
        const decision = actions[agent.id];
        const result = stepAgentPhysics(
          agent,
          agentsBeforePhysics,
          next.platforms,
          next.cameraPosition.x,
          VIEWPORT,
          deltaTime,
          decision ?? { action: agent.lastAction, moveLeft: 0, moveRight: 0, jump: 0, sprint: 0 },
          activeUpgrades,
        );
        if (result.fell) fallenIds.add(agent.id);
        return result.agent;
      });

      resolveRunnerContacts(next.agents, agentsBeforePhysics, next.platforms);
      next.agents = next.agents.map(agent => ({
        ...agent,
        trajectory: fallenIds.has(agent.id)
          ? [{ ...agent.position, timestamp: next.gameTime }]
          : updateTrail(agent.trajectory, agent.position, next.gameTime),
      }));

      if (evaluateChaseEscape(next.agents).escaped) {
        const recovery = getVisualChaserEscapeRecovery(next.agents, next.platforms);
        if (recovery) {
          chaserAgent.current?.resetState();
          next.agents = next.agents.map(agent => agent.id !== recovery.chaserId ? agent : ({
            ...agent,
            position: { ...recovery.position },
            velocity: { x: 0, y: 0 },
            acceleration: { x: 0, y: 0 },
            isOnGround: true,
            cooldownTimer: Math.max(agent.cooldownTimer || 0, NEW_CHASER_TAG_DELAY_MS),
            lastAction: 'idle',
            trajectory: [{ ...recovery.position, timestamp: next.gameTime }],
            lastPlatformId: recovery.platformId,
            activeRoutePath: recovery.activeRoutePath,
            positionAtLastTakeoff: { ...recovery.position },
            energyAtLastTakeoff: agent.energy,
            timeSinceBecameIt: 0,
            jumpArmed: true,
          }));
        }
      }

      const widestPair = getMaxVisualAgentSeparation(next.agents);
      separationFailsafeMs.current = widestPair && widestPair.distance > VISUAL_SEPARATION_FAILSAFE_DISTANCE_PX
        ? separationFailsafeMs.current + deltaTime
        : 0;
      if (separationFailsafeMs.current >= VISUAL_SEPARATION_FAILSAFE_DURATION_MS) {
        const recovery = getVisualGroupSeparationRecovery(next.agents, next.platforms);
        separationFailsafeMs.current = recovery ? 0 : VISUAL_SEPARATION_FAILSAFE_DURATION_MS;
        if (recovery) {
          chaserAgent.current?.resetState();
          runnerAgent.current?.resetState();
          const placements = new Map(recovery.placements.map(item => [item.agentId, item]));
          next.agents = next.agents.map(agent => {
            const placement = placements.get(agent.id);
            if (!placement) return agent;
            return {
              ...agent,
              position: { ...placement.position },
              velocity: { x: 0, y: 0 },
              acceleration: { x: 0, y: 0 },
              isOnGround: true,
              supportingAgentId: null,
              cooldownTimer: Math.max(agent.cooldownTimer || 0, NEW_CHASER_TAG_DELAY_MS),
              lastAction: 'idle',
              trajectory: [{ ...placement.position, timestamp: next.gameTime }],
              lastPlatformId: placement.platformId,
              activeRoutePath: placement.activeRoutePath,
              positionAtLastTakeoff: { ...placement.position },
              energyAtLastTakeoff: agent.energy,
              jumpArmed: true,
            };
          });
          next.cameraPosition.x = recovery.platformCenterX - VIEWPORT.width * 0.5;
        }
      }

      const tag = resolveTagSwap(next.agents);
      if (tag) {
        const effectLife = 500;
        next.tagEffects.push({ position: { ...tag.position }, life: effectLife, initialLife: effectLife });
      }

      next.cameraPosition.x = updateChaseCameraX(next.agents, next.platforms, next.cameraPosition.x, VIEWPORT.width);
      const platformUpdate = maintainPlatformsForCamera(
        next.platforms,
        next.agents,
        next.cameraPosition.x,
        VIEWPORT,
        platformIdCounter.current,
        Math.random,
        pursuitDesign?.branchStructureMinX,
        continuousTerrainRuntime(terrainConfig),
      );
      next.platforms = platformUpdate.platforms.map(platform => stampPlatformVisualBiome(platform, next.worldSeed ?? DEFAULT_BIOME_WORLD_SEED));
      platformIdCounter.current = platformUpdate.nextPlatformId;

      next.tagEffects = next.tagEffects.map(effect => ({ ...effect, life: effect.life - deltaTime })).filter(effect => effect.life > 0);
      next.agents = next.agents.map(agent => ({
        ...agent,
        stateVector: showSenses ? getAgentStateVector(agent, next, VIEWPORT) : undefined,
        rewardBreakdown: undefined,
      }));
      return next;
    });
  }, [asset, controlledJumpActive, pursuitDesign, showSenses, sprintActive, terrainConfig, upgradeConfig]);

  const updateSimulation = useCallback((elapsedMs: number) => {
    if (paused || !asset) return;
    const safeDelta = Math.min(100, Math.max(0, elapsedMs));
    visualStepAccumulator.current += safeDelta * Math.max(0.25, Math.min(10, visualSpeed));
    const steps = Math.min(60, Math.floor(visualStepAccumulator.current / 16.67));
    visualStepAccumulator.current -= steps * 16.67;
    for (let i = 0; i < steps; i++) updateGame(16.67);
  }, [asset, paused, updateGame, visualSpeed]);

  useGameLoop(updateSimulation);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be blocked by embedded browsers.
    }
  }, []);

  const setLightingMode = useCallback((mode: 'realtime' | 'cycle') => {
    setDayNightConfig(previous => ({
      ...previous,
      mode,
      cycleAnchorMs: Date.now(),
      cycleAnchorHour: mode === 'cycle' ? 8 : previous.cycleAnchorHour,
    }));
  }, []);

  if (loadError) {
    return (
      <div className="w-screen h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6 font-sans">
        <div className="max-w-lg rounded-2xl border border-red-500/30 bg-gray-900 p-6 shadow-2xl">
          <h1 className="text-xl font-bold text-red-300">Tag Agents showcase could not start</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">{loadError}</p>
          <button onClick={() => window.location.reload()} className="mt-5 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Reload</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-gray-950 font-sans text-gray-100"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      <GameCanvas
        gameState={gameState}
        showTrails={showTrails}
        showSenses={showSenses}
        cameraZoom={cameraZoom}
        dayNightConfig={dayNightConfig}
      />

      {!asset && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-950 text-cyan-300 font-mono text-sm">
          Loading evolved agents…
        </div>
      )}

      {asset && introVisible && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
          <div className="text-center px-6 drop-shadow-2xl">
            <div className="text-[11px] uppercase tracking-[0.45em] text-cyan-200/90">Neuroevolution showcase</div>
            <h1 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight text-white">TAG AGENTS</h1>
            <p className="mt-3 text-sm sm:text-base text-gray-300">Emergent pursuit and evasion through NEAT</p>
            <p className="mt-2 font-mono text-[11px] text-gray-400">Checkpoint {asset.sourceCheckpointGeneration.toLocaleString()} · Chaser g{asset.chaser.generation} · Runner g{asset.runner.generation}</p>
          </div>
        </div>
      )}

      {asset && (
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-cyan-500/20 bg-black/55 px-3 py-2 backdrop-blur shadow-lg">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">Tag Agents</div>
          <div className="mt-1 font-mono text-[10px] text-gray-400">g{asset.chaser.generation} chase · g{asset.runner.generation} evade</div>
        </div>
      )}

      <div
        className={`absolute bottom-4 left-1/2 z-40 -translate-x-1/2 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-gray-700/70 bg-black/75 p-2 shadow-2xl backdrop-blur-md">
          <button onClick={() => setPaused(value => !value)} className="rounded-lg px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-gray-800">{paused ? 'Play' : 'Pause'}</button>
          <button onClick={resetArena} className="rounded-lg px-3 py-2 text-xs text-gray-300 hover:bg-gray-800">Reset</button>
          <span className="mx-1 h-5 w-px bg-gray-700" />
          {[0.5, 1, 2, 5].map(speed => (
            <button key={speed} onClick={() => setVisualSpeed(speed)} className={`rounded-md px-2 py-1.5 font-mono text-[11px] ${visualSpeed === speed ? 'bg-cyan-400 text-black' : 'text-gray-400 hover:bg-gray-800'}`}>{speed}×</button>
          ))}
          <span className="mx-1 h-5 w-px bg-gray-700" />
          <button onClick={() => setCameraZoom(value => Math.max(0.5, value - 0.25))} className="rounded-md px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800" aria-label="Zoom out">−</button>
          <button onClick={() => setCameraZoom(1)} className="min-w-[48px] rounded-md px-2 py-1.5 font-mono text-[10px] text-gray-300 hover:bg-gray-800">{Math.round(cameraZoom * 100)}%</button>
          <button onClick={() => setCameraZoom(value => Math.min(2, value + 0.25))} className="rounded-md px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800" aria-label="Zoom in">+</button>
          <span className="mx-1 h-5 w-px bg-gray-700" />
          <button onClick={() => setShowTrails(value => !value)} className={`rounded-md px-2.5 py-1.5 text-[11px] ${showTrails ? 'text-cyan-200' : 'text-gray-500'} hover:bg-gray-800`}>Trails</button>
          <button onClick={() => setShowSenses(value => !value)} className={`rounded-md px-2.5 py-1.5 text-[11px] ${showSenses ? 'text-cyan-200' : 'text-gray-500'} hover:bg-gray-800`}>Senses</button>
          <button onClick={() => setLightingMode(dayNightConfig.mode === 'cycle' ? 'realtime' : 'cycle')} className="rounded-md px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800">{dayNightConfig.mode === 'cycle' ? '10m day' : 'Realtime'}</button>
          <button onClick={toggleFullscreen} className="rounded-md px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800">Fullscreen</button>
        </div>
      </div>

      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`absolute right-4 top-4 z-40 rounded-lg border border-gray-700/60 bg-black/55 px-3 py-2 text-[10px] text-gray-400 backdrop-blur transition-opacity hover:text-cyan-200 ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          title="Open the source repository"
        >
          Source on GitHub
        </a>
      )}
    </div>
  );
};

export default DemoApp;
