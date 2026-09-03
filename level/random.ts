export type RandomSource = () => number;

export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(rng: RandomSource, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function randomInt(rng: RandomSource, min: number, maxInclusive: number): number {
  return Math.floor(randomRange(rng, min, maxInclusive + 1));
}

export function choose<T>(rng: RandomSource, values: readonly T[]): T {
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}
