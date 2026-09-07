
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

export interface TerrainVarietyConfig {
  /** Fraction of training episodes that contain at least one true branching route. */
  trainingBranchingEnabled: boolean;
  trainingBranchingEpisodePercent: number;
  /** Fraction of training episodes in which moving platforms may appear. */
  trainingMovingPlatformsEnabled: boolean;
  trainingMovingEpisodePercent: number;
  /** Continuous/champion-view route generation controls. */
  continuousBranchingEnabled: boolean;
  continuousBranchSpawnPercent: number;
  continuousMovingPlatformsEnabled: boolean;
  continuousMovingSpawnPercent: number;
  /** Shared geometry limits used by both training and the continuous view. */
  movingPlatformMaxSpeed: number;
  maxPlatformsPerBranch: number;
  subBranchingEnabled: boolean;
  maxBranchDepth: number;
  movingPlatformsInBranches: boolean;
}

export interface TerrainRuntimeConfig {
  branchingEnabled: boolean;
  branchSpawnChance: number;
  /** Training-only guarantee: selected feature episodes materialize the feature early. */
  guaranteeBranchExposure: boolean;
  movingPlatformsEnabled: boolean;
  movingSpawnChance: number;
  guaranteeMovingExposure: boolean;
  movingPlatformMaxSpeed: number;
  maxPlatformsPerBranch: number;
  subBranchingEnabled: boolean;
  maxBranchDepth: number;
  movingPlatformsInBranches: boolean;
}

export interface PursuitDesignConfig {
  /** Role-specific pursuit-balance physics used by the integrated training design. */
  chaserBaseMaxSpeed?: number;
  runnerBaseMaxSpeed?: number;
  chaserSprintMaxSpeed?: number;
  runnerSprintMaxSpeed?: number;
  chaserSprintStaminaCostPerSec?: number;
  runnerSprintStaminaCostPerSec?: number;
  /** Fresh-start curriculum that places the Chaser behind Runners at controlled gaps. */
  pressureStartDistribution?: boolean;
  /** Small non-repeatable reward for reaching a new best proximity within a chase segment. */
  chaserProximityProgressReward?: boolean;
  chaserProximityStepPx?: number;
  chaserProximityRewardPerStep?: number;
  chaserProximityRewardCapPerSegment?: number;
  /** Optional total episode cap for the tactical Runner pressure-escape bonus. */
  runnerPressureEscapeEpisodeCap?: number;
  /** Tag immunity granted immediately after a Runner is fairly respawned from a fall. */
  postFallRunnerTagProtectionMs?: number;
  /** Optional route-exposure threshold used by pursuit training. */
  branchStructureMinX?: number;
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
  /** Optional role-specific base speeds supplied by the integrated pursuit design. */
  chaserBaseMaxSpeed?: number;
  runnerBaseMaxSpeed?: number;
  /** Optional Runner-only post-fall tag protection used by pursuit balance. */
  postFallRunnerTagProtectionMs?: number;
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
  /** Active mutually-exclusive route. Cleared or reduced only by the matching merge platform. */
  activeRoutePath?: string | null;
  elo?: number;
  role?: 'chaser' | 'evader';
  sprintIntensity?: number;
  jumpPower?: number;
  /** Mechanical jump latch: false after a jump until the jump output is released. */
  jumpArmed?: boolean;
}

export interface PlatformMotionState {
  axis: 'x' | 'y';
  min: number;
  max: number;
  speed: number;
  direction: -1 | 1;
}

export interface PlatformState {
  id: number;
  position: Vector2D;
  width: number;
  height: number;
  structureType?: 'normal' | 'branch-upper' | 'branch-lower' | 'merge';
  branchGroupId?: number;
  branchDepth?: number;
  /** Full hierarchical route path, e.g. g12U/g18L. */
  routePath?: string;
  /** Route restored after this merge; empty/null means the shared trunk. */
  mergeToRoutePath?: string | null;
  /** Root structure id shared by every nested platform in one top-level branch tree. */
  rootBranchGroupId?: number;
  /** Optional deterministic oscillating platform motion. */
  motion?: PlatformMotionState;
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
  /** Population matches containing at least one chaser fall. */
  chaserFalls?: number;
  /** Population matches containing at least one runner fall. */
  runnerFalls?: number;
  /** Fraction of population matches containing at least one chaser fall. */
  chaserFallRate?: number;
  /** Population matches that ended because the chase group exceeded the minimum useful camera envelope. */
  chaserEscapes?: number;
  /** Fraction of population matches ending in a Chaser escape failure. */
  chaserEscapeRate?: number;
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
  runnerPaceShortfallPenaltyPerEpisode?: number;
  runnerPressureEscapeBonusPerEpisode?: number;
  chaserProximityBonusPerEpisode?: number;
  chaserDirectionConflictShare?: number;
  runnerDirectionConflictShare?: number;
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
  cleanTagsPerEpisode?: number;
}

