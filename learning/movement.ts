import {
  AGENT_ACCELERATION,
  MAX_SPEED,
  JUMP_STRENGTH,
  MAX_ENERGY,
  FATIGUE_THRESHOLD,
  FATIGUED_ACCELERATION_FACTOR,
  FATIGUED_JUMP_FACTOR,
  FATIGUED_SPEED_FACTOR,
  CRUISE_SPEED_RATIO,
  MOVE_ENERGY_COST_PER_SEC,
  SPRINT_ENERGY_COST_PER_SEC,
  STATIONARY_ENERGY_RECOVERY_PER_SEC,
  WALK_ENERGY_RECOVERY_PER_SEC,
  JUMP_MIN_ENERGY_COST,
  JUMP_EXTRA_ENERGY_COST,
  JUMP_MIN_POWER_RATIO,
  JUMP_CONTROL_THRESHOLD,
  CHASER_ENERGY_CAPACITY_MULTIPLIER,
  CHASER_RECOVERY_MULTIPLIER,
  CHASER_SPEED_MULTIPLIER,
  CHASER_ACCELERATION_MULTIPLIER,
  CHASER_JUMP_MULTIPLIER,
  EVADER_ENERGY_CAPACITY_MULTIPLIER,
  EVADER_RECOVERY_MULTIPLIER,
  EVADER_SPEED_MULTIPLIER,
  EVADER_ACCELERATION_MULTIPLIER,
  EVADER_JUMP_MULTIPLIER,
} from '../constants';
import type { AgentState } from '../types';
import type { AgentControls, FastAgentControls } from './agent';

export type MovementRole = 'chaser' | 'evader';

export interface PhysiologyProfile {
  energyCapacity: number;
  recoveryMultiplier: number;
  speedMultiplier: number;
  accelerationMultiplier: number;
  jumpMultiplier: number;
}

export interface LocomotionResult {
  velocity: { x: number; y: number };
  energy: number;
  accelerationX: number;
  jumped: boolean;
  jumpImpulse: number;
  fatigueFactor: number;
  effectiveMaxSpeed: number;
  movementCostPerSec: number;
  recoveryPerSec: number;
}

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const CHASER_PHYSIOLOGY: PhysiologyProfile = {
  energyCapacity: MAX_ENERGY * CHASER_ENERGY_CAPACITY_MULTIPLIER,
  recoveryMultiplier: CHASER_RECOVERY_MULTIPLIER,
  speedMultiplier: CHASER_SPEED_MULTIPLIER,
  accelerationMultiplier: CHASER_ACCELERATION_MULTIPLIER,
  jumpMultiplier: CHASER_JUMP_MULTIPLIER,
};

const EVADER_PHYSIOLOGY: PhysiologyProfile = {
  energyCapacity: MAX_ENERGY * EVADER_ENERGY_CAPACITY_MULTIPLIER,
  recoveryMultiplier: EVADER_RECOVERY_MULTIPLIER,
  speedMultiplier: EVADER_SPEED_MULTIPLIER,
  accelerationMultiplier: EVADER_ACCELERATION_MULTIPLIER,
  jumpMultiplier: EVADER_JUMP_MULTIPLIER,
};

export function getPhysiology(role: MovementRole): PhysiologyProfile {
  return role === 'chaser' ? CHASER_PHYSIOLOGY : EVADER_PHYSIOLOGY;
}

/**
 * Applies the role's energy capacity while preserving the agent's current percentage reserve.
 * This is useful when a visual-play tag swaps the chaser/evader roles.
 */
export function syncEnergyCapacity(agent: AgentState, role: MovementRole, preserveRatio = true): void {
  const profile = getPhysiology(role);
  const oldMax = Math.max(1e-6, agent.maxEnergy || MAX_ENERGY);
  const ratio = clamp(agent.energy / oldMax);
  agent.maxEnergy = profile.energyCapacity;
  agent.energy = preserveRatio ? ratio * profile.energyCapacity : Math.min(agent.energy, profile.energyCapacity);
}

/**
 * Converts continuous NEAT control signals into locomotion and stamina changes for one physics frame.
 * Horizontal effort and sprint cost are nonlinear, while recovery only happens on the ground and is
 * strongest when the agent is actually resting. Energy is deliberately not a fitness reward: it only
 * matters through the physical capabilities it enables.
 */
