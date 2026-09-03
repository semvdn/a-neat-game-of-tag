import React, { useEffect, useRef, useState } from 'react';
import type { GameState, PlatformState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentSenses } from './drawing';
import { WORLD_REF_WIDTH, WORLD_REF_HEIGHT } from '../constants';

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
const getActivePlatformY = (gameState: GameState): number => {
  const { agents, platforms } = gameState;
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
 * - Physics + policy sensing keep using GameState.cameraPosition and the fixed 1200x800 frame.
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
    const cameraScale = fitScale * zoom;

    // Horizontal presentation tracking remains aligned with the policy camera, preserving
    // the familiar forward-flow composition. Vertical presentation tracking is independent.
    const cameraCenterX = cameraPosition.x + WORLD_REF_WIDTH / 2;

    // Keep the active platform at a fixed vertical percentage of the screen at every zoom.
    // Because screen Y = (worldY - centerY) * scale + H/2, solving for centerY gives this.
    const activePlatformY = getActivePlatformY(gameState);
    const visibleWorldHeight = cssHeight / cameraScale;
    const desiredCenterY =
      activePlatformY + (0.5 - PLATFORM_SCREEN_Y_RATIO) * visibleWorldHeight;

    // Vertical framing is exact rather than eased: the active platform must never lag
    // below the visual camera during a height transition, especially at high zoom.
    const cameraCenterY = desiredCenterY;

    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-cameraCenterX, -cameraCenterY);

    platforms.forEach(platform => drawPlatform(ctx, platform));

    if (showTrails) {
      agents.forEach(agent => drawAgentTrail(ctx, agent));
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
        'SENSES · 39 policy inputs · T target/threat · M teammate · P1–P3 nearest platforms',
        legendX + 7,
        legendY + 7
      );
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        'R0–R7 lidar hits platforms + policy-camera side walls only · S toggles view',
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
