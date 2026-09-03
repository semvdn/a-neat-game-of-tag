import type { PlatformState, Vector2D } from '../types';

export interface PlatformDynamicsStep {
  platforms: PlatformState[];
  deltas: Map<number, Vector2D>;
}

export function isPlatformSolid(platform: PlatformState): boolean {
  return platform.active !== false && platform.crumblePhase !== 'gone';
}

function movingPosition(platform: PlatformState, gameTimeMs: number): Vector2D {
  const base = platform.basePosition ?? platform.position;
  if (platform.kind !== 'moving' || !platform.motion) return { ...base };
  const oscillation = Math.sin((gameTimeMs / 1000) * platform.motion.speed * Math.PI * 2 + platform.motion.phase);
  return platform.motion.axis === 'x'
    ? { x: base.x + oscillation * platform.motion.amplitude, y: base.y }
    : { x: base.x, y: base.y + oscillation * platform.motion.amplitude };
}

export function updateDynamicPlatforms(
  platforms: PlatformState[],
  gameTimeMs: number,
): PlatformDynamicsStep {
  const deltas = new Map<number, Vector2D>();
  const updated = platforms.map(platform => {
    let triggeredAt = platform.crumble?.triggeredAt;
    let crumblePhase = platform.crumblePhase ?? 'stable';
    let active = platform.active !== false;

    if (platform.kind === 'crumbling' && platform.crumble && triggeredAt !== undefined) {
      const elapsed = gameTimeMs - triggeredAt;
      if (elapsed < platform.crumble.disappearDelayMs) {
        crumblePhase = 'warning';
        active = true;
      } else if (elapsed < platform.crumble.disappearDelayMs + platform.crumble.respawnDelayMs) {
        crumblePhase = 'gone';
        active = false;
      } else {
        // Respawned platforms can be triggered again later in the same episode.
        triggeredAt = undefined;
        crumblePhase = 'stable';
        active = true;
      }
    }

    const nextPosition = movingPosition(platform, gameTimeMs);
    deltas.set(platform.id, {
      x: nextPosition.x - platform.position.x,
      y: nextPosition.y - platform.position.y,
    });

    return {
      ...platform,
      position: nextPosition,
      active,
      crumblePhase,
      crumble: platform.crumble
        ? { ...platform.crumble, triggeredAt }
        : undefined,
    };
  });

  return { platforms: updated, deltas };
}

export function triggerCrumblingPlatform(platform: PlatformState, gameTimeMs: number): PlatformState {
  if (platform.kind !== 'crumbling' || !platform.crumble || !isPlatformSolid(platform)) return platform;
  if (platform.crumble.triggeredAt !== undefined) return platform;
  return {
    ...platform,
    crumblePhase: 'warning',
    crumble: { ...platform.crumble, triggeredAt: gameTimeMs },
  };
}
