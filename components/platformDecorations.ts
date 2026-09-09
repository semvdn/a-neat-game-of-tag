import type { BiomeId, PlatformState } from '../types';
import type { BiomePalette } from '../world/biomes';
import { biomeHash, mixHex } from '../world/biomes';
import type { WorldLightingState } from '../world/dayNight';

interface DecorationStyle {
  density: number;
  spacing: number;
  maxCount: number;
}

const STYLE: Record<BiomeId, DecorationStyle> = {
  lowlands: { density: 0.86, spacing: 78, maxCount: 4 },
  desert: { density: 0.44, spacing: 112, maxCount: 3 },
  'snowy-mountains': { density: 0.38, spacing: 112, maxCount: 3 },
  'temperate-forest': { density: 0.96, spacing: 72, maxCount: 4 },
  city: { density: 0.58, spacing: 98, maxCount: 3 },
  'rural-village': { density: 0.78, spacing: 82, maxCount: 4 },
  swamp: { density: 1.0, spacing: 68, maxCount: 4 },
  foundry: { density: 0.52, spacing: 94, maxCount: 3 },
  spires: { density: 0.32, spacing: 118, maxCount: 2 },
  ruins: { density: 0.62, spacing: 92, maxCount: 3 },
};

const snap = (value: number, grid = 1) => Math.round(value / grid) * grid;
const rand01 = (platform: PlatformState, salt: number, index = 0) =>
  biomeHash((platform.id | 0) ^ Math.imul(index + 1, 0x9e3779b1), salt, platform.visualBiome?.regionIndex ?? 0) / 4294967296;

function grassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.detail, palette.platformTop, 0.25);
  ctx.fillStyle = c;
  ctx.fillRect(x, y - 5, 2, 5);
  ctx.fillRect(x + 3, y - 7 - (variant % 2), 2, 7 + (variant % 2));
  ctx.fillRect(x + 6, y - 4, 2, 4);
  if (variant % 3 === 0) ctx.fillRect(x + 9, y - 6, 2, 6);
}

function shrub(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const dark = mixHex(palette.near, palette.platformShadow, 0.2);
  const light = mixHex(palette.detail, palette.near, 0.38);
  ctx.fillStyle = dark;
  ctx.fillRect(x + 4, y - 9, 3, 9);
  ctx.fillRect(x, y - 7, 12, 6);
  ctx.fillRect(x + 3, y - 11 - (variant % 2), 8, 6 + (variant % 2));
  ctx.fillStyle = light;
  ctx.fillRect(x + 2, y - 7, 3, 2);
  ctx.fillRect(x + 7, y - 10, 3, 2);
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  ctx.fillStyle = mixHex(palette.detail, palette.platformTop, 0.15);
  ctx.fillRect(x + 2, y - 8, 2, 8);
  ctx.fillStyle = variant % 2 === 0 ? '#e8c95a' : '#d9a7b6';
  ctx.fillRect(x, y - 10, 2, 2);
  ctx.fillRect(x + 4, y - 10, 2, 2);
  ctx.fillRect(x + 2, y - 12, 2, 2);
}

function tumbleweed(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.detail, palette.platformShadow, 0.18);
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  const r = 7 + (variant % 2);
  ctx.strokeRect(x, y - r * 2, r * 2, r * 2);
  ctx.beginPath();
  ctx.moveTo(x + 2, y - r * 1.7);
  ctx.lineTo(x + r * 1.6, y - 2);
  ctx.moveTo(x + r * 1.5, y - r * 1.75);
  ctx.lineTo(x + 3, y - 3);
  ctx.moveTo(x + r, y - r * 2);
  ctx.lineTo(x + r, y);
  ctx.stroke();
}

function cactus(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.near, palette.detail, 0.25);
  ctx.fillStyle = c;
  const h = 15 + (variant % 3) * 2;
  ctx.fillRect(x + 5, y - h, 4, h);
  ctx.fillRect(x + 1, y - h + 7, 5, 3);
  ctx.fillRect(x + 1, y - h + 3, 3, 7);
  if (variant % 2 === 0) {
    ctx.fillRect(x + 8, y - h + 10, 5, 3);
    ctx.fillRect(x + 11, y - h + 5, 3, 8);
  }
}

function dryGrass(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette) {
  ctx.fillStyle = mixHex(palette.detail, palette.platformFace, 0.18);
  ctx.fillRect(x + 1, y - 5, 2, 5);
  ctx.fillRect(x + 4, y - 8, 2, 8);
  ctx.fillRect(x + 7, y - 4, 2, 4);
}

