import type { PlatformState, Vector2D } from '../types';
import { NUM_LIDAR_RAYS, LIDAR_MAX_DISTANCE } from '../constants';

export interface LidarRay {
  angle: number; // in radians
  direction: Vector2D;
  distance: number; // in world pixels (0 to maxDistance)
  normalizedDistance: number; // 0 to 1 (0 = immediately adjacent, 1 = open air / no collision)
  hitPoint: Vector2D | null;
  maxDistance: number;
}

/**
 * Axis-Aligned Bounding Box ray intersection using slab method.
 * Returns intersection distance t >= 0, or null if no hit.
 */
function rayBoxIntersection(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  maxDist: number
): number | null {
  const minX = rx;
  const maxX = rx + rw;
  const minY = ry;
  const maxY = ry + rh;

  let tMin = 0;
  let tMax = maxDist;

  // X slab
  if (Math.abs(dx) < 1e-7) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const t1 = (minX - ox) / dx;
    const t2 = (maxX - ox) / dx;
    const near = Math.min(t1, t2);
    const far = Math.max(t1, t2);
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-7) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const t1 = (minY - oy) / dy;
    const t2 = (maxY - oy) / dy;
    const near = Math.min(t1, t2);
    const far = Math.max(t1, t2);
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }

  if (tMin <= maxDist && tMin >= 0) {
    return tMin;
  }
  return null;
}

/**
 * Casts multi-directional spatial perception rays around the agent.
 * Rays are cast at regular intervals:
 * 0: Right (0°)
 * 1: Down-Right (45°)
 * 2: Down (90°) - essential for ledge and pit awareness
 * 3: Down-Left (135°)
 * 4: Left (180°)
 * 5: Up-Left (225°)
 * 6: Up (270°)
 * 7: Up-Right (315°)
 */
export function computeLidarRays(
  origin: Vector2D,
  platforms: PlatformState[],
  numRays: number = NUM_LIDAR_RAYS,
  maxDistance: number = LIDAR_MAX_DISTANCE,
  cameraBounds?: { minX: number; maxX: number }
): LidarRay[] {
  const rays: LidarRay[] = [];
  const angleStep = (Math.PI * 2) / numRays;

  // Filter platforms to only those within broad-phase bounding circle
  const maxSearchRadius = maxDistance + 400;
  const nearbyPlatforms = platforms.filter(p => {
    const pCenterX = p.position.x + p.width / 2;
    const pCenterY = p.position.y + p.height / 2;
    const dx = pCenterX - origin.x;
    const dy = pCenterY - origin.y;
    return dx * dx + dy * dy <= maxSearchRadius * maxSearchRadius;
  });

  for (let i = 0; i < numRays; i++) {
    const angle = i * angleStep;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let closestDistance = maxDistance;
    let hitFound = false;

    // Check camera frame left and right boundaries
    if (cameraBounds) {
      if (dx < -1e-5) {
        const distLeft = (cameraBounds.minX - origin.x) / dx;
        if (distLeft >= 0 && distLeft < closestDistance) {
          closestDistance = distLeft;
          hitFound = true;
        }
      } else if (dx > 1e-5) {
        const distRight = (cameraBounds.maxX - origin.x) / dx;
        if (distRight >= 0 && distRight < closestDistance) {
          closestDistance = distRight;
          hitFound = true;
        }
      }
    }

    for (let j = 0; j < nearbyPlatforms.length; j++) {
      const p = nearbyPlatforms[j];
      const dist = rayBoxIntersection(
        origin.x,
        origin.y,
        dx,
        dy,
        p.position.x,
        p.position.y,
        p.width,
        p.height,
        closestDistance
      );

      if (dist !== null && dist < closestDistance) {
        closestDistance = dist;
        hitFound = true;
      }
    }

    const hitPoint = hitFound
      ? {
          x: origin.x + dx * closestDistance,
          y: origin.y + dy * closestDistance,
        }
      : null;

    rays.push({
      angle,
      direction: { x: dx, y: dy },
      distance: closestDistance,
      normalizedDistance: closestDistance / maxDistance,
      hitPoint,
      maxDistance,
    });
  }

  return rays;
}

export function getLidarDistances(rays: LidarRay[]): number[] {
  return rays.map(r => r.normalizedDistance);
}
