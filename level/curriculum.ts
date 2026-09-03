export interface CurriculumState {
  difficulty: number;
  navigationEma: number;
  generationsObserved: number;
}

export interface CurriculumObservation {
  navigationScore: number;
  fallRatePerAgentEpisode: number;
}

export interface CurriculumSnapshot extends CurriculumState {
  lastNavigationScore: number;
  lastFallRatePerAgentEpisode: number;
  branchesUnlocked: boolean;
  movingUnlocked: boolean;
  crumblingUnlocked: boolean;
}

export const BRANCH_UNLOCK_DIFFICULTY = 0.20;
export const MOVING_UNLOCK_DIFFICULTY = 0.35;
export const CRUMBLING_UNLOCK_DIFFICULTY = 0.52;

export function createCurriculumState(difficulty = 0.08): CurriculumState {
  return {
    difficulty: Math.max(0, Math.min(1, difficulty)),
    navigationEma: 0.62,
    generationsObserved: 0,
  };
}

export function advanceCurriculum(
  state: CurriculumState,
  observation: CurriculumObservation,
): CurriculumSnapshot {
  const score = Math.max(0, Math.min(1, observation.navigationScore));
  const fallRate = Math.max(0, observation.fallRatePerAgentEpisode);
  const navigationEma = state.navigationEma * 0.72 + score * 0.28;

  let delta = 0;
  // Progress only when terrain is being navigated competently. The hysteresis prevents
  // difficulty from seesawing because of one odd coevolutionary generation.
  if (navigationEma >= 0.68 && fallRate <= 0.55) delta = 0.03;
  else if (navigationEma < 0.42 || fallRate > 1.0) delta = -0.02;

  const difficulty = Math.max(0.04, Math.min(1, state.difficulty + delta));
  state.difficulty = difficulty;
  state.navigationEma = navigationEma;
  state.generationsObserved++;

  return {
    ...state,
    lastNavigationScore: score,
    lastFallRatePerAgentEpisode: fallRate,
    branchesUnlocked: difficulty >= BRANCH_UNLOCK_DIFFICULTY,
    movingUnlocked: difficulty >= MOVING_UNLOCK_DIFFICULTY,
    crumblingUnlocked: difficulty >= CRUMBLING_UNLOCK_DIFFICULTY,
  };
}

export function curriculumSnapshot(
  state: CurriculumState,
  lastNavigationScore = state.navigationEma,
  lastFallRatePerAgentEpisode = 0,
): CurriculumSnapshot {
  return {
    ...state,
    lastNavigationScore,
    lastFallRatePerAgentEpisode,
    branchesUnlocked: state.difficulty >= BRANCH_UNLOCK_DIFFICULTY,
    movingUnlocked: state.difficulty >= MOVING_UNLOCK_DIFFICULTY,
    crumblingUnlocked: state.difficulty >= CRUMBLING_UNLOCK_DIFFICULTY,
  };
}
