import React, { useEffect, useRef, useState } from 'react';
import type { GameState, PlatformState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentSenses } from './drawing';
import { AGENT_WIDTH, WORLD_REF_WIDTH, WORLD_REF_HEIGHT, CAMERA_FRAME_PADDING_REFERENCE_PX, CAMERA_MIN_USEFUL_AUTO_ZOOM } from '../constants';
import { cameraRelevantAgents } from '../learning/cameraFraming';
import { biomeLabel, DEFAULT_BIOME_WORLD_SEED, getBiomeAtX } from '../world/biomes';
import { BiomeBackgroundCache, drawBiomeBackground, drawBiomeForeground } from './biomeBackground';
import type { DayNightConfig } from '../world/dayNight';
import { formatWorldHour, resolveWorldLighting } from '../world/dayNight';

interface GameCanvasProps {
  gameState: GameState;
  showTrails: boolean;
  showSenses: boolean;
  cameraZoom: number;
  dayNightConfig: DayNightConfig;
}

// The visual camera is deliberately separate from the 1200x800 policy/sensor frame.
// The presentation camera now prioritizes TERRAIN readability vertically: agents may briefly jump
// above the viewport, but the maximum useful number of local platforms should remain visible.
const CAMERA_VERTICAL_FOLLOW_RATE = 4.2;
const CAMERA_HORIZONTAL_FOLLOW_RATE = 6.0;
// Zooming out remains immediate; zooming back in is slower to avoid pulsing after route splits.
const CAMERA_ZOOM_IN_FOLLOW_RATE = 2.1;
const PLATFORM_VERTICAL_PADDING_REFERENCE_PX = 54;
const PLATFORM_HORIZONTAL_QUERY_MARGIN = 1.18;

interface PlatformVerticalFrame {
  centerY: number;
  minY: number;
  maxY: number;
  visibleCount: number;
  totalCount: number;
}

/** Platforms relevant to the horizontal action window. We intentionally do not use airborne agent Y. */
const platformsInHorizontalFrame = (
  platforms: PlatformState[],
  centerX: number,
  worldWidth: number,
): PlatformState[] => {
  const half = Math.max(WORLD_REF_WIDTH * 0.35, worldWidth * 0.5 * PLATFORM_HORIZONTAL_QUERY_MARGIN);
  const left = centerX - half;
  const right = centerX + half;
  const local = platforms.filter(platform =>
    Number.isFinite(platform.position.x) &&
    Number.isFinite(platform.position.y) &&
    platform.position.x + platform.width >= left &&
    platform.position.x <= right
  );
  return local.length > 0 ? local : platforms.filter(platform => Number.isFinite(platform.position.y));
};

/**
 * Choose the vertical camera center that contains the largest number of platform centers.
 * When every local platform fits, center the complete terrain band. When it does not, a sliding
 * window finds the densest vertical band instead of following an agent's jump arc.
 */
const bestPlatformVerticalFrame = (
  platforms: PlatformState[],
  visibleWorldHeight: number,
  worldPadding: number,
  fallbackY: number,
): PlatformVerticalFrame => {
  if (platforms.length === 0) {
    return { centerY: fallbackY, minY: fallbackY, maxY: fallbackY, visibleCount: 0, totalCount: 0 };
  }

  const centers = platforms
    .map(platform => platform.position.y + platform.height * 0.5)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (centers.length === 0) {
    return { centerY: fallbackY, minY: fallbackY, maxY: fallbackY, visibleCount: 0, totalCount: 0 };
  }

  const minY = Math.min(...platforms.map(platform => platform.position.y));
  const maxY = Math.max(...platforms.map(platform => platform.position.y + platform.height));
  const usableHeight = Math.max(40, visibleWorldHeight - worldPadding * 2);
  if (maxY - minY <= usableHeight) {
    return {
      centerY: (minY + maxY) * 0.5,
      minY,
      maxY,
      visibleCount: centers.length,
      totalCount: centers.length,
    };
  }

  let bestLeft = 0;
  let bestRight = 0;
  let right = 0;
  let bestDistance = Infinity;
  for (let left = 0; left < centers.length; left++) {
    if (right < left) right = left;
    while (right + 1 < centers.length && centers[right + 1] - centers[left] <= usableHeight) right++;
    const count = right - left + 1;
    const bestCount = bestRight - bestLeft + 1;
    const candidateCenter = (centers[left] + centers[right]) * 0.5;
    const distance = Math.abs(candidateCenter - fallbackY);
    if (count > bestCount || (count === bestCount && distance < bestDistance)) {
      bestLeft = left;
      bestRight = right;
      bestDistance = distance;
    }
    if (right === left) right++;
  }

  return {
    centerY: (centers[bestLeft] + centers[bestRight]) * 0.5,
    minY,
    maxY,
    visibleCount: bestRight - bestLeft + 1,
    totalCount: centers.length,
  };
};

