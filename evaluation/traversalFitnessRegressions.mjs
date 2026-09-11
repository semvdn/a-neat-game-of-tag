import assert from 'node:assert/strict';
import {
  CHASER_TRAVERSAL_MAX_REQUIRED_TRANSITIONS_PER_WINDOW,
  CHASER_TRAVERSAL_REWARD_PER_WINDOW,
  CHASER_TRAVERSAL_SHORTFALL_PENALTY_PER_WINDOW,
} from '../constants.ts';

export function verifyTraversalFitnessConstants() {
  assert(CHASER_TRAVERSAL_REWARD_PER_WINDOW > 0, 'Useful traversal must have positive fitness');
  assert(CHASER_TRAVERSAL_SHORTFALL_PENALTY_PER_WINDOW > CHASER_TRAVERSAL_REWARD_PER_WINDOW,
    'Refusing required traversal should be more costly than the full-window traversal reward');
  assert.equal(CHASER_TRAVERSAL_MAX_REQUIRED_TRANSITIONS_PER_WINDOW, 2,
    'Traversal demand should remain capped and cannot become an unbounded platform race');
  console.log('Traversal fitness regressions passed: conditional reward/shortfall constants are bounded and asymmetric');
}
