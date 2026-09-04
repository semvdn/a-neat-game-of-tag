
import type { LearningAgent } from './learning/agent';
import type { NeatGenerationMetrics, NeatGenomeData } from './learning/neat';

export interface Vector2D {
  x: number;
  y: number;
}

// Visual-only trail sample. `timestamp` is champion simulation time in milliseconds.
// Keeping this separate from the policy state ensures trails never affect training/senses.
export interface TrailPoint extends Vector2D {
  timestamp: number;
}

export enum AgentStatus {
  Normal = 'Evading',
  It = 'It',
  Cooldown = 'Cooldown',
}

export type RewardBreakdown = { [key: string]: number };

export type UpgradeMode = 'off' | 'auto' | 'on';
export interface UpgradeRule {
  mode: UpgradeMode;
  threshold: number;
  chaserEnabled: boolean;
  runnerEnabled: boolean;
}

export interface SprintRoleAdvanced {
  maxSpeedOverride: boolean;
  maxSpeed: number;
  staminaCostOverride: boolean;
  staminaCostPerSec: number;
}

export interface SprintUpgradeRule extends UpgradeRule {
  chaserAdvanced: SprintRoleAdvanced;
  runnerAdvanced: SprintRoleAdvanced;
}

export interface UpgradeConfig {
  sprint: SprintUpgradeRule;
  controlledJump: UpgradeRule;
}
export interface ActiveUpgradeState {
  sprint: boolean;
  controlledJump: boolean;
  sprintChaser: boolean;
  sprintRunner: boolean;
  controlledJumpChaser: boolean;
  controlledJumpRunner: boolean;
  sprintChaserMaxSpeed: number;
  sprintRunnerMaxSpeed: number;
  sprintChaserStaminaCostPerSec: number;
  sprintRunnerStaminaCostPerSec: number;
}

export interface LidarRayData {
  angle: number;
  direction: Vector2D;
  distance: number;
  normalizedDistance: number;
  hitPoint: Vector2D | null;
  maxDistance: number;
}

export interface AgentState {
  id: number;
  position: Vector2D;
  velocity: Vector2D;
  acceleration: Vector2D;
  status: AgentStatus;
  color: string;
  isOnGround: boolean;
  cooldownTimer: number; // in milliseconds
  lastAction: string;
  energy: number;
  maxEnergy: number;
  stateVector?: number[];
  rewardBreakdown?: RewardBreakdown;
  trajectory: TrailPoint[];
  lastPlatformId: number | null;
  scale: { x: number; y: number };
  energyAtLastTakeoff: number;
  positionAtLastTakeoff: Vector2D;
  survivalTime: number; // in milliseconds
  timeSinceBecameIt: number; // in milliseconds
  modelId: string;
  modelPerformance?: number;
  elo?: number;
  role?: 'chaser' | 'evader';
  lidarRays?: LidarRayData[];
  touchingCameraFrame?: boolean;
  cameraFrameContact?: 'left' | 'right' | null;
  sprintIntensity?: number;
  jumpPower?: number;
  respawnRecoveryTimer?: number; // ms remaining in post-fall action/regen lock
}

export interface PlatformState {
  id: number;
  position: Vector2D;
  width: number;
  height: number;
}

export interface TagEffect {
    position: Vector2D;
    life: number;
    initialLife: number;
}

export interface GameState {
  agents: AgentState[];
  platforms: PlatformState[];
  cameraPosition: Vector2D;
  gameTime: number;
  tagEffects: TagEffect[];
  avgSurvivalTime: number;
  avgTimeToTag: number;
}

export interface ModelInfo {
  id: string;
  agent: LearningAgent;
  performance: number; // e.g., avg survival time or tag time
  role?: 'chaser' | 'evader';
  elo?: number;
  matchesPlayed?: number;
  generation?: number;
}

export interface EloLeaderboardEntry {
  id: string;
  role: 'chaser' | 'evader';
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  generation: number;
  avgMetric: number;
  isCurrent?: boolean;
}

export interface PerformanceDataPoint {
  timestamp: number;
  gameTime: number;
  generation: number;
  avgSurvivalTime: number; // in seconds
  avgTimeToTag: number; // in seconds
  fallsPerMinute: number;
  tagsPerMinute: number;
  chaserElo?: number;
  evaderElo?: number;
}

export interface BenchmarkResult {
  id: string;
  timestamp: number;
  modelLabel: string;
  durationSeconds: number;
  tagsCompleted: number;
  fallsCount: number;
  avgSurvivalTimeSec: number;
  avgTimeToTagSec: number;
  fallsPerMinute: number;
  tagsPerMinute: number;
  platformJumps: number;
  actionDistribution: Record<string, number>;
  scoreGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  baselineDelta?: {
    survivalPct: number;
    tagSpeedPct: number;
    fallReductionPct: number;
  };
}


export interface BalanceTelemetry {
  generation: number;
  matches: number;
  tags: number;
  tagRate: number;
  survivalRate: number;
  avgTagTimeMs: number | null;
}

export interface HallOfFameTelemetry {
  chaserSize: number;
  evaderSize: number;
  maxSize: number;
  opponentsPerGenome: number;
  chaserGenerations: number[];
  evaderGenerations: number[];
}

export interface DiagnosticsState {
  chaserNeatHistory?: NeatGenerationMetrics[];
  evaderNeatHistory?: NeatGenerationMetrics[];
  lastChaserNeatMetrics?: NeatGenerationMetrics | null;
  lastEvaderNeatMetrics?: NeatGenerationMetrics | null;
  chaserChampionGenome?: NeatGenomeData | null;
  evaderChampionGenome?: NeatGenomeData | null;
  performanceHistory: PerformanceDataPoint[];
  totalTags: number;
  totalFalls: number;
  totalSuccessfulJumps: number;
  actionDistribution: Record<string, number>;
  chaserActionDistribution: Record<string, number>;
  evaderActionDistribution: Record<string, number>;
  generation: number;
  chaserElo: number;
  evaderElo: number;
  eloLeaderboard: EloLeaderboardEntry[];
  showLidar?: boolean;
  benchmarkActive: boolean;
  benchmarkTimeRemaining: number;
  benchmarkResults: BenchmarkResult[];
  hallOfFame?: HallOfFameTelemetry;
  lastGenerationBalance?: BalanceTelemetry | null;
  balanceHistory?: BalanceTelemetry[];
  trainingSpeedX?: number;
  trainingEpisodesPerSecond?: number;
  trainingBackend?: string;
  trainingWorkerCount?: number;
  upgradePerformanceScore?: number;
  upgradePeakPerformanceScore?: number;
  sprintUpgradeActive?: boolean;
  controlledJumpUpgradeActive?: boolean;
  sprintAutoUnlocked?: boolean;
  controlledJumpAutoUnlocked?: boolean;
}
