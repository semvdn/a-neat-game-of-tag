

import type { PlatformState, AgentState, TagEffect, GameState } from '../types';
import { AgentStatus } from '../types';
import { AGENT_WIDTH, AGENT_HEIGHT, WORLD_REF_WIDTH, WORLD_REF_HEIGHT, FALL_BOUNDARY } from '../constants';

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
 * Newer-style senses diagnostic view, adapted to the ORIGINAL 39-input policy.
 *
 * Crucially, this renderer does not calculate new policy inputs. It reads the stateVector
 * already produced by learning/state.ts and the lidarRays stored by that same observation pass.
 * World-object lookup below is only used to place labels/lines on the matching target, teammate,
 * platform, and policy-camera boundaries.
 */
export const drawAgentSenses = (
    ctx: CanvasRenderingContext2D,
    agent: AgentState,
    gameState: GameState,
    cameraScale: number,
) => {
    const state = agent.stateVector;

    // LiDAR data is captured directly by the original sensor calculation, so it can still be
    // shown during the first visual frame before stateVector has been attached to the UI agent.
    drawAgentLidarRays(ctx, agent);
    if (!state || state.length < 39) return;

    const unit = 1 / Math.max(0.0001, cameraScale);
    const cx = agent.position.x + AGENT_WIDTH / 2;
    const cy = agent.position.y + AGENT_HEIGHT / 2;
    const primary = rgbaFromHex(agent.color, 0.92);
    const medium = rgbaFromHex(agent.color, 0.52);
    const faint = rgbaFromHex(agent.color, 0.24);
    const textBg = 'rgba(3, 7, 18, 0.78)';

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

    // Resolve the same target/threat identity used by the original state-vector code.
    const otherAgents = gameState.agents.filter(a => a.id !== agent.id);
    let target: AgentState | null = null;
    if (agent.status === AgentStatus.It) {
        const evaders = otherAgents.filter(a => a.status !== AgentStatus.It);
        if (evaders.length > 0) {
            target = evaders.reduce((closest, other) => {
                const d1 = Math.hypot(agent.position.x - closest.position.x, agent.position.y - closest.position.y);
                const d2 = Math.hypot(agent.position.x - other.position.x, agent.position.y - other.position.y);
                return d2 < d1 ? other : closest;
            });
        }
    } else {
        target = gameState.agents.find(a => a.status === AgentStatus.It) || null;
    }

    let teammate: AgentState | null = null;
    if (agent.status !== AgentStatus.It) {
        const teammates = otherAgents.filter(a => a.status !== AgentStatus.It);
        if (teammates.length > 0) {
            teammate = teammates.reduce((closest, other) => {
                const d1 = Math.hypot(agent.position.x - closest.position.x, agent.position.y - closest.position.y);
                const d2 = Math.hypot(agent.position.x - other.position.x, agent.position.y - other.position.y);
                return d2 < d1 ? other : closest;
            });
        }
    }

    const onPlatform = gameState.platforms.find(p => p.id === agent.lastPlatformId);
    const sortedPlatforms = gameState.platforms
        .filter(p => !onPlatform || p.id !== onPlatform.id)
        .map(p => {
            const platformCenterX = p.position.x + p.width / 2;
            const platformCenterY = p.position.y + p.height / 2;
            return {
                platform: p,
                distance: Math.hypot(platformCenterX - cx, platformCenterY - cy),
            };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

    let referencePlatform = onPlatform || null;
    if (!referencePlatform && gameState.platforms.length > 0) {
        referencePlatform = gameState.platforms[0];
        let minDist = Infinity;
        for (const p of gameState.platforms) {
            const pCenter = p.position.x + p.width / 2;
            const d = Math.hypot(pCenter - cx, p.position.y - agent.position.y);
            if (d < minDist) {
                minDist = d;
                referencePlatform = p;
            }
        }
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Target / threat channels: inputs 22..25.
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
        label(
            `T A${target.id} d(${state[22].toFixed(2)},${state[23].toFixed(2)}) v(${state[24].toFixed(2)},${state[25].toFixed(2)})`,
            (cx + tx) / 2,
            (cy + ty) / 2 - 10 * unit,
            'center',
        );
    }

    // Closest-teammate channels: inputs 26..29, meaningful for evaders.
    if (teammate) {
        const mx = teammate.position.x + AGENT_WIDTH / 2;
        const my = teammate.position.y + AGENT_HEIGHT / 2;
        ctx.setLineDash([6 * unit, 5 * unit]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(mx, my);
        ctx.lineWidth = 1.4 * unit;
        ctx.strokeStyle = medium;
        ctx.stroke();
        ctx.setLineDash([]);
        label(
            `M A${teammate.id} d(${state[26].toFixed(2)},${state[27].toFixed(2)}) v(${state[28].toFixed(2)},${state[29].toFixed(2)})`,
            (cx + mx) / 2,
            (cy + my) / 2 + 10 * unit,
            'center',
        );
    }

    // Three nearby-platform slots: inputs 13..21.
    sortedPlatforms.forEach(({ platform }, index) => {
        const base = 13 + index * 3;
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
            `P${index + 1} d(${state[base].toFixed(2)},${state[base + 1].toFixed(2)}) w${state[base + 2].toFixed(2)}`,
            platform.position.x + platform.width / 2,
            platform.position.y - (10 + index * 13) * unit,
            'center',
        );
    });

    // Explicit ledge channels: inputs 9..12.
    if (referencePlatform) {
        const leftX = referencePlatform.position.x;
        const rightX = referencePlatform.position.x + referencePlatform.width;
        const topY = referencePlatform.position.y;
        ctx.setLineDash([2 * unit, 3 * unit]);
        ctx.lineWidth = 1.25 * unit;
        ctx.strokeStyle = state[12] > 0 ? 'rgba(251, 191, 36, 0.86)' : faint;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(leftX, topY);
        ctx.moveTo(cx, cy);
        ctx.lineTo(rightX, topY);
        ctx.stroke();
        ctx.setLineDash([]);
        label(
            `LEDGE L${state[9].toFixed(2)} R${state[10].toFixed(2)} min${state[11].toFixed(2)} alert${state[12].toFixed(2)}`,
            referencePlatform.position.x + referencePlatform.width / 2,
            referencePlatform.position.y + referencePlatform.height + 11 * unit,
            'center',
        );
    }

    // Policy-camera boundary channels: inputs 6..8.
    ctx.setLineDash([2 * unit, 5 * unit]);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.beginPath();
    ctx.moveTo(leftEdge, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(rightEdge, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    label(`L ${state[6].toFixed(2)}`, leftEdge + 7 * unit, cy - 10 * unit, 'left');
    label(`R ${state[7].toFixed(2)}`, rightEdge - 7 * unit, cy - 10 * unit, 'right');

    const agentBottom = agent.position.y + AGENT_HEIGHT;
    const fallVisible = FALL_BOUNDARY >= gameState.cameraPosition.y && FALL_BOUNDARY <= visibleBottom;
    const fallEndY = fallVisible ? FALL_BOUNDARY : visibleBottom - 8 * unit;
    ctx.beginPath();
    ctx.moveTo(cx, agentBottom);
    ctx.lineTo(cx, fallEndY);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.stroke();
    label(
        `FALL${fallVisible ? '' : '↓'} ${state[8].toFixed(2)}`,
        cx + 7 * unit,
        Math.min(fallEndY - 10 * unit, cy + 62 * unit),
        'left',
    );

    // Self channels: inputs 0..5. Bias (input 38) is included for completeness.
    const role = state[4] > 0.5 ? 'C' : 'R';
    label(
        `A${agent.id} ${role} vx${state[0].toFixed(2)} vy${state[1].toFixed(2)} E${state[2].toFixed(2)} G${state[3].toFixed(0)} CD${state[5].toFixed(0)} B${state[38].toFixed(0)}`,
        cx,
        agent.position.y - 37 * unit,
        'center',
    );

    // Compact LiDAR readout uses the exact eight original inputs (30..37).
    label(
        `RAYS ${state.slice(30, 38).map(v => v.toFixed(2)).join(' ')}`,
        cx,
        agent.position.y - 52 * unit,
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