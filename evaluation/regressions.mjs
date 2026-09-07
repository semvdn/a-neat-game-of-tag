import assert from 'node:assert/strict';
import { EncounterTracker } from '../learning/encounters.ts';

export function verifyEncounterAccounting() {
  for (const distance of [400, Infinity]) {
    const clean = new EncounterTracker();
    assert.equal(clean.step(100, 0), 'entered');
    assert.equal(clean.step(200, 0), null);
    assert.equal(clean.step(distance, 0), 'evaded');
    assert.equal(clean.step(distance, 0), null, 'No repeated reward at distance');
    for (const falls of [1, 2]) {
      const failed = new EncounterTracker();
      failed.step(100, 0);
      assert.equal(failed.step(distance, falls), null, 'A fall cannot produce an evade');
      assert.equal(failed.step(distance, falls), null, 'No deferred fall reward');
      assert.equal(failed.step(100, falls), 'entered', 'Fresh pressure after recovery is valid');
      assert.equal(failed.step(distance, falls), 'evaded');
    }
  }
  const tagged = new EncounterTracker();
  tagged.step(100, 0);
  tagged.reset();
  assert.equal(tagged.step(400, 0), null, 'Role swap cannot become an evade');
  console.log('Encounter regressions passed (distance, route split, falls, recovery, tag, hysteresis)');
}
