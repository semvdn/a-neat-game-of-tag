import type { TerrainRuntimeConfig, TerrainVarietyConfig } from '../types';
import { trainingBiomeWorldOffset } from '../world/biomes';

export const DEFAULT_TERRAIN_VARIETY_CONFIG: TerrainVarietyConfig = {
  trainingBranchingEnabled: true,
  trainingBranchingEpisodePercent: 65,
  trainingMovingPlatformsEnabled: true,
  trainingMovingEpisodePercent: 35,
  continuousBranchingEnabled: true,
  continuousBranchSpawnPercent: 28,
  continuousMovingPlatformsEnabled: true,
  continuousMovingSpawnPercent: 18,
  movingPlatformMaxSpeed: 85,
  maxPlatformsPerBranch: 4,
  subBranchingEnabled: true,
  maxBranchDepth: 2,
  movingPlatformsInBranches: true,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function sanitizeTerrainVarietyConfig(value?: Partial<TerrainVarietyConfig> | null): TerrainVarietyConfig {
  const v = value || {};
  const d = DEFAULT_TERRAIN_VARIETY_CONFIG;
  return {
    trainingBranchingEnabled: typeof v.trainingBranchingEnabled === 'boolean' ? v.trainingBranchingEnabled : d.trainingBranchingEnabled,
    trainingBranchingEpisodePercent: clamp(finite(v.trainingBranchingEpisodePercent, d.trainingBranchingEpisodePercent), 0, 100),
    trainingMovingPlatformsEnabled: typeof v.trainingMovingPlatformsEnabled === 'boolean' ? v.trainingMovingPlatformsEnabled : d.trainingMovingPlatformsEnabled,
    trainingMovingEpisodePercent: clamp(finite(v.trainingMovingEpisodePercent, d.trainingMovingEpisodePercent), 0, 100),
    continuousBranchingEnabled: typeof v.continuousBranchingEnabled === 'boolean' ? v.continuousBranchingEnabled : d.continuousBranchingEnabled,
    continuousBranchSpawnPercent: clamp(finite(v.continuousBranchSpawnPercent, d.continuousBranchSpawnPercent), 0, 100),
    continuousMovingPlatformsEnabled: typeof v.continuousMovingPlatformsEnabled === 'boolean' ? v.continuousMovingPlatformsEnabled : d.continuousMovingPlatformsEnabled,
    continuousMovingSpawnPercent: clamp(finite(v.continuousMovingSpawnPercent, d.continuousMovingSpawnPercent), 0, 100),
    movingPlatformMaxSpeed: clamp(finite(v.movingPlatformMaxSpeed, d.movingPlatformMaxSpeed), 0, 180),
    maxPlatformsPerBranch: Math.round(clamp(finite(v.maxPlatformsPerBranch, d.maxPlatformsPerBranch), 1, 6)),
    subBranchingEnabled: typeof v.subBranchingEnabled === 'boolean' ? v.subBranchingEnabled : d.subBranchingEnabled,
    maxBranchDepth: Math.round(clamp(finite(v.maxBranchDepth, d.maxBranchDepth), 1, 4)),
    movingPlatformsInBranches: typeof v.movingPlatformsInBranches === 'boolean' ? v.movingPlatformsInBranches : d.movingPlatformsInBranches,
  };
}

function percentRoll(seed: number, salt: number): number {
  let x = (seed ^ salt) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296 * 100;
}

export function trainingTerrainRuntime(config: TerrainVarietyConfig, seed: number): TerrainRuntimeConfig {
  const c = sanitizeTerrainVarietyConfig(config);
  return {
    branchingEnabled: c.trainingBranchingEnabled && percentRoll(seed, 0x51f15e3d) < c.trainingBranchingEpisodePercent,
    // Included branch episodes should expose route choice reliably; the episode percentage is the
    // user's primary training-frequency control.
    branchSpawnChance: 0.32,
    guaranteeBranchExposure: true,
    movingPlatformsEnabled: c.trainingMovingPlatformsEnabled && percentRoll(seed, 0x2c1b3c6d) < c.trainingMovingEpisodePercent,
    movingSpawnChance: 0.22,
    guaranteeMovingExposure: true,
    movingPlatformMaxSpeed: c.movingPlatformMaxSpeed,
    maxPlatformsPerBranch: c.maxPlatformsPerBranch,
    subBranchingEnabled: c.subBranchingEnabled,
    maxBranchDepth: c.maxBranchDepth,
    movingPlatformsInBranches: c.movingPlatformsInBranches,
    biomeWorldOffsetX: trainingBiomeWorldOffset(seed),
  };
}

export function continuousTerrainRuntime(config: TerrainVarietyConfig): TerrainRuntimeConfig {
  const c = sanitizeTerrainVarietyConfig(config);
  return {
    branchingEnabled: c.continuousBranchingEnabled,
    branchSpawnChance: c.continuousBranchSpawnPercent / 100,
    guaranteeBranchExposure: false,
    movingPlatformsEnabled: c.continuousMovingPlatformsEnabled,
    movingSpawnChance: c.continuousMovingSpawnPercent / 100,
    guaranteeMovingExposure: false,
    movingPlatformMaxSpeed: c.movingPlatformMaxSpeed,
    maxPlatformsPerBranch: c.maxPlatformsPerBranch,
    subBranchingEnabled: c.subBranchingEnabled,
    maxBranchDepth: c.maxBranchDepth,
    movingPlatformsInBranches: c.movingPlatformsInBranches,
    biomeWorldOffsetX: 0,
  };
}