export function stepLocomotion(
  agent: AgentState,
  controls: AgentControls,
  deltaMs: number,
  role: MovementRole
): LocomotionResult {
  const profile = getPhysiology(role);
  const dt = Math.max(0, deltaMs) / 1000;
  const move = clamp(controls.move, -1, 1);
  const moveEffort = Math.abs(move);
  const sprint = clamp(controls.sprint);
  const requestedJump = clamp(controls.jump);

  // Capacity follows role. Preserve absolute reserve during ordinary frames, capped to the role maximum.
  const maxEnergy = profile.energyCapacity;
  const energyStart = Math.min(maxEnergy, Math.max(0, agent.energy));
  const energyRatio = clamp(energyStart / Math.max(1e-6, maxEnergy));

  // Full ability above the threshold. Below it, power falls smoothly rather than switching off.
  const fatigueFactor = energyRatio >= FATIGUE_THRESHOLD
    ? 1
    : clamp(energyRatio / Math.max(1e-6, FATIGUE_THRESHOLD));
  const accelFatigue = lerp(FATIGUED_ACCELERATION_FACTOR, 1, fatigueFactor);
  const jumpFatigue = lerp(FATIGUED_JUMP_FACTOR, 1, fatigueFactor);
  const speedFatigue = lerp(FATIGUED_SPEED_FACTOR, 1, fatigueFactor);

  // Sprint is a continuum between an efficient cruise and peak speed.
  const requestedSpeedRatio = lerp(CRUISE_SPEED_RATIO, 1, sprint);
  const effectiveMaxSpeed = MAX_SPEED * profile.speedMultiplier * requestedSpeedRatio * speedFatigue;
  const accelScale = lerp(0.78, 1, sprint);
  const accelerationX = AGENT_ACCELERATION * profile.accelerationMultiplier * accelFatigue * accelScale * move;

  const velocity = { ...agent.velocity };
  if (moveEffort < 0.05) velocity.x *= 0.9;
  velocity.x += accelerationX;
  velocity.x = clamp(velocity.x, -effectiveMaxSpeed, effectiveMaxSpeed);

  // Ordinary running is affordable; hard sprinting grows quadratically in cost.
  const movementCostPerSec =
    MOVE_ENERGY_COST_PER_SEC * moveEffort * moveEffort +
    SPRINT_ENERGY_COST_PER_SEC * Math.pow(moveEffort * sprint, 2);

  // Recovery requires ground contact. Resting is substantially better than moving slowly.
  let recoveryPerSec = 0;
  if (agent.isOnGround) {
    const speedRatio = Math.abs(velocity.x) / Math.max(0.01, MAX_SPEED * profile.speedMultiplier);
    if (moveEffort < 0.12 && speedRatio < 0.25) {
      recoveryPerSec = STATIONARY_ENERGY_RECOVERY_PER_SEC * profile.recoveryMultiplier;
    } else if (moveEffort < 0.6 && sprint < 0.25 && speedRatio < 0.75) {
      const walkingFactor = clamp(1 - moveEffort / 0.6, 0.2, 1);
      recoveryPerSec = WALK_ENERGY_RECOVERY_PER_SEC * profile.recoveryMultiplier * walkingFactor;
    }
  }

  let energy = clamp(energyStart + (recoveryPerSec - movementCostPerSec) * dt, 0, maxEnergy);
  let jumped = false;
  let jumpImpulse = 0;

  if (agent.isOnGround && requestedJump > JUMP_CONTROL_THRESHOLD && energy >= JUMP_MIN_ENERGY_COST) {
    const normalizedRequest = clamp(
      (requestedJump - JUMP_CONTROL_THRESHOLD) / Math.max(1e-6, 1 - JUMP_CONTROL_THRESHOLD)
    );

    // If reserve is low, perform the strongest jump the agent can still afford rather than hard-disabling jump.
    const affordablePower = clamp(
      Math.sqrt(Math.max(0, energy - JUMP_MIN_ENERGY_COST) / Math.max(1e-6, JUMP_EXTRA_ENERGY_COST))
    );
    const jumpPower = Math.min(normalizedRequest, affordablePower);
    const jumpCost = JUMP_MIN_ENERGY_COST + JUMP_EXTRA_ENERGY_COST * jumpPower * jumpPower;
    const powerRatio = lerp(JUMP_MIN_POWER_RATIO, 1, jumpPower);

    jumpImpulse = JUMP_STRENGTH * profile.jumpMultiplier * jumpFatigue * powerRatio;
    velocity.y = jumpImpulse;
    energy = Math.max(0, energy - jumpCost);
    jumped = true;
  }

  return {
    velocity,
    energy,
    accelerationX,
    jumped,
    jumpImpulse,
    fatigueFactor,
    effectiveMaxSpeed,
    movementCostPerSec,
    recoveryPerSec,
  };
}


/**
 * Training-only locomotion fast path. It preserves stepLocomotion() physics but mutates the
 * AgentState in place and avoids allocating a velocity object plus the rich diagnostics result.
 */