export interface BenchmarkRoleTelemetry {
  meanFitness: number;
  matches: number;
  tagsPerEpisode: number;
  ownFallsPerEpisode: number;
  /** Chaser-only camera-envelope escape failures; zero for Runner benchmarks. */
  escapeFailuresPerEpisode?: number;
  /** Fraction of policy decisions with net rightward drive (right − left) above the active threshold. */
  rightActionShare: number;
  /** Fraction of decisions with jump output above the active threshold. */
  jumpActionShare: number;
  /** Fraction of decisions where Sprint is actually boosting horizontal movement. */
  sprintActionShare: number;
  /** Fraction of decisions with no factorized control above the active threshold. */
  idleActionShare: number;
  /** Fraction of decisions where both opposing horizontal outputs were simultaneously active. */
  directionConflictShare?: number;
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
  /** Mean role fitness against the retained/Hall-of-Fame cross-play validation panel. */
  crossPlayMeanFitness?: number;
  crossPlayMatches?: number;
  /** Direct matchup diagnostics against the current retained opposing champion. */
  contemporaryCleanTagsPerEpisode?: number;
  contemporaryPaceCompletion?: number;
  contemporaryTimeWithin200Pct?: number;
  contemporaryCloseEncountersPerEpisode?: number;
  contemporaryFailureEventsPerEpisode?: number;
  /** Strict-gate diagnostics restricted to normal/long pursuit starts. */
  contemporaryNormalLongClosingPx?: number;
  contemporaryNormalLongTimeWithin200Pct?: number;
  contemporaryNormalLongCloseEncountersPerEpisode?: number;
  /** Soft 0..100 pursuit validation used by the hybrid Chaser retention rule. */
  contemporaryPursuitScore?: number;
  contemporaryPursuitCleanTagScore?: number;
  contemporaryPursuitClosingScore?: number;
  contemporaryPursuitThreatScore?: number;
  contemporaryPursuitEncounterScore?: number;
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

export interface EliteSeedingTelemetry {
  /** Generation that received the externally retained/recent seed genomes. */
  generation: number;
  chaserSourceGenerations: number[];
  runnerSourceGenerations: number[];
  chaserInjected: number;
  runnerInjected: number;
}

export interface ShowcasePairTelemetry {
  selectedAtGeneration: number;
  chaserGeneration: number;
  runnerGeneration: number;
  score: number;
  matches: number;
  tagsPerEpisode: number;
  cleanTagsPerEpisode?: number;
  postFallTagsPerEpisode?: number;
  runnerPaceCompletion: number;
  closeEncountersPerEpisode: number;
  successfulEvadesPerEpisode: number;
  chaserFallsPerEpisode: number;
  chaserEscapesPerEpisode?: number;
  runnerFallsPerEpisode: number;
  branchLandingsPerEpisode: number;
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
  totalChaserEscapes?: number;
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
  terrainVarietyConfig?: TerrainVarietyConfig;
  networkArchitecture?: NetworkArchitectureSuiteConfig;
  pursuitDesign?: PursuitDesignConfig | null;
  pursuitDesignFlags?: { pressureStarts: boolean; crossPlayGate: boolean; strictContemporaryGate?: boolean; softMultiDistancePursuit?: boolean; cleanTagShowcase?: boolean };
  selectionAggregation?: string;
  historicalOpponentPanel?: string;
  eliteSeeding?: EliteSeedingTelemetry;
  showcasePair?: ShowcasePairTelemetry | null;
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
  terrainVarietyConfig?: TerrainVarietyConfig;
  networkArchitecture?: NetworkArchitectureSuiteConfig;
  pursuitDesign?: PursuitDesignConfig | null;
  pursuitDesignFlags?: { pressureStarts: boolean; crossPlayGate: boolean; strictContemporaryGate?: boolean; softMultiDistancePursuit?: boolean; cleanTagShowcase?: boolean };
  selectionAggregation?: string;
  historicalOpponentPanel?: string;
  eliteSeeding?: EliteSeedingTelemetry;
  showcasePair?: ShowcasePairTelemetry | null;
}

