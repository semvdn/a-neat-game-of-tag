import assert from 'node:assert/strict';
import { resolveRunnerContacts } from '../learning/bodyContacts.ts';
import { measureGroupCohesion, GROUP_COHESION } from '../learning/groupCohesion.ts';
import { stepAgentPhysics, stepAgentPhysicsInPlace, resolveTagSwap, stepMovingPlatformsInPlace } from '../learning/simulationCore.ts';
import { AGENT_HEIGHT as H, AGENT_WIDTH as W, MAX_ENERGY } from '../constants.ts';
import { AgentStatus } from '../types.ts';

export function verifyBodyContacts() {
  const upgrades = { sprint: false, controlledJump: false, sprintChaserMaxSpeed: 7.5, sprintRunnerMaxSpeed: 7.5 };
  const floor = { id: 1, position: { x: -10000, y: 500 }, width: 20000, height: 20 };
  const body = (id, x, y = 500 - H) => ({ id, position: { x, y }, velocity: { x: 0, y: 0 }, acceleration: { x: 0, y: 0 },
    status: AgentStatus.Normal, role: 'evader', energy: MAX_ENERGY, maxEnergy: MAX_ENERGY, jumpArmed: true,
    isOnGround: y === 500 - H, lastPlatformId: 1, cooldownTimer: 0, positionAtLastTakeoff: { x, y: 500 - H },
    energyAtLastTakeoff: MAX_ENERGY, trajectory: [], scale: { x: 1, y: 1 } });
  const frame = (before, decisions = {}) => {
    const results = before.map(a => stepAgentPhysics(a, before, [floor], 0, { width: 1200, height: 800 }, 16.67, decisions[a.id] || { jump: 0 }, upgrades));
    const next = results.map(r => r.agent);
    resolveRunnerContacts(next, before, [floor]);
    const mutable = structuredClone(before);
    for (const a of mutable) stepAgentPhysicsInPlace(a, before, [floor], 123456, { width: 600, height: 400 }, 16.67, decisions[a.id] || { jump: 0 }, upgrades);
    resolveRunnerContacts(mutable, before, [floor]);
    assert.deepEqual(mutable, next, 'World-space contacts match visual and mutable training paths');
    return { next, results };
  };
  const lower = body(1, 100), upper = body(2, 100, 500 - 2 * H);
  upper.isOnGround = true;
  let result = frame([lower, upper], { 1: { jump: 1 } });
  assert.equal(result.results[0].jumped, false, 'Loaded lower Runner cannot jump');
  assert.equal(result.next[0].energy, MAX_ENERGY, 'Blocked jump costs no stamina');
  assert.equal(result.next[1].supportingAgentId, 1);
  result = frame([lower, upper], { 2: { jump: 1 } });
  assert.equal(result.results[1].jumped, true, 'Upper Runner can jump away');
  assert(result.next[1].position.y < upper.position.y);
  const chaser = { ...upper, status: AgentStatus.It };
  assert.equal(frame([lower, chaser], { 1: { jump: 1 } }).results[0].jumped, true, 'Chaser never blocks jumping');
  const headOn = [body(1, 100), body(2, 100 + W + 1)];
  headOn[0].velocity.x = 5; headOn[1].velocity.x = -5;
  result = frame(headOn, { 1: { moveRight: 1 }, 2: { moveLeft: 1 } });
  assert(result.next[1].position.x - result.next[0].position.x >= W - 1e-7, 'Head-on runners cannot overlap');
  assert.deepEqual(frame([...headOn].reverse(), { 1: { moveRight: 1 }, 2: { moveLeft: 1 } }).next.reverse(), result.next, 'Array order does not decide who wins contact');
  const edgeBefore = [body(1, 50), body(2, 92)];
  edgeBefore[0].isOnGround = false;
  edgeBefore[0].lastPlatformId = 0;
  const edgeAfter = structuredClone(edgeBefore);
  edgeAfter[0].position.x = 55;
  edgeAfter[0].isOnGround = true;
  edgeAfter[0].lastPlatformId = 1;
  resolveRunnerContacts(edgeAfter, edgeBefore, [{ ...floor, position: { x: 92, y: 500 }, width: 100 }]);
  assert.equal(edgeAfter[0].isOnGround, false, 'Contact before reaching the platform edge cannot create a ghost floor');
  assert.equal(edgeAfter[0].lastPlatformId, 0, 'Unreached platform cannot become a respawn checkpoint');
  const falling = body(2, 100, 500 - 2 * H - 10); falling.velocity.y = 50;
  assert.equal(frame([lower, falling]).next[1].position.y, lower.position.y - H, 'Fast descending body lands on Runner before floor');
  const overhead = body(2, 100, upper.position.y - 10);
  result = frame([lower, overhead], { 1: { jump: 1 } });
  assert.equal(result.next[1].position.y, overhead.position.y + 0.5, 'Head collision must not shove the upper body upward');
  assert(result.next[0].position.y >= result.next[1].position.y + H - 1e-6);
  const riding = frame([lower, upper]).next;
  const movingFloor = { ...floor, position: { ...floor.position }, motion: { axis: 'x', min: -10000, max: -9900, speed: 60, direction: 1 } };
  stepMovingPlatformsInPlace([movingFloor], riding, 16.67);
  assert(Math.abs(riding[0].position.x - riding[1].position.x) < 1e-7, 'Moving platform carries the stack exactly once');
  const taggedStack = frame([lower, upper]).next;
  taggedStack.push({ ...body(3, 100), status: AgentStatus.It });
  resolveTagSwap(taggedStack);
  assert.equal(taggedStack[1].isOnGround, false, 'A rider loses support when its support becomes Chaser');
  // Sustained opposed controls should create a stable obstruction rather than slowly interpenetrate.
  let pair = headOn;
  for (let i = 0; i < 600; i++) {
    pair = frame(pair, { 1: { moveRight: 1 }, 2: { moveLeft: 1 } }).next;
    assert(pair[1].position.x - pair[0].position.x >= W - 1e-7);
  }
  let random = 12345;
  const nextRandom = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
  pair = [body(1, 100), body(2, 150)];
  for (let i = 0; i < 3000; i++) {
    const decisions = Object.fromEntries(pair.map(a => [a.id, { moveLeft: nextRandom(), moveRight: nextRandom(), jump: nextRandom() > 0.7 ? 1 : 0 }]));
    pair = frame(pair, decisions).next;
    const ox = W - Math.abs(pair[0].position.x - pair[1].position.x);
    const oy = H - Math.abs(pair[0].position.y - pair[1].position.y);
    assert(ox <= 1e-6 || oy <= 1e-6, `Runner penetration at random frame ${i}`);
    assert(pair.every(a => a.position.y + H <= 500 + 1e-6), 'Contacts must not shove bodies through the floor');
  }
  const group = [body(1, 200), body(2, 400), { ...body(3, 0), status: AgentStatus.It }];
  assert.equal(measureGroupCohesion(group).runnerCost, 0, 'Comfort band has no incentive to touch');
  group[1].position.x = 1500;
  assert.equal(measureGroupCohesion(group).runnerCost, 1);
  assert.equal(measureGroupCohesion(group).chaserCost, 1);
  assert(GROUP_COHESION.penaltyCap < 20, 'Cohesion stays below a competitive event');
  console.log('Body/cohesion checks passed: stacks, jump block, Chaser pass-through, swept contacts, order, parity, 600-frame obstruction, 3000 random frames');
}
