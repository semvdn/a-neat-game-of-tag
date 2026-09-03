
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

export type PlatformKind = 'static' | 'moving' | 'crumbling';
export type CrumblePhase = 'stable' | 'warning' | 'gone';

export interface PlatformMotion {
  axis: 'x' | 'y';
  amplitude: number;
  /** Oscillations per second. */
  speed: number;
  phase: number;
}

export interface PlatformCrumble {
  /** Time from first contact until the platform disappears. */
  disappearDelayMs: number;
  /** Time spent absent before it respawns. */
  respawnDelayMs: number;
  triggeredAt?: number;
}

export interface PlatformState {
  id: number;
  position: Vector2D;
  /** Stable reference position used by deterministic moving-platform motion. */
  basePosition?: Vector2D;
  width: number;
  height: number;
  kind?: PlatformKind;
  motion?: PlatformMotion;
  crumble?: PlatformCrumble;
  crumblePhase?: CrumblePhase;
  active?: boolean;
  routeRole?: 'start' | 'backbone' | 'branch';
  routeId?: string;
}

export interface CourseEdge {
  from: number;
  to: number;
  routeId: string;
  kind: 'backbone' | 'branch';
}

export interface CourseGraph {
  seed: number;
  difficulty: number;
  edges: CourseEdge[];
  branchCount: number;
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
  courseGraph?: CourseGraph;
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


export interface BalanceTelemetry {
  generation: number;
  matches: number;
  tags: number;
  /** Matches containing at least one tag. */
  matchesWithTag: number;
  /** Matches that reached the randomized horizon without a single tag. */
  timeouts: number;
  chaserFalls: number;
  evaderFalls: number;
  doubleFalls: number;
  /** Fraction of long matches containing at least one tag. */
  tagRate: number;
  /** Fraction of long matches with no tags at all. */
  survivalRate: number;
  /** Fraction of bout-ending events caused by terrain failure rather than tags. */
  fallRate: number;
  chaserWinRate: number;
  evaderWinRate: number;
  drawRate: number;
  /** Tag events normalized to 30 seconds of simulated match time. */
  tagsPer30s: number;
  avgTagsPerMatch: number;
  /** Mean uninterrupted evader survival streak sampled at tags and match end. */
  avgSurvivalStreakMs: number | null;
  /** Mean time that the current chaser had been It before a successful tag. */
  avgTagTimeMs: number | null;
}

export interface CurriculumTelemetry {
  difficulty: number;
  navigationEma: number;
  lastNavigationScore: number;
  lastFallTerminationRate: number;
  generationsObserved: number;
  branchesUnlocked: boolean;
  movingUnlocked: boolean;
  crumblingUnlocked: boolean;
  lastCourseSeed?: number;
  lastCourseBranchCount?: number;
  lastCourseMovingPlatforms?: number;
  lastCourseCrumblingPlatforms?: number;
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
  hallOfFame?: HallOfFameTelemetry;
  lastGenerationBalance?: BalanceTelemetry | null;
  balanceHistory?: BalanceTelemetry[];
  curriculum?: CurriculumTelemetry;
}
