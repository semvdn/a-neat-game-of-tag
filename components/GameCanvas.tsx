import React, { useEffect, useRef } from 'react';
import type { GameState } from '../types';
import { drawPlatform, drawAgent, drawAgentTrail, drawTagEffect, drawAgentLidarRays } from './drawing';

interface GameCanvasProps {
  gameState: GameState;
  viewportWidth: number;
  viewportHeight: number;
  onFrameReady: (dataUrl: string) => void;
  showTrails: boolean;
  showLidar: boolean;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, viewportWidth, viewportHeight, onFrameReady, showTrails, showLidar }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { agents, platforms, cameraPosition, tagEffects } = gameState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a202c'; // bg-gray-900
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    // Apply camera transform
    ctx.save();
    ctx.translate(-cameraPosition.x, -cameraPosition.y);

    // Draw game platforms
    platforms.forEach(platform => drawPlatform(ctx, platform));
    
    // Draw motion trails
    if (showTrails) {
      agents.forEach(agent => drawAgentTrail(ctx, agent));
    }

    // Draw multi-ray spatial lidar sensors
    if (showLidar) {
      agents.forEach(agent => drawAgentLidarRays(ctx, agent));
    }

    // Draw agent characters
    agents.forEach(agent => drawAgent(ctx, agent));

    // Draw tag effects
    tagEffects.forEach(effect => drawTagEffect(ctx, effect));

    ctx.restore();

    // Camera frame boundary collision indicator
    const touchingLeft = agents.some(
      a => a.cameraFrameContact === 'left' || a.position.x <= cameraPosition.x + 2.5
    );
    const touchingRight = agents.some(
      a => a.cameraFrameContact === 'right' || a.position.x + 40 >= cameraPosition.x + viewportWidth - 2.5
    );

    if (touchingLeft) {
      const grad = ctx.createLinearGradient(0, 0, 20, 0);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 20, viewportHeight);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, 2, viewportHeight);
    }

    if (touchingRight) {
      const grad = ctx.createLinearGradient(viewportWidth, 0, viewportWidth - 20, 0);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(viewportWidth - 20, 0, 20, viewportHeight);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(viewportWidth - 2, 0, 2, viewportHeight);
    }
  }, [gameState, viewportWidth, viewportHeight, onFrameReady, showTrails, showLidar]);

  return (
    <canvas
      ref={canvasRef}
      width={viewportWidth}
      height={viewportHeight}
      className="w-full h-full"
    />
  );
};
