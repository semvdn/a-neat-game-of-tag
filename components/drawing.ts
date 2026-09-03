

import type { PlatformState, AgentState, TagEffect, GameState } from '../types';
import { AgentStatus } from '../types';
import { AGENT_WIDTH, AGENT_HEIGHT, FALL_BOUNDARY, WORLD_REF_WIDTH, WORLD_REF_HEIGHT } from '../constants';

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

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < trailLength - 1; i++) {
        const startPoint = agent.trajectory[i];
        const endPoint = agent.trajectory[i + 1];
        const progress = (i + 1) / (trailLength - 1); // oldest -> newest
        const opacity = 0.06 + progress * 0.62;

        ctx.beginPath();
        ctx.moveTo(startPoint.x + agentCenterOffsetX, startPoint.y + agentCenterOffsetY);
        ctx.lineTo(endPoint.x + agentCenterOffsetX, endPoint.y + agentCenterOffsetY);

        // The newest part of the trail should be strongest; the tail fades away.
        ctx.lineWidth = 1.25 + progress * 3.25;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.stroke();
    }

    ctx.restore();
};

const rgbaFromHex = (hex: string, alpha: number) => {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map(c => c + c).join('')
        : normalized.padEnd(6, '0').slice(0, 6);
    const r = parseInt(value.slice(0, 2), 16) || 255;
    const g = parseInt(value.slice(2, 4), 16) || 255;
    const b = parseInt(value.slice(4, 6), 16) || 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Draw the actual observation channels that feed the current 31-input NEAT policy.
 * Geometry selection is not recomputed here: getAgentStateVector() stores sensesDebug
 * from the exact observation pass used by the network, and this renderer consumes it.
 */
export const drawAgentSenses = (
    ctx: CanvasRenderingContext2D,
    agent: AgentState,
    gameState: GameState,
    cameraScale: number,
) => {
    const debug = agent.sensesDebug;
    if (!debug) return;

    const unit = 1 / Math.max(0.0001, cameraScale);
    const cx = agent.position.x + AGENT_WIDTH / 2;
    const cy = agent.position.y + AGENT_HEIGHT / 2;
    const primary = rgbaFromHex(agent.color, 0.92);
    const medium = rgbaFromHex(agent.color, 0.52);
    const faint = rgbaFromHex(agent.color, 0.24);
    const textBg = 'rgba(3, 7, 18, 0.76)';
    const leftEdge = gameState.cameraPosition.x;
    const rightEdge = leftEdge + WORLD_REF_WIDTH;
    const visibleBottom = gameState.cameraPosition.y + WORLD_REF_HEIGHT;

    const label = (text: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
        ctx.save();
        ctx.font = `${10.5 * unit}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = align;
        const metrics = ctx.measureText(text);
        const padX = 3 * unit;
        const padY = 2 * unit;
        const h = 13 * unit;
        let boxX = x;
        if (align === 'center') boxX = x - metrics.width / 2;
        if (align === 'right') boxX = x - metrics.width;
        ctx.fillStyle = textBg;
        ctx.fillRect(boxX - padX, y - h / 2 - padY / 2, metrics.width + padX * 2, h + padY);
        ctx.fillStyle = primary;
        ctx.fillText(text, x, y);
        ctx.restore();
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Target / threat dynamics: dx, dy, vx, vy + opponent energy.
    if (debug.target) {
        const target = gameState.agents.find(a => a.id === debug.target!.id);
        if (target) {
            const tx = target.position.x + AGENT_WIDTH / 2;
            const ty = target.position.y + AGENT_HEIGHT / 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(tx, ty);
            ctx.lineWidth = 2.0 * unit;
            ctx.strokeStyle = primary;
            ctx.stroke();
            const e = debug.target.energy ?? 0;
            label(
                `T A${target.id} d(${debug.target.dx.toFixed(2)},${debug.target.dy.toFixed(2)}) v(${debug.target.vx.toFixed(2)},${debug.target.vy.toFixed(2)}) E${e.toFixed(2)}`,
                (cx + tx) / 2,
                (cy + ty) / 2 - 10 * unit,
                'center',
            );
        }
    }

    // Closest teammate dynamics exist for evaders only.
    if (debug.teammate) {
        const mate = gameState.agents.find(a => a.id === debug.teammate!.id);
        if (mate) {
            const mx = mate.position.x + AGENT_WIDTH / 2;
            const my = mate.position.y + AGENT_HEIGHT / 2;
            ctx.setLineDash([6 * unit, 5 * unit]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(mx, my);
            ctx.lineWidth = 1.4 * unit;
            ctx.strokeStyle = medium;
            ctx.stroke();
            ctx.setLineDash([]);
            label(
                `M A${mate.id} d(${debug.teammate.dx.toFixed(2)},${debug.teammate.dy.toFixed(2)}) v(${debug.teammate.vx.toFixed(2)},${debug.teammate.vy.toFixed(2)})`,
                (cx + mx) / 2,
                (cy + my) / 2 + 10 * unit,
                'center',
            );
        }
    }

    // Three closest platform slots (excluding the current platform while grounded).
    debug.nearbyPlatforms.forEach((slot, index) => {
        const platform = gameState.platforms.find(p => p.id === slot.id);
        if (!platform) return;
        const px = platform.position.x + platform.width / 2;
        const py = platform.position.y + platform.height / 2;
        ctx.setLineDash([3 * unit, 4 * unit]);
        ctx.lineWidth = 1.1 * unit;
        ctx.strokeStyle = medium;
        ctx.strokeRect(
            platform.position.x - 2 * unit,
            platform.position.y - 2 * unit,
            platform.width + 4 * unit,
            platform.height + 4 * unit,
        );
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        label(
            `P${index + 1} d(${slot.dx.toFixed(2)},${slot.dy.toFixed(2)}) w${slot.width.toFixed(2)}`,
            platform.position.x + platform.width / 2,
            platform.position.y - (10 + index * 13) * unit,
            'center',
        );
    });

    // Explicit ledge channels use the current platform when grounded, otherwise the nearest platform.
    if (debug.ledges.referencePlatformId !== null) {
        const platform = gameState.platforms.find(p => p.id === debug.ledges.referencePlatformId);
        if (platform) {
            const leftX = platform.position.x;
            const rightX = platform.position.x + platform.width;
            const topY = platform.position.y;
            ctx.setLineDash([2 * unit, 3 * unit]);
            ctx.lineWidth = 1.25 * unit;
            ctx.strokeStyle = debug.ledges.alert > 0 ? 'rgba(251, 191, 36, 0.86)' : faint;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(leftX, topY);
            ctx.moveTo(cx, cy);
            ctx.lineTo(rightX, topY);
            ctx.stroke();
            ctx.setLineDash([]);
            label(
                `LEDGE L${debug.ledges.left.toFixed(2)} R${debug.ledges.right.toFixed(2)} min${debug.ledges.closest.toFixed(2)} alert${debug.ledges.alert.toFixed(2)}`,
                platform.position.x + platform.width / 2,
                platform.position.y + platform.height + 11 * unit,
                'center',
            );
        }
    }

    // Explicit left/right camera boundary distances.
    ctx.setLineDash([2 * unit, 5 * unit]);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.beginPath();
    ctx.moveTo(leftEdge, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(rightEdge, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    label(`L ${debug.boundaries.left.toFixed(2)}`, leftEdge + 7 * unit, cy - 10 * unit, 'left');
    label(`R ${debug.boundaries.right.toFixed(2)}`, rightEdge - 7 * unit, cy - 10 * unit, 'right');

    // Fall-boundary input. The real boundary is often below the viewport, so terminate at the
    // visible bottom and leave a downward arrow when the sensor target is off-screen.
    const agentBottom = agent.position.y + AGENT_HEIGHT;
    const fallVisible = FALL_BOUNDARY >= gameState.cameraPosition.y && FALL_BOUNDARY <= visibleBottom;
    const fallEndY = fallVisible ? FALL_BOUNDARY : visibleBottom - 8 * unit;
    ctx.beginPath();
    ctx.moveTo(cx, agentBottom);
    ctx.lineTo(cx, fallEndY);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.stroke();
    label(`FALL${fallVisible ? '' : '↓'} ${debug.boundaries.fall.toFixed(2)}`, cx + 7 * unit, Math.min(fallEndY - 10 * unit, cy + 62 * unit), 'left');

    // Self inputs: two velocities, stamina, grounded, role bit and cooldown bit.
    const role = debug.self.isIt > 0.5 ? 'C' : 'R';
    label(
        `A${agent.id} ${role} vx${debug.self.vx.toFixed(2)} vy${debug.self.vy.toFixed(2)} E${debug.self.energy.toFixed(2)} G${debug.self.grounded.toFixed(0)} CD${debug.self.cooldown.toFixed(0)}`,
        cx,
        agent.position.y - 37 * unit,
        'center',
    );

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