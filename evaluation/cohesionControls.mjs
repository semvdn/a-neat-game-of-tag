import assert from 'node:assert/strict';
import { sanitizeTrainingFitnessConfig } from '../learning/trainingFitnessConfig.ts';
import { runTrainingEpisode } from '../learning/trainingEpisode.ts';
import { fixture } from './fixtures.ts';

export function verifyCohesionControls() {
  const old = sanitizeTrainingFitnessConfig({ runnerPaceRewardPerWindow: 12 });
  assert.equal(old.cohesionPenaltyCap, 6);
  assert.equal(old.cohesionPaceWeight, 1);
  const disabled = sanitizeTrainingFitnessConfig({ cohesionPenaltyCap: 0, cohesionPaceWeight: 0 });
  assert.deepEqual(sanitizeTrainingFitnessConfig(JSON.parse(JSON.stringify(disabled))), disabled, 'Zero values survive save/load');
  const clamped = sanitizeTrainingFitnessConfig({ cohesionPenaltyCap: 100, cohesionPaceWeight: -1 });
  assert.equal(clamped.cohesionPenaltyCap, 10);
  assert.equal(clamped.cohesionPaceWeight, 0);
  assert.equal(sanitizeTrainingFitnessConfig({ cohesionPaceWeight: NaN }).cohesionPaceWeight, 1);
  let observedPaceEffect = false;
  for (const seed of [101, 202, 303]) {
    const run = (cap, weight) => runTrainingEpisode(fixture('chaser', 'idle'), fixture('evader', 'traverse'), seed,
      { startMode: 'visual', cohesionPenaltyCap: cap, cohesionPaceWeight: weight });
    const off = run(0, 0), full = run(6, 1), half = run(3, 0.5);
    assert.equal(off.groupCohesion.runnerPenalty, 0);
    assert.equal(off.groupCohesion.chaserPenalty, 0);
    for (const key of ['tags', 'falls', 'elapsedMs', 'runnerPlatformLandings', 'runnerFrontierExpansionPx']) {
      assert.equal(full[key], off[key], 'Shaping cannot change fixed-policy physics');
    }
    assert(Math.abs(half.runnerPaceFitnessBonus - (off.runnerPaceFitnessBonus + full.runnerPaceFitnessBonus) / 2) < 1e-8);
    assert(Math.abs(half.groupCohesion.runnerPenalty * 2 - full.groupCohesion.runnerPenalty) < 1e-8);
    assert(Math.abs(off.chaserFitness - full.chaserFitness - full.groupCohesion.chaserPenalty) < 1e-8);
    assert(Math.abs(off.evaderFitness - full.evaderFitness - (off.runnerPaceFitnessBonus - full.runnerPaceFitnessBonus) - full.groupCohesion.runnerPenalty) < 1e-8);
    observedPaceEffect ||= off.runnerPaceFitnessBonus > full.runnerPaceFitnessBonus + 0.01;
  }
  assert(observedPaceEffect, 'Fixtures must exercise cohesion pace qualification');
  console.log('Cohesion controls passed: migration, zero persistence, bounds, independent and intermediate strengths, unchanged physics');
}
