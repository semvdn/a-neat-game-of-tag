
import type { LearningAgent } from './learning/agent';
import type { NeatGenerationMetrics, NeatGenomeData, NetworkArchitectureSuiteConfig } from './learning/neat';

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

export type UpgradeMode = 'off' | 'on';
export interface UpgradeRule {
  mode: UpgradeMode;
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
export interface TrainingFitnessConfig {
  /** SAFE rightward distance needed across the two Runner slots in each 2-second pace window. */
  runnerPaceTargetPxPerWindow: number;
  /** Maximum Runner fitness earned for satisfying one pace window. */
  runnerPaceRewardPerWindow: number;
  /** Chaser shaping for a first safe landing on a platform a Runner has already occupied. */
  chaserPursuitRewardPerPlatform: number;
  /** Legacy field accepted only when migrating older checkpoints/settings. */
  runnerExplorationRewardPerViewport?: number;
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
  touchingCameraFrame?: boolean;
  cameraFrameContact?: 'left' | 'right' | null;
  sprintIntensity?: number;
  jumpPower?: number;
  /** Mechanical jump latch: false after a jump until the jump output is released. */
  jumpArmed?: boolean;
}

export interface PlatformState {
  id: number;
  position: Vector2D;
  width: number;
  height: number;
  structureType?: 'normal' | 'branch-upper' | 'branch-lower' | 'merge';
  branchGroupId?: number;
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



export interface BalanceTelemetry {
  generation: number;
  matches: number;
  tags: number;
  tagRate: number;
  /** Fraction of population matches with no tag and no runner fall. */
  survivalRate: number;
  avgTagTimeMs: number | null;
  /** Fixed-horizon population matches containing at least one chaser fall. */
  chaserFalls?: number;
  /** Fixed-horizon population matches containing at least one runner fall. */
  runnerFalls?: number;
  /** Fraction of population matches containing at least one chaser fall. */
  chaserFallRate?: number;
  /** Fraction of population matches containing at least one runner fall. */
  runnerFallRate?: number;
  /** Mean SAFE rightward progression, averaged across the two runner slots, per scored match. */
  runnerFrontierExpansionPxPerEpisode?: number;
  runnerFrontierExpansionViewportsPerEpisode?: number;
  runnerLeftFrontierExpansionViewportsPerEpisode?: number;
  /** Raw rightward territory envelope (diagnostic only; may include unbanked airborne motion). */
  runnerRawRightFrontierExpansionViewportsPerEpisode?: number;
  /** SAFE rightward progression used for exploration fitness. */
  runnerRightFrontierExpansionViewportsPerEpisode?: number;
  runnerExplorationBonusPerEpisode?: number;
  runnerMaxFrontierExpansionPx?: number;
  /** Mean fraction (0..1) of the capped Runner pace target achieved per pace window. */
  runnerPaceCompletion?: number;
  runnerPaceWindowsSatisfiedPerEpisode?: number;
  runnerPaceBonusPerEpisode?: number;
  chaserPursuitBonusPerEpisode?: number;
  chaserPursuitLandingsPerEpisode?: number;
  runnerPlatformLandingsPerEpisode?: number;
  chaserPlatformLandingsPerEpisode?: number;
  runnerBranchLandingsPerEpisode?: number;
  chaserBranchLandingsPerEpisode?: number;
  closeEncountersPerEpisode?: number;
  successfulEvadesPerEpisode?: number;
  meanNearestRunnerDistancePx?: number;
  timeWithin100Pct?: number;
  timeWithin200Pct?: number;
  timeWithin400Pct?: number;
  tagsSoonAfterRunnerFallPerEpisode?: number;
}

export interface BenchmarkRoleTelemetry {
  meanFitness: number;
  matches: number;
  tagsPerEpisode: number;
  ownFallsPerEpisode: number;
  /** Fraction of policy decisions with net rightward drive (right − left) above the active threshold. */
  rightActionShare: number;
  /** Fraction of decisions with jump output above the active threshold. */
  jumpActionShare: number;
  /** Fraction of decisions with sprint output above the active threshold. */
  sprintActionShare: number;
  /** Fraction of decisions with no factorized control above the active threshold. */
  idleActionShare: number;
  /** Candidate runner frontier expansion on the permanent benchmark; 0 for chaser-role benchmarks. */
  explorationViewportsPerEpisode?: number;
  paceCompletion?: number;
  pursuitBonusPerEpisode?: number;
  closeEncountersPerEpisode?: number;
}


export interface GeneralistChampionTelemetry {
  role: 'chaser' | 'evader';
  /** Generation in which this retained policy originally competed. */
  generation: number;
  /** Generation at which it most recently became the retained visible/generalist champion. */
  selectedAtGeneration: number;
  /** Frozen benchmark suite revision used for this score. */
  suiteRevision: number;
  /** Generalization score used only for retention/display, never population selection. */
  score: number;
  benchmark: BenchmarkRoleTelemetry;
}

export interface CrossGenerationBenchmarkTelemetry {
  generation: number;
  suiteRevision: number;
  chaser: BenchmarkRoleTelemetry;
  evader: BenchmarkRoleTelemetry;
}

export interface HallOfFameTelemetry {
  chaserSize: number;
  evaderSize: number;
  maxSize: number;
  opponentsPerGenome: number;
  chaserGenerations: number[];
  evaderGenerations: number[];
  chaserRecentSize?: number;
  evaderRecentSize?: number;
  chaserDiverseSize?: number;
  evaderDiverseSize?: number;
  chaserDiversity?: number;
  evaderDiversity?: number;
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
  totalChaserFalls?: number;
  totalRunnerFalls?: number;
  totalSuccessfulJumps: number;
  actionDistribution: Record<string, number>;
  chaserActionDistribution: Record<string, number>;
  evaderActionDistribution: Record<string, number>;
  generation: number;
  chaserElo: number;
  evaderElo: number;
  eloLeaderboard: EloLeaderboardEntry[];
  hallOfFame?: HallOfFameTelemetry;
  lastCrossGenerationBenchmark?: CrossGenerationBenchmarkTelemetry | null;
  benchmarkHistory?: CrossGenerationBenchmarkTelemetry[];
  benchmarkSuiteRevision?: number;
  chaserGeneralistChampion?: GeneralistChampionTelemetry | null;
  evaderGeneralistChampion?: GeneralistChampionTelemetry | null;
  lastGenerationBalance?: BalanceTelemetry | null;
  balanceHistory?: BalanceTelemetry[];
  trainingSpeedX?: number;
  trainingEpisodesPerSecond?: number;
  trainingBackend?: string;
  trainingWorkerCount?: number;
  trainingRecoveryCount?: number;
  trainingLastRecoveryReason?: string;
  sprintUpgradeActive?: boolean;
  controlledJumpUpgradeActive?: boolean;
  trainingFitnessConfig?: TrainingFitnessConfig;
  networkArchitecture?: NetworkArchitectureSuiteConfig;
}

export interface TrainingGenerationAnalysisRecord {
  generation: number;
  recordedAt: number;
  simulatedTimeMs: number;
  completedEpisodes: number;
  chaserMetrics: NeatGenerationMetrics | null;
  runnerMetrics: NeatGenerationMetrics | null;
  balance: BalanceTelemetry | null;
  benchmark: CrossGenerationBenchmarkTelemetry | null;
  generalistChampions?: { chaser: GeneralistChampionTelemetry | null; runner: GeneralistChampionTelemetry | null };
  hallOfFame: HallOfFameTelemetry;
  chaserElo: number;
  runnerElo: number;
  actionShares: {
    chaser: Record<string, number>;
    runner: Record<string, number>;
  };
  fitnessConfig: TrainingFitnessConfig;
  networkArchitecture?: NetworkArchitectureSuiteConfig;
}

