export type HorizonTierName = 'Beginner' | 'Developing' | 'Competent' | 'Advanced' | 'Mature';

export interface HorizonTierConfig {
  name: HorizonTierName;
  normalMinMs: number;
  normalMaxMs: number;
  stretchMinMs: number;
  stretchMaxMs: number;
  hofEveryGenerations: number;
}

export const HORIZON_TIERS: readonly HorizonTierConfig[] = [
  { name: 'Beginner',   normalMinMs: 8_000,  normalMaxMs: 12_000, stretchMinMs: 18_000, stretchMaxMs: 22_000, hofEveryGenerations: 3 },
  { name: 'Developing', normalMinMs: 12_000, normalMaxMs: 18_000, stretchMinMs: 22_000, stretchMaxMs: 28_000, hofEveryGenerations: 2 },
  { name: 'Competent',  normalMinMs: 18_000, normalMaxMs: 25_000, stretchMinMs: 28_000, stretchMaxMs: 35_000, hofEveryGenerations: 1 },
  { name: 'Advanced',   normalMinMs: 24_000, normalMaxMs: 32_000, stretchMinMs: 35_000, stretchMaxMs: 42_000, hofEveryGenerations: 1 },
  { name: 'Mature',     normalMinMs: 30_000, normalMaxMs: 42_000, stretchMinMs: 45_000, stretchMaxMs: 55_000, hofEveryGenerations: 1 },
] as const;

export interface HorizonCurriculumState {
  tierIndex: number;
  competenceEma: number;
  goodGenerations: number;
  badGenerations: number;
  generationsObserved: number;
  /** Prevents the horizon and terrain curricula from escalating simultaneously. */
  holdGenerations: number;
}

export interface HorizonObservation {
  navigationScore: number;
  fallRate: number;
  tagsPer30s: number;
  avgSurvivalStreakMs: number;
  avgMatchDurationMs: number;
  chaserWinRate: number;
  evaderWinRate: number;
}

