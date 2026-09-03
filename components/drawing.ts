

import type { PlatformState, AgentState, TagEffect } from '../types';
import { AgentStatus } from '../types';
import { AGENT_WIDTH, AGENT_HEIGHT } from '../constants';

export const drawTagEffect = (ctx: CanvasRenderingContext2D, effect: TagEffect) => {
    const progress = 1 - (effect.life / effect.initialLife); // 0 to 1
    if (progress < 0 || progress > 1) return;

    const radius = progress * 40;
    const opacity = 1 - progress;
    const agentCenterX = effect.position.x + AGENT_WIDTH / 2;
    const agentCenterY = effect.position.y + AGENT_HEIGHT / 2;

    ctx.globalAlpha = opacity;
    
    // Outer ring
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`; // White
    ctx.lineWidth = 3 + (1 - progress) * 3;
    ctx.beginPath();
    ctx.arc(agentCenterX, agentCenterY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Inner fill
    ctx.fillStyle = `rgba(255, 235, 59, ${opacity * 0.8})`; // Yellow
    ctx.beginPath();
    ctx.arc(agentCenterX, agentCenterY, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
};

export const drawAgentTrail = (ctx: CanvasRenderingContext2D, agent: AgentState) => {
    if (!agent.trajectory || agent.trajectory.length < 2) return;

    const trailLength = agent.trajectory.length;
    const agentCenterOffsetX = AGENT_WIDTH / 2;
    const agentCenterOffsetY = AGENT_HEIGHT / 2;

    const r = parseInt(agent.color.slice(1, 3), 16);
    const g = parseInt(agent.color.slice(3, 5), 16);
    const b = parseInt(agent.color.slice(5, 7), 16);

    for (let i = 0; i < trailLength - 1; i++) {
        const startPoint = agent.trajectory[i];
        const endPoint = agent.trajectory[i + 1];
        
        const opacity = (1 - (i / trailLength)) * 0.7; // Max opacity 0.7

        ctx.beginPath();
        ctx.moveTo(startPoint.x + agentCenterOffsetX, startPoint.y + agentCenterOffsetY);
        ctx.lineTo(endPoint.x + agentCenterOffsetX, endPoint.y + agentCenterOffsetY);
        
        ctx.lineWidth = 2 + 3 * (1 - (i/trailLength)); // Tapered line width
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.stroke();
    }
};

export const drawAgentLidarRays = (ctx: CanvasRenderingContext2D, agent: AgentState) => {
    if (!agent.lidarRays || agent.lidarRays.length === 0) return;

    const cx = agent.position.x + AGENT_WIDTH / 2;
    const cy = agent.position.y + AGENT_HEIGHT / 2;

    ctx.save();
    for (let i = 0; i < agent.lidarRays.length; i++) {
        const ray = agent.lidarRays[i];
        const endX = cx + ray.direction.x * ray.distance;
        const endY = cy + ray.direction.y * ray.distance;

        const hasHit = ray.hitPoint !== null;
        const norm = ray.normalizedDistance;

        // Color modulation based on proximity
        let strokeColor = 'rgba(100, 116, 139, 0.18)'; // Faint slate if far/open
        let hitGlowColor = 'rgba(6, 182, 212, 0.7)';  // Cyan

        if (hasHit) {
            if (norm < 0.25) {
                strokeColor = 'rgba(239, 68, 68, 0.45)'; // Red/Amber if perilously close
                hitGlowColor = 'rgba(239, 68, 68, 0.9)';
            } else if (norm < 0.6) {
                strokeColor = 'rgba(234, 179, 8, 0.35)'; // Yellow
                hitGlowColor = 'rgba(234, 179, 8, 0.8)';
            } else {
                strokeColor = 'rgba(16, 185, 129, 0.28)'; // Emerald
                hitGlowColor = 'rgba(16, 185, 129, 0.75)';
            }
        }

        // Draw ray line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(endX, endY);
        ctx.lineWidth = hasHit ? 1.2 : 0.8;
        ctx.strokeStyle = strokeColor;
        ctx.stroke();

        // Draw hit contact indicator
        if (hasHit) {
            ctx.beginPath();
            ctx.arc(endX, endY, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = hitGlowColor;
            ctx.fill();
        }
    }
    ctx.restore();
};

export const drawPlatform = (ctx: CanvasRenderingContext2D, platform: PlatformState) => {
  ctx.fillStyle = '#4a5568'; // gray-700
  ctx.fillRect(platform.position.x, platform.position.y, platform.width, platform.height);
  ctx.fillStyle = '#2d3748'; // gray-800
  ctx.fillRect(platform.position.x, platform.position.y + platform.height - 4, platform.width, 4);
};

const drawItIndicator = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#ef4444'; // red-500
    ctx.beginPath();
    ctx.moveTo(AGENT_WIDTH / 2, -18);
    ctx.lineTo(AGENT_WIDTH / 2 - 8, -28);
    ctx.lineTo(AGENT_WIDTH / 2 + 8, -28);
    ctx.closePath();
    ctx.fill();
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
};

const drawEyes = (ctx: CanvasRenderingContext2D, agent: AgentState) => {
    const eyeOffsetX = AGENT_WIDTH / 2;
    const eyeOffsetY = AGENT_HEIGHT / 2.8;
    const eyeRadius = 6;
    const pupilRadius = 3;
    const eyeSpacing = 16;
    
    let pupilOffsetX = 0;
    const speed = Math.abs(agent.velocity.x);
    if (agent.velocity.x > 0.5) pupilOffsetX = Math.min(2.5, speed / 2);
    if (agent.velocity.x < -0.5) pupilOffsetX = -Math.min(2.5, speed / 2);

    // Eyes whites
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(eyeOffsetX - eyeSpacing / 2, eyeOffsetY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX + eyeSpacing / 2, eyeOffsetY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    if (agent.status === AgentStatus.Cooldown) {
        // Dizzy eyes (X)
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        const eyeXSize = 4;
        // Left eye X
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeSpacing / 2 - eyeXSize, eyeOffsetY - eyeXSize);
        ctx.lineTo(eyeOffsetX - eyeSpacing / 2 + eyeXSize, eyeOffsetY + eyeXSize);
        ctx.moveTo(eyeOffsetX - eyeSpacing / 2 + eyeXSize, eyeOffsetY - eyeXSize);
        ctx.lineTo(eyeOffsetX - eyeSpacing / 2 - eyeXSize, eyeOffsetY + eyeXSize);
        ctx.stroke();
        // Right eye X
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX + eyeSpacing / 2 - eyeXSize, eyeOffsetY - eyeXSize);
        ctx.lineTo(eyeOffsetX + eyeSpacing / 2 + eyeXSize, eyeOffsetY + eyeXSize);
        ctx.moveTo(eyeOffsetX + eyeSpacing / 2 + eyeXSize, eyeOffsetY - eyeXSize);
        ctx.lineTo(eyeOffsetX + eyeSpacing / 2 - eyeXSize, eyeOffsetY + eyeXSize);
        ctx.stroke();
    } else {
        // Pupils
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(eyeOffsetX - eyeSpacing / 2 + pupilOffsetX, eyeOffsetY, pupilRadius, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX + eyeSpacing / 2 + pupilOffsetX, eyeOffsetY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    if (agent.status === AgentStatus.It) {
        // Angry eyebrows for 'It'
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2.5;
        // Left eyebrow
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeSpacing / 2 - 8, eyeOffsetY - 10);
        ctx.lineTo(eyeOffsetX - eyeSpacing / 2 + 5, eyeOffsetY - 6);
        ctx.stroke();
        // Right eyebrow
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX + eyeSpacing / 2 + 8, eyeOffsetY - 10);
        ctx.lineTo(eyeOffsetX + eyeSpacing / 2 - 5, eyeOffsetY - 6);
        ctx.stroke();
    } else if (agent.status === AgentStatus.Normal) {
        // Neutral/slightly worried eyebrows for evaders
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        // Left eyebrow
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeSpacing / 2 - 7, eyeOffsetY - 8);
        ctx.arcTo(eyeOffsetX - eyeSpacing / 2, eyeOffsetY - 12, eyeOffsetX - eyeSpacing / 2 + 7, eyeOffsetY - 8, 8);
        ctx.stroke();
        // Right eyebrow
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX + eyeSpacing / 2 - 7, eyeOffsetY - 8);
        ctx.arcTo(eyeOffsetX + eyeSpacing / 2, eyeOffsetY - 12, eyeOffsetX + eyeSpacing / 2 + 7, eyeOffsetY - 8, 8);
        ctx.stroke();
    }
};

export const drawAgent = (ctx: CanvasRenderingContext2D, agent: AgentState) => {
  ctx.save();
  ctx.translate(agent.position.x, agent.position.y);

  // An agent blinks if it has an active cooldown, which applies to the new 'It' agent temporarily.
  const isBlinking = agent.cooldownTimer > 0 && Math.floor(agent.cooldownTimer / 100) % 2 === 0;
  ctx.globalAlpha = isBlinking ? 0.5 : 1;

  // Apply squish/stretch transform from the center of the agent
  ctx.translate(AGENT_WIDTH / 2, AGENT_HEIGHT / 2);
  ctx.scale(agent.scale.x, agent.scale.y);
  ctx.translate(-AGENT_WIDTH / 2, -AGENT_HEIGHT / 2);
  
  // Shadow for 'It' agent, applied before drawing the body
  if (agent.status === AgentStatus.It) {
    ctx.shadowColor = agent.color;
    ctx.shadowBlur = 15;
  }
  
  // Body - rounded rectangle
  ctx.fillStyle = agent.color;
  roundRect(ctx, 0, 0, AGENT_WIDTH, AGENT_HEIGHT, 10);
  
  // Body Highlight
  const gradient = ctx.createLinearGradient(0, 0, AGENT_WIDTH, 0);
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, AGENT_WIDTH, AGENT_HEIGHT, 10);

  // Reset shadow before drawing other elements
  ctx.shadowBlur = 0;
  
  // Eyes and expression
  drawEyes(ctx, agent);

  // It Indicator
  if (agent.status === AgentStatus.It) {
    drawItIndicator(ctx);
  }

  ctx.restore();
};