function snowRock(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  ctx.fillStyle = mixHex(palette.platformFace, palette.platformShadow, 0.22);
  ctx.fillRect(x + 1, y - 6, 12 + (variant % 2) * 3, 6);
  ctx.fillRect(x + 4, y - 9, 7 + (variant % 2) * 2, 4);
  ctx.fillStyle = mixHex(palette.platformTop, '#f7fbff', 0.68);
  ctx.fillRect(x + 3, y - 10, 8 + (variant % 2) * 2, 3);
}

function pineSapling(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.near, palette.platformShadow, 0.05);
  ctx.fillStyle = c;
  const h = 17 + (variant % 2) * 3;
  ctx.fillRect(x + 6, y - 6, 2, 6);
  for (let i = 0; i < 3; i++) {
    const width = 13 - i * 3;
    ctx.fillRect(x + 1 + i * 1.5, y - h + i * 5, width, 4);
  }
}

function fern(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.detail, palette.near, 0.24);
  ctx.fillStyle = c;
  ctx.fillRect(x + 6, y - 9, 2, 9);
  for (let i = 0; i < 3; i++) {
    const yy = y - 8 + i * 3;
    ctx.fillRect(x + 1 + i, yy, 6, 2);
    ctx.fillRect(x + 8, yy - (variant % 2), 6 - i, 2);
  }
}

function mushroom(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  ctx.fillStyle = mixHex(palette.platformTop, '#d9cfb7', 0.5);
  ctx.fillRect(x + 4, y - 5, 2, 5);
  ctx.fillStyle = variant % 2 === 0 ? '#b95f55' : mixHex(palette.detail, '#aa7565', 0.35);
  ctx.fillRect(x + 1, y - 8, 8, 4);
  ctx.fillRect(x + 3, y - 10, 4, 2);
}

function streetLamp(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, lighting?: WorldLightingState) {
  const metal = mixHex(palette.platformShadow, '#20252b', 0.32);
  ctx.fillStyle = metal;
  ctx.fillRect(x + 5, y - 29, 3, 29);
  ctx.fillRect(x + 3, y - 30, 10, 3);
  ctx.fillRect(x + 10, y - 29, 3, 5);
  const night = lighting?.night ?? 0;
  const twilight = lighting?.twilight ?? 0;
  if (night + twilight * 0.5 > 0.12) {
    ctx.save();
    ctx.globalAlpha *= Math.min(0.56, night * 0.52 + twilight * 0.2);
    ctx.fillStyle = '#ffd875';
    ctx.fillRect(x + 7, y - 28, 10, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffe7a4';
    ctx.fillRect(x + 10, y - 27, 4, 4);
    ctx.restore();
  } else {
    ctx.fillStyle = mixHex(palette.detail, '#d7bd76', 0.35);
    ctx.fillRect(x + 10, y - 27, 4, 4);
  }
}

function garbageBin(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.platformShadow, palette.near, 0.28);
  ctx.fillStyle = c;
  ctx.fillRect(x + 1, y - 13, 12, 13);
  ctx.fillRect(x, y - 15, 14, 3);
  ctx.fillStyle = mixHex(c, palette.detail, 0.18);
  ctx.fillRect(x + 4, y - 10, 2, 7);
  if (variant % 2 === 0) ctx.fillRect(x + 8, y - 10, 2, 7);
}

function bollard(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette) {
  ctx.fillStyle = mixHex(palette.platformShadow, '#252b31', 0.22);
  ctx.fillRect(x + 2, y - 11, 5, 11);
  ctx.fillStyle = palette.motionAccent;
  ctx.fillRect(x + 2, y - 8, 5, 2);
}

function fencePost(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette) {
  const c = mixHex(palette.platformFace, palette.platformShadow, 0.22);
  ctx.fillStyle = c;
  ctx.fillRect(x + 2, y - 14, 4, 14);
  ctx.fillRect(x + 16, y - 12, 4, 12);
  ctx.fillRect(x + 4, y - 10, 14, 3);
  ctx.fillRect(x + 4, y - 5, 14, 3);
}

function hayTuft(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.detail, '#cda95c', 0.4);
  ctx.fillStyle = c;
  ctx.fillRect(x + 1, y - 6, 15, 6);
  ctx.fillRect(x + 4, y - 9, 9, 4);
  if (variant % 2 === 0) ctx.fillRect(x + 7, y - 11, 4, 3);
}