/**
 * Responsive, full-bleed presentation camera.
 *
 * Important separation of concerns:
 * - Physics + policy sensing are world-relative and do not depend on GameState.cameraPosition.
 * - This component owns only the PRESENTATION camera.
 * - Canvas resize never changes world geometry or agent observations.
 * - Visual zoom is a single uniform scale, so nothing can deform.
 * - The canvas always fills its parent; there is no letterboxed camera rectangle to expose.
 */
export const GameCanvas: React.FC<GameCanvasProps> = ({
  gameState,
  showTrails,
  showSenses,
  cameraZoom,
  dayNightConfig,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const presentationCameraXRef = useRef<number | null>(null);
  const presentationCameraYRef = useRef<number | null>(null);
  const presentationCameraScaleRef = useRef<number | null>(null);
  const lastPresentationFrameTimeRef = useRef<number | null>(null);
  const biomeBackgroundCacheRef = useRef<BiomeBackgroundCache | null>(null);
  const biomeBackgroundCache = biomeBackgroundCacheRef.current ?? (biomeBackgroundCacheRef.current = new BiomeBackgroundCache());
  const [lightingTick, setLightingTick] = useState(0);

  // Keep real-time/custom world lighting moving even when the champion simulation is paused.
  useEffect(() => {
    const id = window.setInterval(() => setLightingTick(tick => (tick + 1) % 1_000_000), 250);
    return () => window.clearInterval(id);
  }, []);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const { agents, platforms, cameraPosition, tagEffects } = gameState;

  // Observe the canvas' real parent directly. This removes the previous one-render lag
  // between App's ResizeObserver and the canvas, which could briefly expose dark seams.
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const updateSize = () => {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      setCanvasSize(previous =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = Math.max(1, canvasSize.width);
    const cssHeight = Math.max(1, canvasSize.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    // Draw in layout CSS pixels. The canvas element itself is absolute/full-bleed, so even
    // during an active resize the parent background and canvas background are identical.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.imageSmoothingEnabled = false;

    const fitScale = Math.max(
      0.0001,
      Math.min(cssWidth / WORLD_REF_WIDTH, cssHeight / WORLD_REF_HEIGHT)
    );
    const zoom = Math.max(0.5, Math.min(2, cameraZoom));
    const preferredScale = fitScale * zoom;

    const framingAgents = cameraRelevantAgents(agents, platforms);
    const hasCameraSubjects = framingAgents.length > 0;

    // Pair framing is presentation-only. The user's zoom remains the preferred/MAXIMUM visual
    // zoom, but recursive exclusive routes are allowed to pull the agents much farther apart than
    // one reference viewport. In that case we automatically zoom out just enough to keep every
    // agent body inside a fixed screen-space safety margin.
    let minAgentX = cameraPosition.x + WORLD_REF_WIDTH * 0.5 - AGENT_WIDTH * 0.5;
    let maxAgentX = minAgentX + AGENT_WIDTH;
    if (framingAgents.length > 0) {
      minAgentX = Math.min(...framingAgents.map(agent => agent.position.x));
      maxAgentX = Math.max(...framingAgents.map(agent => agent.position.x + AGENT_WIDTH));
    }

    const cameraFramePaddingPx = CAMERA_FRAME_PADDING_REFERENCE_PX * fitScale;
    const frameWidthPx = Math.max(40, cssWidth - cameraFramePaddingPx * 2);
    const frameHeightPx = Math.max(40, cssHeight - cameraFramePaddingPx * 2);
    const agentSpanX = Math.max(AGENT_WIDTH, maxAgentX - minAgentX);
    // Horizontal pair separation may zoom the camera out. Vertical agent separation deliberately
    // does NOT: jump arcs are allowed to leave the top while terrain remains framed.
    const horizontalPairFitScale = Math.max(0.0001, frameWidthPx / agentSpanX);
    const minimumUsefulScale = fitScale * CAMERA_MIN_USEFUL_AUTO_ZOOM;
    const horizontalDesiredScale = Math.max(
      minimumUsefulScale,
      Math.min(preferredScale, horizontalPairFitScale)
    );

    const provisionalCenterX = hasCameraSubjects
      ? (minAgentX + maxAgentX) * 0.5
      : cameraPosition.x + WORLD_REF_WIDTH * 0.5;
    const provisionalWorldWidth = cssWidth / horizontalDesiredScale;
    const verticalCandidates = platformsInHorizontalFrame(platforms, provisionalCenterX, provisionalWorldWidth);
    const platformMinY = verticalCandidates.length > 0
      ? Math.min(...verticalCandidates.map(platform => platform.position.y))
      : WORLD_REF_HEIGHT * 0.65;
    const platformMaxY = verticalCandidates.length > 0
      ? Math.max(...verticalCandidates.map(platform => platform.position.y + platform.height))
      : WORLD_REF_HEIGHT * 0.75;
    const platformSpanY = Math.max(40, platformMaxY - platformMinY);
    const platformPaddingPx = PLATFORM_VERTICAL_PADDING_REFERENCE_PX * fitScale;
    const platformFitScale = Math.max(0.0001, (frameHeightPx - platformPaddingPx * 2) / platformSpanY);
    const desiredScale = hasCameraSubjects
      ? Math.max(minimumUsefulScale, Math.min(horizontalDesiredScale, platformFitScale))
      : (presentationCameraScaleRef.current ?? preferredScale);

    // Smooth only the zoom-IN direction. Zooming out is a safety response and happens immediately,
    // otherwise a fast branch split can spend several frames outside the viewport.
    const now = performance.now();
    const previousFrameTime = lastPresentationFrameTimeRef.current;
    lastPresentationFrameTimeRef.current = now;
    const dtSeconds = previousFrameTime === null
      ? 1 / 60
      : Math.min(0.05, Math.max(0, (now - previousFrameTime) / 1000));

    let cameraScale = presentationCameraScaleRef.current;
    if (cameraScale === null || !Number.isFinite(cameraScale) || desiredScale < cameraScale) {
      cameraScale = desiredScale;
    } else {
      const zoomAlpha = 1 - Math.exp(-CAMERA_ZOOM_IN_FOLLOW_RATE * dtSeconds);
      cameraScale += (desiredScale - cameraScale) * zoomAlpha;
    }
    // Never allow easing or floating-point drift to exceed the scale that currently fits the pair.
    cameraScale = Math.min(cameraScale, desiredScale);
    presentationCameraScaleRef.current = cameraScale;

    const pairCenterX = hasCameraSubjects
      ? (minAgentX + maxAgentX) * 0.5
      : (presentationCameraXRef.current ?? cameraPosition.x + WORLD_REF_WIDTH * 0.5);
    let cameraCenterX = presentationCameraXRef.current;
    if (cameraCenterX === null || !Number.isFinite(cameraCenterX)) {
      cameraCenterX = pairCenterX;
    } else {
      const followAlpha = 1 - Math.exp(-CAMERA_HORIZONTAL_FOLLOW_RATE * dtSeconds);
      cameraCenterX += (pairCenterX - cameraCenterX) * followAlpha;
    }

    // Vertical framing is terrain-first. At the current scale, select the densest platform band
    // inside the horizontal action window. This deliberately ignores jump apexes.
    const visibleWorldHeight = cssHeight / cameraScale;
    const visibleWorldWidth = cssWidth / cameraScale;
    const localPlatforms = platformsInHorizontalFrame(platforms, cameraCenterX, visibleWorldWidth);
    const worldVerticalPadding = (PLATFORM_VERTICAL_PADDING_REFERENCE_PX * fitScale) / cameraScale;
    const fallbackPlatformY = presentationCameraYRef.current ?? WORLD_REF_HEIGHT * 0.68;
    const platformFrame = bestPlatformVerticalFrame(
      localPlatforms,
      visibleWorldHeight,
      worldVerticalPadding,
      fallbackPlatformY,
    );
    const desiredCenterY = platformFrame.centerY;

    let cameraCenterY = presentationCameraYRef.current;
    if (cameraCenterY === null || !Number.isFinite(cameraCenterY)) {
      cameraCenterY = desiredCenterY;
    } else if (localPlatforms.length > 0) {
      const followAlpha = 1 - Math.exp(-CAMERA_VERTICAL_FOLLOW_RATE * dtSeconds);
      cameraCenterY += (desiredCenterY - cameraCenterY) * followAlpha;
    }

    // Keep the pair horizontally inside the safety margin, but intentionally do not clamp Y to
    // agents. An airborne agent can leave the top for a moment if that preserves the platform map.
    const safeHalfWorldWidth = Math.max(0, cssWidth * 0.5 - cameraFramePaddingPx) / cameraScale;
    const minimumSafeCenterX = maxAgentX - safeHalfWorldWidth;
    const maximumSafeCenterX = minAgentX + safeHalfWorldWidth;

    if (hasCameraSubjects) {
      if (minimumSafeCenterX <= maximumSafeCenterX) {
        cameraCenterX = Math.min(maximumSafeCenterX, Math.max(minimumSafeCenterX, cameraCenterX));
      } else {
        cameraCenterX = pairCenterX;
      }
    }

    presentationCameraXRef.current = cameraCenterX;
    presentationCameraYRef.current = cameraCenterY;

    const visualWorldSeed = gameState.worldSeed ?? DEFAULT_BIOME_WORLD_SEED;
    const visualTimeMs = Date.now();
    const lighting = resolveWorldLighting(dayNightConfig, visualTimeMs);
    drawBiomeBackground(ctx, biomeBackgroundCache, { cameraCenterX, cameraCenterY, cameraScale, cssWidth, cssHeight, worldSeed: visualWorldSeed, lighting, visualTimeMs });

    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-cameraCenterX, -cameraCenterY);

    platforms.forEach(platform => drawPlatform(ctx, platform, lighting));

    if (showTrails) {
      agents.forEach(agent => drawAgentTrail(ctx, agent, gameState.gameTime));
    }

    if (showSenses) {
      agents.forEach(agent => drawAgentSenses(ctx, agent, gameState, cameraScale));
    }

    agents.forEach(agent => drawAgent(ctx, agent, gameState.gameTime));
    tagEffects.forEach(effect => drawTagEffect(ctx, effect));

    ctx.restore();

    drawBiomeForeground(ctx, biomeBackgroundCache, { cameraCenterX, cameraCenterY, cameraScale, cssWidth, cssHeight, worldSeed: visualWorldSeed, lighting, visualTimeMs });

    if (showSenses) {
      // Screen-space legend: it stays readable and stationary while the world camera moves.
      const legendX = 10;
      const legendY = 10;
      const legendW = Math.min(cssWidth - 20, 680);
      ctx.fillStyle = 'rgba(3, 7, 18, 0.82)';
      ctx.fillRect(legendX, legendY, Math.max(0, legendW), 61);
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#d1d5db';
      ctx.fillText(
        'SENSES · compact 23 policy inputs · target/threat · teammate · platforms · ledges',
        legendX + 7,
        legendY + 7
      );
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        'No LiDAR duplication · stable next/next2/previous platform slots · S toggles view',
        legendX + 7,
        legendY + 24
      );
      const debugBiome = getBiomeAtX(cameraCenterX, visualWorldSeed);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(
        `WORLD · ${biomeLabel(debugBiome)} · ${formatWorldHour(lighting.hour)} ${dayNightConfig.mode === 'realtime' ? 'real time' : `${dayNightConfig.cycleMinutes}m day`} · region ${debugBiome.regionIndex} · cache ${biomeBackgroundCache.size}`,
        legendX + 7,
        legendY + 41
      );
    }

    // Kept for the existing API. Capture is intentionally opt-in elsewhere; do not create
    // a data URL every animation frame because it would stall the visual simulation.
  }, [gameState, canvasSize, showTrails, showSenses, cameraZoom, dayNightConfig, lightingTick, biomeBackgroundCache]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full"
      style={{ background: '#111827' }}
    />
  );
};