export function stepLocomotionFast(
  agent: AgentState,
  controls: FastAgentControls,
  deltaMs: number,
  role: MovementRole
): boolean {
  const profile = role === 'chaser' ? CHASER_PHYSIOLOGY : EVADER_PHYSIOLOGY;
  const dt = deltaMs > 0 ? deltaMs / 1000 : 0;
  const move = controls.move < -1 ? -1 : controls.move > 1 ? 1 : controls.move;
  const moveEffort = Math.abs(move);
  const sprint = controls.sprint < 0 ? 0 : controls.sprint > 1 ? 1 : controls.sprint;
  const requestedJump = controls.jump < 0 ? 0 : controls.jump > 1 ? 1 : controls.jump;

  const maxEnergy = profile.energyCapacity;
  const energyStart = agent.energy < 0 ? 0 : agent.energy > maxEnergy ? maxEnergy : agent.energy;
  const energyRatio = energyStart / Math.max(1e-6, maxEnergy);
  const fatigueFactor = energyRatio >= FATIGUE_THRESHOLD
    ? 1
    : Math.max(0, Math.min(1, energyRatio / Math.max(1e-6, FATIGUE_THRESHOLD)));
  const accelFatigue = FATIGUED_ACCELERATION_FACTOR + (1 - FATIGUED_ACCELERATION_FACTOR) * fatigueFactor;
  const jumpFatigue = FATIGUED_JUMP_FACTOR + (1 - FATIGUED_JUMP_FACTOR) * fatigueFactor;
  const speedFatigue = FATIGUED_SPEED_FACTOR + (1 - FATIGUED_SPEED_FACTOR) * fatigueFactor;
  const requestedSpeedRatio = CRUISE_SPEED_RATIO + (1 - CRUISE_SPEED_RATIO) * sprint;
  const effectiveMaxSpeed = MAX_SPEED * profile.speedMultiplier * requestedSpeedRatio * speedFatigue;
  const accelScale = 0.78 + 0.22 * sprint;
  const accelerationX = AGENT_ACCELERATION * profile.accelerationMultiplier * accelFatigue * accelScale * move;

  let vx = agent.velocity.x;
  let vy = agent.velocity.y;
  if (moveEffort < 0.05) vx *= 0.9;
  vx += accelerationX;
  if (vx < -effectiveMaxSpeed) vx = -effectiveMaxSpeed;
  else if (vx > effectiveMaxSpeed) vx = effectiveMaxSpeed;

  const movementCostPerSec =
    MOVE_ENERGY_COST_PER_SEC * moveEffort * moveEffort +
    SPRINT_ENERGY_COST_PER_SEC * (moveEffort * sprint) * (moveEffort * sprint);

  let recoveryPerSec = 0;
  if (agent.isOnGround) {
    const speedRatio = Math.abs(vx) / Math.max(0.01, MAX_SPEED * profile.speedMultiplier);
    if (moveEffort < 0.12 && speedRatio < 0.25) {
      recoveryPerSec = STATIONARY_ENERGY_RECOVERY_PER_SEC * profile.recoveryMultiplier;
    } else if (moveEffort < 0.6 && sprint < 0.25 && speedRatio < 0.75) {
      const walkingFactor = Math.max(0.2, Math.min(1, 1 - moveEffort / 0.6));
      recoveryPerSec = WALK_ENERGY_RECOVERY_PER_SEC * profile.recoveryMultiplier * walkingFactor;
    }
  }

  let energy = energyStart + (recoveryPerSec - movementCostPerSec) * dt;
  if (energy < 0) energy = 0;
  else if (energy > maxEnergy) energy = maxEnergy;
  let jumped = false;

  if (agent.isOnGround && requestedJump > JUMP_CONTROL_THRESHOLD && energy >= JUMP_MIN_ENERGY_COST) {
    const normalizedRequest = Math.max(0, Math.min(1,
      (requestedJump - JUMP_CONTROL_THRESHOLD) / Math.max(1e-6, 1 - JUMP_CONTROL_THRESHOLD)
    ));
    const affordablePower = Math.max(0, Math.min(1,
      Math.sqrt(Math.max(0, energy - JUMP_MIN_ENERGY_COST) / Math.max(1e-6, JUMP_EXTRA_ENERGY_COST))
    ));
    const jumpPower = Math.min(normalizedRequest, affordablePower);
    const jumpCost = JUMP_MIN_ENERGY_COST + JUMP_EXTRA_ENERGY_COST * jumpPower * jumpPower;
    const powerRatio = JUMP_MIN_POWER_RATIO + (1 - JUMP_MIN_POWER_RATIO) * jumpPower;
    vy = JUMP_STRENGTH * profile.jumpMultiplier * jumpFatigue * powerRatio;
    energy = Math.max(0, energy - jumpCost);
    jumped = true;
  }

  agent.velocity.x = vx;
  agent.velocity.y = vy;
  agent.acceleration.x = accelerationX;
  agent.maxEnergy = maxEnergy;
  agent.energy = energy;
  return jumped;
}