function reeds(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.detail, palette.near, 0.18);
  ctx.fillStyle = c;
  for (let i = 0; i < 4; i++) {
    const h = 10 + ((i + variant) % 3) * 3;
    ctx.fillRect(x + i * 4, y - h, 2, h);
    if ((i + variant) % 2 === 0) {
      ctx.fillStyle = mixHex(palette.detail, '#82684a', 0.32);
      ctx.fillRect(x + i * 4 - 1, y - h - 3, 4, 4);
      ctx.fillStyle = c;
    }
  }
}

function swampStump(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const wood = mixHex(palette.platformFace, palette.platformShadow, 0.22);
  ctx.fillStyle = wood;
  ctx.fillRect(x + 3, y - 11, 8, 11);
  ctx.fillRect(x + 1, y - 12, 13, 4);
  if (variant % 2 === 0) ctx.fillRect(x + 9, y - 16, 3, 6);
  ctx.fillStyle = mixHex(palette.detail, palette.near, 0.28);
  ctx.fillRect(x + 2, y - 13, 7, 2);
}

function pipeVent(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.platformFace, palette.platformShadow, 0.22);
  ctx.fillStyle = c;
  ctx.fillRect(x + 4, y - 15, 5, 15);
  ctx.fillRect(x + 4, y - 18, 13, 5);
  ctx.fillRect(x + 14, y - 18, 4, 8);
  if (variant % 2 === 0) {
    ctx.fillStyle = mixHex(palette.detail, '#c46f46', 0.16);
    ctx.fillRect(x + 7, y - 9, 3, 3);
  }
}

function metalCrate(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette) {
  const c = mixHex(palette.platformFace, palette.platformShadow, 0.16);
  ctx.fillStyle = c;
  ctx.fillRect(x, y - 13, 15, 13);
  ctx.fillStyle = mixHex(c, palette.detail, 0.28);
  ctx.fillRect(x + 2, y - 11, 11, 2);
  ctx.fillRect(x + 2, y - 4, 11, 2);
  ctx.fillRect(x + 6, y - 11, 2, 9);
}

function stoneMarker(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.platformFace, palette.detail, 0.13);
  ctx.fillStyle = c;
  ctx.fillRect(x + 3, y - 16 - (variant % 2) * 3, 9, 16 + (variant % 2) * 3);
  ctx.fillRect(x + 1, y - 17 - (variant % 2) * 3, 13, 4);
  ctx.fillStyle = mixHex(c, palette.platformShadow, 0.24);
  ctx.fillRect(x + 6, y - 12, 3, 6);
}

function brokenStone(ctx: CanvasRenderingContext2D, x: number, y: number, palette: BiomePalette, variant: number) {
  const c = mixHex(palette.platformFace, palette.detail, 0.12);
  ctx.fillStyle = c;
  ctx.fillRect(x + 1, y - 7, 15, 7);
  ctx.fillRect(x + 5, y - 12 - (variant % 2) * 2, 8, 6 + (variant % 2) * 2);
  ctx.fillStyle = mixHex(c, palette.platformShadow, 0.22);
  ctx.fillRect(x + 8, y - 9, 2, 5);
}