export interface HorizonSnapshot extends HorizonCurriculumState {
  tier: HorizonTierName;
  normalMinMs: number;
  normalMaxMs: number;
  stretchMinMs: number;
  stretchMaxMs: number;
  hofEveryGenerations: number;
  competenceScore: number;
  lastNavigationScore: number;
  lastFallRate: number;
  lastTagsPer30s: number;
  lastSurvivalRatio: number;
  lastChaserWinRate: number;
  lastEvaderWinRate: number;
  tierChanged: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function createHorizonCurriculumState(tierIndex = 0): HorizonCurriculumState {
  return {
    tierIndex: Math.max(0, Math.min(HORIZON_TIERS.length - 1, Math.floor(tierIndex))),
    competenceEma: 0.48,
    goodGenerations: 0,
    badGenerations: 0,
    generationsObserved: 0,
    holdGenerations: 0,
  };
}

export function currentHorizonTier(state: HorizonCurriculumState): HorizonTierConfig {
  return HORIZON_TIERS[Math.max(0, Math.min(HORIZON_TIERS.length - 1, state.tierIndex))];
}

export function getHorizonWindow(state: HorizonCurriculumState, kind: 'normal' | 'stretch'): { minMs: number; maxMs: number } {
  const tier = currentHorizonTier(state);
  return kind === 'stretch'
    ? { minMs: tier.stretchMinMs, maxMs: tier.stretchMaxMs }
    : { minMs: tier.normalMinMs, maxMs: tier.normalMaxMs };
}

export function shouldRunHallOfFame(state: HorizonCurriculumState, generation: number): boolean {
  const every = currentHorizonTier(state).hofEveryGenerations;
  return every <= 1 || generation % every === 0;
}

export function holdHorizonForTerrainChange(state: HorizonCurriculumState, generations = 3) {
  state.holdGenerations = Math.max(state.holdGenerations, generations);
}

function scoreObservation(observation: HorizonObservation): { score: number; survivalRatio: number } {
  const navigation = clamp01((observation.navigationScore - 0.42) / 0.34);
  const terrainReliability = clamp01((0.38 - observation.fallRate) / 0.28);
  // We want active pursuit, but do not reward an ever-higher tag rate here; one tag / 30s is enough
  // evidence that the chaser side is interacting competently.
  const interaction = clamp01(observation.tagsPer30s / 1.0);
  const survivalRatio = observation.avgMatchDurationMs > 0
    ? clamp01(observation.avgSurvivalStreakMs / observation.avgMatchDurationMs)
    : 0;
  const runnerDurability = clamp01((survivalRatio - 0.12) / 0.38);
  const balanceGap = Math.abs(observation.chaserWinRate - observation.evaderWinRate);
  const balance = clamp01(1 - balanceGap / 0.80);

  return {
    score:
      0.28 * navigation +
      0.22 * terrainReliability +
      0.18 * interaction +
      0.22 * runnerDurability +
      0.10 * balance,
    survivalRatio,
  };
}

export function horizonSnapshot(
  state: HorizonCurriculumState,
  observation?: Partial<HorizonObservation>,
  competenceScore = state.competenceEma,
  tierChanged = false,
): HorizonSnapshot {
  const tier = currentHorizonTier(state);
  const avgDuration = observation?.avgMatchDurationMs ?? (tier.normalMinMs + tier.normalMaxMs) / 2;
  const survivalRatio = avgDuration > 0 ? (observation?.avgSurvivalStreakMs ?? 0) / avgDuration : 0;
  return {
    ...state,
    tier: tier.name,
    normalMinMs: tier.normalMinMs,
    normalMaxMs: tier.normalMaxMs,
    stretchMinMs: tier.stretchMinMs,
    stretchMaxMs: tier.stretchMaxMs,
    hofEveryGenerations: tier.hofEveryGenerations,
    competenceScore,
    lastNavigationScore: observation?.navigationScore ?? 0,
    lastFallRate: observation?.fallRate ?? 0,
    lastTagsPer30s: observation?.tagsPer30s ?? 0,
    lastSurvivalRatio: clamp01(survivalRatio),
    lastChaserWinRate: observation?.chaserWinRate ?? 0,
    lastEvaderWinRate: observation?.evaderWinRate ?? 0,
    tierChanged,
  };
}

export function advanceHorizonCurriculum(
  state: HorizonCurriculumState,
  observation: HorizonObservation,
): HorizonSnapshot {
  const { score, survivalRatio } = scoreObservation(observation);
  const competenceEma = state.competenceEma * 0.75 + score * 0.25;

  const clearlyCompetent =
    competenceEma >= 0.63 &&
    observation.navigationScore >= 0.55 &&
    observation.fallRate <= 0.25 &&
    observation.tagsPer30s >= 0.45 &&
    survivalRatio >= 0.20;

  const clearlyStruggling =
    competenceEma < 0.38 ||
    observation.navigationScore < 0.32 ||
    observation.fallRate > 0.42;

  state.competenceEma = competenceEma;
  state.generationsObserved++;

  if (state.holdGenerations > 0) {
    state.holdGenerations--;
    state.goodGenerations = 0;
    state.badGenerations = 0;
    return horizonSnapshot(state, observation, score, false);
  }

  state.goodGenerations = clearlyCompetent ? state.goodGenerations + 1 : 0;
  state.badGenerations = clearlyStruggling ? state.badGenerations + 1 : 0;

  let tierChanged = false;
  if (state.goodGenerations >= 5 && state.tierIndex < HORIZON_TIERS.length - 1) {
    state.tierIndex++;
    state.goodGenerations = 0;
    state.badGenerations = 0;
    tierChanged = true;
  } else if (state.badGenerations >= 3 && state.tierIndex > 0) {
    state.tierIndex--;
    state.goodGenerations = 0;
    state.badGenerations = 0;
    tierChanged = true;
  }

  return horizonSnapshot(state, observation, score, tierChanged);
}
