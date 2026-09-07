import type { PursuitDesignConfig } from '../types';

/** Shared normal-training baseline; laboratory conditions override copies of this object. */
export const BASELINE_PURSUIT_DESIGN: Readonly<PursuitDesignConfig> = {
  chaserBaseMaxSpeed: 5.7,
  runnerBaseMaxSpeed: 5.0,
  chaserSprintMaxSpeed: 7.9,
  runnerSprintMaxSpeed: 7.5,
  chaserSprintStaminaCostPerSec: 28,
  runnerSprintStaminaCostPerSec: 24,
  pressureStartDistribution: true,
  chaserProximityProgressReward: true,
  chaserProximityStepPx: 50,
  chaserProximityRewardPerStep: 1,
  chaserProximityRewardCapPerSegment: 6,
  runnerPressureEscapeEpisodeCap: 6,
  postFallRunnerTagProtectionMs: 900,
  branchStructureMinX: 650,
};