function drawDecoration(
  ctx: CanvasRenderingContext2D,
  biome: BiomeId,
  platform: PlatformState,
  index: number,
  x: number,
  y: number,
  palette: BiomePalette,
  lighting?: WorldLightingState,
) {
  const variant = biomeHash(platform.id | 0, 0x44564352 ^ (index * 0x137), platform.visualBiome?.regionIndex ?? 0) % 7;
  const selector = rand01(platform, 0x4445434f, index);
  const signature = index === 0 && !platform.motion && platform.width >= 190 && rand01(platform, 0x5349474e, index) < 0.68;

  if (signature) {
    if (biome === 'lowlands') shrub(ctx, x, y, palette, variant);
    else if (biome === 'desert') cactus(ctx, x, y, palette, variant);
    else if (biome === 'snowy-mountains') pineSapling(ctx, x, y, palette, variant);
    else if (biome === 'temperate-forest') fern(ctx, x, y, palette, variant);
    else if (biome === 'city') streetLamp(ctx, x, y, palette, lighting);
    else if (biome === 'rural-village') fencePost(ctx, x, y, palette);
    else if (biome === 'swamp') reeds(ctx, x, y, palette, variant);
    else if (biome === 'foundry') pipeVent(ctx, x, y, palette, variant);
    else if (biome === 'spires') stoneMarker(ctx, x, y, palette, variant);
    else brokenStone(ctx, x, y, palette, variant);
    return;
  }

  if (biome === 'lowlands') {
    if (selector < 0.48) grassTuft(ctx, x, y, palette, variant);
    else if (selector < 0.82) shrub(ctx, x, y, palette, variant);
    else flower(ctx, x, y, palette, variant);
  } else if (biome === 'desert') {
    if (selector < 0.34) cactus(ctx, x, y, palette, variant);
    else if (selector < 0.64) tumbleweed(ctx, x, y, palette, variant);
    else dryGrass(ctx, x, y, palette);
  } else if (biome === 'snowy-mountains') {
    if (selector < 0.48) snowRock(ctx, x, y, palette, variant);
    else pineSapling(ctx, x, y, palette, variant);
  } else if (biome === 'temperate-forest') {
    if (selector < 0.46) fern(ctx, x, y, palette, variant);
    else if (selector < 0.78) shrub(ctx, x, y, palette, variant);
    else mushroom(ctx, x, y, palette, variant);
  } else if (biome === 'city') {
    if (selector < 0.34) streetLamp(ctx, x, y, palette, lighting);
    else if (selector < 0.72) garbageBin(ctx, x, y, palette, variant);
    else bollard(ctx, x, y, palette);
  } else if (biome === 'rural-village') {
    if (selector < 0.36) fencePost(ctx, x, y, palette);
    else if (selector < 0.68) hayTuft(ctx, x, y, palette, variant);
    else shrub(ctx, x, y, palette, variant);
  } else if (biome === 'swamp') {
    if (selector < 0.56) reeds(ctx, x, y, palette, variant);
    else if (selector < 0.78) swampStump(ctx, x, y, palette, variant);
    else shrub(ctx, x, y, palette, variant);
  } else if (biome === 'foundry') {
    if (selector < 0.58) pipeVent(ctx, x, y, palette, variant);
    else metalCrate(ctx, x, y, palette);
  } else if (biome === 'spires') {
    if (selector < 0.7) stoneMarker(ctx, x, y, palette, variant);
    else brokenStone(ctx, x, y, palette, variant);
  } else {
    if (selector < 0.52) brokenStone(ctx, x, y, palette, variant);
    else if (selector < 0.76) grassTuft(ctx, x, y, palette, variant);
    else shrub(ctx, x, y, palette, variant);
  }
}

/**
 * Draws deterministic, non-collidable biome dressing on a platform top.
 * Decorations never enter GameState and are therefore invisible to physics/policy sensing.
 */
export function drawPlatformDecorations(
  ctx: CanvasRenderingContext2D,
  platform: PlatformState,
  biome: BiomeId,
  palette: BiomePalette,
  lighting?: WorldLightingState,
) {
  const width = Math.max(0, platform.width);
  if (width < 72) return;

  const style = STYLE[biome];
  const margin = Math.min(28, Math.max(18, width * 0.09));
  const usable = width - margin * 2;
  if (usable < 30) return;

  const expected = Math.max(0, usable / style.spacing) * style.density;
  let count = Math.floor(expected);
  if (rand01(platform, 0x44434e54) < expected - count) count += 1;
  count = Math.max(0, Math.min(style.maxCount, count));
  if (platform.motion) count = Math.min(2, Math.ceil(count * 0.6));
  if (count === 0 && width > style.spacing * 1.12 && rand01(platform, 0x444d494e) < style.density * 0.72) count = 1;
  if (count === 0) return;

  const topY = Math.round(platform.position.y);
  const left = platform.position.x + margin;
  const slotWidth = usable / count;
  const minSeparation = 30;
  const placed: number[] = [];

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < count; i++) {
    const slotCenter = left + slotWidth * (i + 0.5);
    const jitter = (rand01(platform, 0x44504f53, i) - 0.5) * Math.min(slotWidth * 0.5, 24);
    let px = slotCenter + jitter;

    // Keep props comfortably away from platform ends and from each other. This is visual spacing
    // only—the collision body remains the original platform rectangle.
    px = Math.max(platform.position.x + margin, Math.min(platform.position.x + width - margin - 18, px));
    if (placed.some(prev => Math.abs(prev - px) < minSeparation)) continue;
    placed.push(px);

    drawDecoration(ctx, biome, platform, i, snap(px), topY, palette, lighting);
  }

  ctx.restore();
}
