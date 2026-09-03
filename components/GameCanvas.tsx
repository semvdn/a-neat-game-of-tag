import React, { useEffect, useRef } from 'react';
import type { GameState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentSenses } from './drawing';
import { AGENT_WIDTH, WORLD_REF_WIDTH, WORLD_REF_HEIGHT } from '../constants';

interface GameCanvasProps {
  gameState: GameState;
  viewportWidth: number;
  viewportHeight: number;
  onFrameReady: (dataUrl: string) => void;
  showTrails: boolean;
  showSenses: boolean;
  cameraZoom: number;
}

/**
 * Responsive presentation of a fixed-size world viewport.
 *
 * Physics and neural inputs always use WORLD_REF_WIDTH × WORLD_REF_HEIGHT world units.
 * The HTML canvas can resize to any CSS dimensions. We fit that logical camera viewport
 * into the canvas with ONE uniform scale factor, so X and Y can never stretch independently.
 */
export const GameCanvas: React.FC<GameCanvasProps> = ({
  gameState,
  viewportWidth,
  viewportHeight,
  onFrameReady,
  showTrails,
  showSenses,
  cameraZoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { agents, platforms, cameraPosition, tagEffects } = gameState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, viewportWidth);
    const cssHeight = Math.max(1, viewportHeight);
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    // Work in CSS pixels first. DPR is only for backing-store sharpness.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paint the ENTIRE canvas as world space first. Zooming out must reveal more
    // of the presentation world, never an unrendered/black letterbox.
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Uniformly fit the fixed logical camera viewport into the responsive canvas.
    // Using one scale for both axes guarantees that world objects never deform.
    const fitScale = Math.max(
      0.0001,
      Math.min(cssWidth / WORLD_REF_WIDTH, cssHeight / WORLD_REF_HEIGHT)
    );
    // cameraZoom is presentation-only. It scales both axes uniformly around the
    // logical camera center, so geometry never deforms and agent observations are untouched.
    const cameraScale = fitScale * Math.max(0.5, Math.min(2, cameraZoom));
    const renderedWorldWidth = WORLD_REF_WIDTH * cameraScale;
    const renderedWorldHeight = WORLD_REF_HEIGHT * cameraScale;

    // Anchor the logical camera rectangle to the exact CSS-pixel center of the canvas.
    // This remains correct for every aspect ratio (wide, tall, square, fractional resize, etc.).
    const canvasCenterX = cssWidth / 2;
    const canvasCenterY = cssHeight / 2;
    const offsetX = canvasCenterX - renderedWorldWidth / 2;
    const offsetY = canvasCenterY - renderedWorldHeight / 2;

    ctx.save();

    // Transform the whole canvas around the CENTER of the logical camera. We deliberately
    // do NOT clip to the 1200x800 policy viewport here. At zoom < 100%, the canvas shows
    // additional surrounding world space instead of shrinking the rendered scene into a
    // smaller rectangle with black borders. Physics/senses still use the fixed viewport.
    const cameraCenterX = cameraPosition.x + WORLD_REF_WIDTH / 2;
    const cameraCenterY = cameraPosition.y + WORLD_REF_HEIGHT / 2;
    ctx.translate(canvasCenterX, canvasCenterY);
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
      // Screen-space legend: keep it visible regardless of camera zoom.
      const legendX = 10;
      const legendY = 10;
      const legendW = Math.min(cssWidth - 20, 535);
      ctx.fillStyle = 'rgba(3, 7, 18, 0.82)';
      ctx.fillRect(legendX, legendY, Math.max(0, legendW), 44);
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#d1d5db';
      ctx.fillText('SENSES · 39 policy inputs · T target/threat · M teammate · P1–P3 nearest platforms', legendX + 7, legendY + 7);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('R0–R7 lidar hits platforms + camera side walls only · S toggles view', legendX + 7, legendY + 24);
    }

    // Camera-frame collision indicator. At zoom-out the fixed policy-camera boundaries
    // are intentionally visible inside the larger presentation viewport.
    const touchingLeft = agents.some(
      a => a.cameraFrameContact === 'left' || a.position.x <= cameraPosition.x + 2.5
    );
    const touchingRight = agents.some(
      a =>
        a.cameraFrameContact === 'right' ||
        a.position.x + AGENT_WIDTH >= cameraPosition.x + WORLD_REF_WIDTH - 2.5
    );

    const indicatorWidth = Math.max(6, Math.min(20, renderedWorldWidth * 0.025));
    const edgeThickness = Math.max(1, Math.min(2, cameraScale * 2));

    if (touchingLeft) {
      const grad = ctx.createLinearGradient(offsetX, 0, offsetX + indicatorWidth, 0);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(offsetX, offsetY, indicatorWidth, renderedWorldHeight);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(offsetX, offsetY, edgeThickness, renderedWorldHeight);
    }

    if (touchingRight) {
      const rightEdge = offsetX + renderedWorldWidth;
      const grad = ctx.createLinearGradient(rightEdge, 0, rightEdge - indicatorWidth, 0);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(rightEdge - indicatorWidth, offsetY, indicatorWidth, renderedWorldHeight);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(rightEdge - edgeThickness, offsetY, edgeThickness, renderedWorldHeight);
    }
  }, [gameState, viewportWidth, viewportHeight, onFrameReady, showTrails, showSenses, cameraZoom]);

  return <canvas ref={canvasRef} className="block" />;
};
