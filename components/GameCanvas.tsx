import React, { useEffect, useRef, useState } from 'react';
import type { GameState, PlatformState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentSenses } from './drawing';
import { AGENT_HEIGHT, AGENT_WIDTH, WORLD_REF_WIDTH, WORLD_REF_HEIGHT, CAMERA_FRAME_PADDING_REFERENCE_PX, CAMERA_MIN_USEFUL_AUTO_ZOOM } from '../constants';
import { cameraRelevantAgents } from '../learning/cameraFraming';

interface GameCanvasProps {
  gameState: GameState;
  onFrameReady: (dataUrl: string) => void;
  showTrails: boolean;
  showSenses: boolean;
  cameraZoom: number;
}

// The visual camera is deliberately separate from the 1200x800 policy/sensor frame.
// Keeping the platform at this screen-height ratio leaves enough headroom for a full jump
// even at 200% visual zoom, while still showing the platform beneath the characters.
const PLATFORM_SCREEN_Y_RATIO = 0.72;
// Vertical presentation camera easing. This is real-time based (not simulation-time based),
// so changing champion view speed does not make the camera snap or become sluggish.
const CAMERA_VERTICAL_FOLLOW_RATE = 5.5;
const CAMERA_HORIZONTAL_FOLLOW_RATE = 6.0;
// Zooming out must be immediate enough to preserve visibility when agents commit to different
// branches. Zooming back in is deliberately slower so the presentation does not pulse.
const CAMERA_ZOOM_IN_FOLLOW_RATE = 2.4;
// While easing, keep the active platform inside this vertical screen band. The target sits at
// 72%, leaving room above for jumps while guaranteeing that downward height changes cannot
// disappear below the viewport at high zoom.
const PLATFORM_SCREEN_Y_MIN_RATIO = 0.56;
const PLATFORM_SCREEN_Y_MAX_RATIO = 0.86;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/**
 * Find the platform band that best represents where the current action is happening.
 * We prefer the platforms the agents most recently occupied, because that stays stable
 * during jumps. If those platforms have been despawned, fall back to the platform nearest
 * the group in both X and Y.
 */
