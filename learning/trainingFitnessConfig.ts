import type { TrainingFitnessConfig } from '../types';
import { DEFAULT_RUNNER_PACE_TARGET_PX, DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW, DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM, MIN_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_REWARD_PER_WINDOW, MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM } from '../constants';
import { GROUP_COHESION, sanitizeCohesionShaping } from './groupCohesion';

export const DEFAULT_TRAINING_FITNESS_CONFIG: TrainingFitnessConfig = {
  cohesionPenaltyCap: GROUP_COHESION.penaltyCap,
  cohesionPaceWeight: 1,
  runnerPaceTargetPxPerWindow: DEFAULT_RUNNER_PACE_TARGET_PX,
  runnerPaceRewardPerWindow: DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW,
  chaserPursuitRewardPerPlatform: DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM,
};

export function sanitizeTrainingFitnessConfig(value?: Partial<TrainingFitnessConfig>): TrainingFitnessConfig {
  const target = Number(value?.runnerPaceTargetPxPerWindow);
  const paceReward = Number(value?.runnerPaceRewardPerWindow);
  const pursuit = Number(value?.chaserPursuitRewardPerPlatform);
  return {
    ...sanitizeCohesionShaping(value),
    runnerPaceTargetPxPerWindow: Number.isFinite(target)
      ? Math.max(MIN_RUNNER_PACE_TARGET_PX, Math.min(MAX_RUNNER_PACE_TARGET_PX, target))
      : DEFAULT_TRAINING_FITNESS_CONFIG.runnerPaceTargetPxPerWindow,
    runnerPaceRewardPerWindow: Number.isFinite(paceReward)
      ? Math.max(0, Math.min(MAX_RUNNER_PACE_REWARD_PER_WINDOW, paceReward))
      : DEFAULT_TRAINING_FITNESS_CONFIG.runnerPaceRewardPerWindow,
    chaserPursuitRewardPerPlatform: Number.isFinite(pursuit)
      ? Math.max(0, Math.min(MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM, pursuit))
      : DEFAULT_TRAINING_FITNESS_CONFIG.chaserPursuitRewardPerPlatform,
  };
}
