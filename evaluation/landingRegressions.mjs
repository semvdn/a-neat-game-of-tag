import assert from 'node:assert/strict';
import { stepAgentPhysics, stepAgentPhysicsInPlace, stepMovingPlatformsInPlace } from '../learning/simulationCore.ts';
import { AGENT_HEIGHT, FALL_BOUNDARY, MAX_ENERGY } from '../constants.ts';
import { AgentStatus } from '../types.ts';

export function verifyLandings() {
  const upgrades = { sprint: false, controlledJump: false, sprintChaserMaxSpeed: 7.5, sprintRunnerMaxSpeed: 7.5 };
  const platform = (id, y, x = 100, width = 100) => ({ id, position: { x, y }, width, height: 20 });
  const body = (x, bottom, vy) => ({
    id: 1, position: { x, y: bottom - AGENT_HEIGHT }, velocity: { x: 5, y: vy }, acceleration: { x: 0, y: 0 },
    status: AgentStatus.Normal, role: 'evader', energy: MAX_ENERGY, maxEnergy: MAX_ENERGY,
    isOnGround: false, lastPlatformId: 1, activeRoutePath: null, cooldownTimer: 0,
    positionAtLastTakeoff: { x: 0, y: 200 }, energyAtLastTakeoff: MAX_ENERGY, trajectory: [], scale: { x: 1, y: 1 },
  });
  const step = (input, platforms) => {
    const mutable = structuredClone(input);
    const args = [[structuredClone(input)], platforms, 0, { width: 1200, height: 800 }, 16.67, { moveRight: input.velocity.x >= 0 ? 1 : 0, moveLeft: input.velocity.x < 0 ? 1 : 0, jump: 0 }, upgrades];
    const visual = stepAgentPhysics(input, ...args);
    stepAgentPhysicsInPlace(mutable, ...args);
    assert.deepEqual(mutable, visual.agent, 'Visible and training landing results must match');
    return mutable;
  };
  const edge = step(body(199, 398, 20), [platform(2, 400)]);
  assert.equal(edge.lastPlatformId, 2, 'Catch the platform crossed before leaving its edge');
  assert.equal(edge.position.y + AGENT_HEIGHT, 400);
  const afterEdge = step(edge, [platform(2, 400)]);
  assert.equal(afterEdge.isOnGround, false, 'A grazing landing must not trap the body on the edge next frame');
  assert(afterEdge.position.x > edge.position.x, 'Walking off an edge preserves forward movement');
  const left = body(61, 398, 20);
  left.velocity.x = -5;
  assert.equal(step(left, [platform(2, 400)]).lastPlatformId, 2, 'Catch a leftward edge crossing too');
  const resting = body(140, 400, 0);
  resting.isOnGround = true;
  resting.lastPlatformId = 2;
  assert.equal(step(resting, [platform(2, 400)]).position.x, 145, 'Sweeping must not stop ordinary grounded movement');
  for (const platforms of [[platform(3, 420), platform(2, 400)], [platform(2, 400), platform(3, 420)]]) {
    assert.equal(step(body(140, 390, 40), platforms).lastPlatformId, 2, 'Earliest surface wins regardless of array order');
  }
  const locked = body(140, 398, 20);
  locked.activeRoutePath = 'g1U';
  const sibling = step(locked, [{ ...platform(2, 400), routePath: 'g1L/g2U' }]);
  assert.equal(sibling.isOnGround, true, 'Every surface catches a descending body, including nested sibling routes');
  assert.equal(sibling.activeRoutePath, 'g1L/g2U');
  const moving = platform(2, 410);
  moving.motion = { axis: 'y', min: 300, max: 450, speed: 1200, direction: -1 };
  stepMovingPlatformsInPlace([moving], [], 16.67);
  assert.equal(step(body(140, 400, 1), [moving]).isOnGround, true, 'A rising surface cannot tunnel through descending feet');

  // A fall can legitimately respawn onto the last grounded moving platform. Once respawned, the
  // body must remain attached through both upward/downward travel and motion reversals instead of
  // being treated as a fresh swept landing every frame. This is the regression for the visual bug
  // where bodies could fall through vertically oscillating checkpoints immediately after respawn.
  for (const initialDirection of [-1, 1]) {
    const respawnPlatform = platform(12, 360, 100, 180);
    respawnPlatform.motion = { axis: 'y', min: 250, max: 430, speed: 180, direction: initialDirection };
    let rider = body(140, FALL_BOUNDARY + AGENT_HEIGHT + 50, 10);
    rider.lastPlatformId = respawnPlatform.id;
    rider.positionAtLastTakeoff = { x: 140, y: respawnPlatform.position.y - AGENT_HEIGHT };
    rider = step(rider, [respawnPlatform]);
    assert.equal(rider.isOnGround, true, 'Fall recovery must mark the respawned body grounded');
    assert.equal(rider.lastPlatformId, respawnPlatform.id, 'Fall recovery must preserve the selected moving checkpoint');
    assert.equal(rider.position.y + AGENT_HEIGHT, respawnPlatform.position.y, 'Respawn feet must start on the current moving-platform top');

    // Emulate the tiny fractional correction/rounding offset that exposed the original one-way
    // collision seam. The moving-platform carry step must re-establish exact floor contact.
    rider.position.y += 0.25;

    for (let frame = 0; frame < 180; frame++) {
      stepMovingPlatformsInPlace([respawnPlatform], [rider], 16.67);
      rider = step(rider, [respawnPlatform]);
      assert.equal(rider.isOnGround, true, `Respawned rider detached from vertical platform at frame ${frame}`);
      assert(Math.abs((rider.position.y + AGENT_HEIGHT) - respawnPlatform.position.y) <= 1e-6,
        `Respawned rider/platform gap opened at frame ${frame}`);
    }
  }
  const unseen = platform(9, 400, 10000);
  assert.equal(step(body(10040, 398, 20), [unseen]).lastPlatformId, 9, 'Landing is independent of viewport and policy platform slots');
  assert.equal(step(body(140, 405, -10), [platform(2, 400)]).isOnGround, false, 'Rising through a one-way platform stays allowed');
  assert.equal(step(body(90, 415, 20), [platform(2, 400)]).isOnGround, false, 'Do not snap onto a top already passed');
  assert.equal(step(body(56, 398, 20), [platform(2, 400)]).isOnGround, false, 'Arriving horizontally after crossing the top is a side miss');
  for (let speed = 1; speed <= 80; speed++) {
    for (let phase = 1; phase <= 9; phase++) {
      const result = step(body(140, 400 - (speed + 0.5) * phase / 10, speed), [platform(2, 400)]);
      assert.equal(result.lastPlatformId, 2, `Missed downward crossing at speed ${speed}, phase ${phase}`);
      assert.equal(result.position.y + AGENT_HEIGHT, 400);
    }
  }
  console.log('Landing regressions passed: edge crossing, first surface, routes, moving-platform respawn support, upward pass-through, 720 descent cases, visual/training parity');
}
