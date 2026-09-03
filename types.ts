
import type { LearningAgent } from './learning/agent';
import type { NeatGenerationMetrics, NeatGenomeData } from './learning/neat';

export interface Vector2D {
  x: number;
  y: number;
}

export enum AgentStatus {
  Normal = 'Evading',
  It = 'It',
  Cooldown = 'Cooldown',
}

export type RewardBreakdown = { [key: string]: number };

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
  trajectory: Vector2D[];
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
}
