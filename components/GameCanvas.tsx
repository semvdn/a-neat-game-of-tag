import React, { useEffect, useRef } from 'react';
import type { GameState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentLidarRays } from './drawing';
import { AGENT_WIDTH, WORLD_REF_WIDTH, WORLD_REF_HEIGHT } from '../constants';

interface GameCanvasProps {
  gameState: GameState;
  viewportWidth: number;
  viewportHeight: number;
  onFrameReady: (dataUrl: string) => void;
  showTrails: boolean;
  showLidar: boolean;
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
  showLidar,
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
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Uniformly fit the fixed logical camera viewport into the responsive canvas.
    // Using one scale for both axes guarantees that world objects never deform.
    const cameraScale = Math.max(
      0.0001,
      Math.min(cssWidth / WORLD_REF_WIDTH, cssHeight / WORLD_REF_HEIGHT)
    );
    const renderedWorldWidth = WORLD_REF_WIDTH * cameraScale;
    const renderedWorldHeight = WORLD_REF_HEIGHT * cameraScale;
    const offsetX = (cssWidth - renderedWorldWidth) / 2;
    const offsetY = (cssHeight - renderedWorldHeight) / 2;

    // Slightly distinguish the active camera area from any aspect-ratio letterboxing.
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(offsetX, offsetY, renderedWorldWidth, renderedWorldHeight);

    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, renderedWorldWidth, renderedWorldHeight);
    ctx.clip();

    // Canvas pixels -> logical camera units -> world coordinates.
    ctx.translate(offsetX, offsetY);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-cameraPosition.x, -cameraPosition.y);

    platforms.forEach(platform => drawPlatform(ctx, platform));

    if (showTrails) {
      agents.forEach(agent => drawAgentTrail(ctx, agent));
    }

    if (showLidar) {
      agents.forEach(agent => drawAgentLidarRays(ctx, agent));
    }

    agents.forEach(agent => drawAgent(ctx, agent));
    tagEffects.forEach(effect => drawTagEffect(ctx, effect));

    ctx.restore();

    // Camera-frame collision indicator. These are drawn in CSS pixels but line up with
    // the uniformly scaled logical camera edges rather than the outer canvas letterbox.
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
  }, [gameState, viewportWidth, viewportHeight, onFrameReady, showTrails, showLidar]);

  return <canvas ref={canvasRef} className="block" />;
};