const getActivePlatformY = (gameState: GameState, framingAgents: typeof gameState.agents): number => {
  const { platforms } = gameState;
  const agents = framingAgents;
  if (platforms.length === 0) return WORLD_REF_HEIGHT * 0.75;

  const platformById = new Map<number, PlatformState>();
  platforms.forEach(platform => platformById.set(platform.id, platform));

  const supportYs = agents
    .map(agent => platformById.get(agent.lastPlatformId)?.position.y)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (supportYs.length > 0) return median(supportYs);

  const groupX = agents.reduce((sum, agent) => sum + agent.position.x, 0) / Math.max(1, agents.length);
  const groupY = agents.reduce((sum, agent) => sum + agent.position.y, 0) / Math.max(1, agents.length);

  let best = platforms[0];
  let bestScore = Infinity;
  for (const platform of platforms) {
    const platformCenterX = platform.position.x + platform.width / 2;
    const score = Math.abs(platformCenterX - groupX) * 0.35 + Math.abs(platform.position.y - groupY);
    if (score < bestScore) {
      best = platform;
      bestScore = score;
    }
  }
  return best.position.y;
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
  onFrameReady,
  showTrails,
  showSenses,
  cameraZoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const presentationCameraXRef = useRef<number | null>(null);
  const presentationCameraYRef = useRef<number | null>(null);
  const presentationCameraScaleRef = useRef<number | null>(null);
  const lastPresentationFrameTimeRef = useRef<number | null>(null);
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
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

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
    let minAgentY = WORLD_REF_HEIGHT * 0.5 - AGENT_HEIGHT * 0.5;
    let maxAgentY = minAgentY + AGENT_HEIGHT;
    if (framingAgents.length > 0) {
      minAgentX = Math.min(...framingAgents.map(agent => agent.position.x));
      maxAgentX = Math.max(...framingAgents.map(agent => agent.position.x + AGENT_WIDTH));
      minAgentY = Math.min(...framingAgents.map(agent => agent.position.y));
      maxAgentY = Math.max(...framingAgents.map(agent => agent.position.y + AGENT_HEIGHT));
    }

    const cameraFramePaddingPx = CAMERA_FRAME_PADDING_REFERENCE_PX * fitScale;
    const frameWidthPx = Math.max(40, cssWidth - cameraFramePaddingPx * 2);
    const frameHeightPx = Math.max(40, cssHeight - cameraFramePaddingPx * 2);
    const agentSpanX = Math.max(AGENT_WIDTH, maxAgentX - minAgentX);
    const agentSpanY = Math.max(AGENT_HEIGHT, maxAgentY - minAgentY);
    const pairFitScale = Math.max(
      0.0001,
      Math.min(frameWidthPx / agentSpanX, frameHeightPx / agentSpanY)
    );
    const minimumUsefulScale = fitScale * CAMERA_MIN_USEFUL_AUTO_ZOOM;
    const fittedDesiredScale = Math.max(minimumUsefulScale, Math.min(preferredScale, pairFitScale));
    const desiredScale = hasCameraSubjects
      ? fittedDesiredScale
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

    // Keep the active platform at a useful vertical percentage when the pair is close. Falling
    // agents are absent from framingAgents. If every body is falling, hold the previous vertical
    // camera exactly until somebody is back in the playable band.
    const visibleWorldHeight = cssHeight / cameraScale;
    const activePlatformY = hasCameraSubjects
      ? getActivePlatformY(gameState, framingAgents)
      : WORLD_REF_HEIGHT * PLATFORM_SCREEN_Y_RATIO;
    const desiredCenterY = hasCameraSubjects
      ? activePlatformY + (0.5 - PLATFORM_SCREEN_Y_RATIO) * visibleWorldHeight
      : (presentationCameraYRef.current ?? WORLD_REF_HEIGHT * 0.5);

    let cameraCenterY = presentationCameraYRef.current;
    if (cameraCenterY === null || !Number.isFinite(cameraCenterY)) {
      cameraCenterY = desiredCenterY;
    } else if (hasCameraSubjects) {
      const followAlpha = 1 - Math.exp(-CAMERA_VERTICAL_FOLLOW_RATE * dtSeconds);
      cameraCenterY += (desiredCenterY - cameraCenterY) * followAlpha;
    }

    if (hasCameraSubjects) {
      // Preserve the old active-platform safety band so normal close pursuit keeps the same
      // visual composition as before.
      const minimumPlatformCenterY =
        activePlatformY + (0.5 - PLATFORM_SCREEN_Y_MAX_RATIO) * visibleWorldHeight;
      const maximumPlatformCenterY =
        activePlatformY + (0.5 - PLATFORM_SCREEN_Y_MIN_RATIO) * visibleWorldHeight;
      cameraCenterY = Math.min(maximumPlatformCenterY, Math.max(minimumPlatformCenterY, cameraCenterY));
    }

    // Then hard-clamp BOTH axes to the legal camera-center interval that keeps every agent within
    // the screen-space safety margin. This means camera smoothing can never be the reason a Runner
    // or Chaser disappears off-screen, even during rapid recursive branch divergence.
    const safeHalfWorldWidth = Math.max(0, cssWidth * 0.5 - cameraFramePaddingPx) / cameraScale;
    const safeHalfWorldHeight = Math.max(0, cssHeight * 0.5 - cameraFramePaddingPx) / cameraScale;
    const minimumSafeCenterX = maxAgentX - safeHalfWorldWidth;
    const maximumSafeCenterX = minAgentX + safeHalfWorldWidth;
    const minimumSafeCenterY = maxAgentY - safeHalfWorldHeight;
    const maximumSafeCenterY = minAgentY + safeHalfWorldHeight;

    if (hasCameraSubjects) {
      if (minimumSafeCenterX <= maximumSafeCenterX) {
        cameraCenterX = Math.min(maximumSafeCenterX, Math.max(minimumSafeCenterX, cameraCenterX));
      } else {
        cameraCenterX = pairCenterX;
      }
      if (minimumSafeCenterY <= maximumSafeCenterY) {
        cameraCenterY = Math.min(maximumSafeCenterY, Math.max(minimumSafeCenterY, cameraCenterY));
      } else {
        cameraCenterY = (minAgentY + maxAgentY) * 0.5;
      }
    }

    presentationCameraXRef.current = cameraCenterX;
    presentationCameraYRef.current = cameraCenterY;

    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-cameraCenterX, -cameraCenterY);

    platforms.forEach(platform => drawPlatform(ctx, platform));

    if (showTrails) {
      agents.forEach(agent => drawAgentTrail(ctx, agent, gameState.gameTime));
    }

    if (showSenses) {
      agents.forEach(agent => drawAgentSenses(ctx, agent, gameState, cameraScale));
    }

    agents.forEach(agent => drawAgent(ctx, agent));
    tagEffects.forEach(effect => drawTagEffect(ctx, effect));

    ctx.restore();

    if (showSenses) {
      // Screen-space legend: it stays readable and stationary while the world camera moves.
      const legendX = 10;
      const legendY = 10;
      const legendW = Math.min(cssWidth - 20, 535);
      ctx.fillStyle = 'rgba(3, 7, 18, 0.82)';
      ctx.fillRect(legendX, legendY, Math.max(0, legendW), 44);
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
    }

    // Kept for the existing API. Capture is intentionally opt-in elsewhere; do not create
    // a data URL every animation frame because it would stall the visual simulation.
    void onFrameReady;
  }, [gameState, canvasSize, onFrameReady, showTrails, showSenses, cameraZoom]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full"
      style={{ background: '#1a202c' }}
    />
  );
};
