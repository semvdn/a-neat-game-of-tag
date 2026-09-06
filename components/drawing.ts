

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

export const drawAgentTrail = (
    ctx: CanvasRenderingContext2D,
    agent: AgentState,
    nowMs: number,
    lifetimeMs = 3200
) => {
    if (!agent.trajectory || agent.trajectory.length < 2) return;

    const trailLength = agent.trajectory.length;
    const agentCenterOffsetX = AGENT_WIDTH / 2;
    const agentCenterOffsetY = AGENT_HEIGHT / 2;

    const normalizedColor = agent.color.replace('#', '');
    const r = parseInt(normalizedColor.slice(0, 2), 16) || 255;
    const g = parseInt(normalizedColor.slice(2, 4), 16) || 255;
    const b = parseInt(normalizedColor.slice(4, 6), 16) || 255;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < trailLength - 1; i++) {
        const startPoint = agent.trajectory[i];
        const endPoint = agent.trajectory[i + 1];

        // Segment age, rather than buffer position, is the primary fade control. This makes
        // a trail dissipate even when no additional movement samples are being appended.
        const ageMs = Math.max(0, nowMs - endPoint.timestamp);
        const life = Math.max(0, Math.min(1, 1 - ageMs / lifetimeMs));
        if (life <= 0) continue;

        // Keep a small spatial taper as a readability aid, but never let it override time fade.
        const spatialRecency = (i + 1) / (trailLength - 1);
        const opacity = life * (0.18 + spatialRecency * 0.62);
        const lineWidth = 1.25 + spatialRecency * 3.25;

        ctx.beginPath();
        ctx.moveTo(startPoint.x + agentCenterOffsetX, startPoint.y + agentCenterOffsetY);
        ctx.lineTo(endPoint.x + agentCenterOffsetX, endPoint.y + agentCenterOffsetY);
        ctx.lineWidth = lineWidth;
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
 * Visualizes the exact compact 25-input policy state. No extra sensing is calculated here;
 * object lookup is used only to place labels/lines corresponding to already-computed inputs.
 */
export const drawAgentSenses = (
    ctx: CanvasRenderingContext2D,
    agent: AgentState,
    gameState: GameState,
    cameraScale: number,
) => {
    const state = agent.stateVector;
    if (!state || state.length < 25) return;

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

    // Resolve target/threat and teammate identity using the same role semantics as state.ts.
    let itAgent: AgentState | null = null;
    let target: AgentState | null = null;
    let teammate: AgentState | null = null;
    let targetDistSq = Infinity;
    let teammateDistSq = Infinity;
    for (const other of gameState.agents) {
        if (other.status === AgentStatus.It) itAgent = other;
        if (other.id === agent.id) continue;
        const dx = other.position.x - agent.position.x;
        const dy = other.position.y - agent.position.y;
        const d2 = dx * dx + dy * dy;
        if (agent.status === AgentStatus.It) {
            if (other.status !== AgentStatus.It && d2 < targetDistSq) {
                target = other;
                targetDistSq = d2;
            }
        } else if (other.status !== AgentStatus.It && d2 < teammateDistSq) {
            teammate = other;
            teammateDistSq = d2;
        }
    }
    if (agent.status !== AgentStatus.It) target = itAgent;

    let referencePlatform: PlatformState | null = null;
    let referenceDistSq = Infinity;
    for (const p of gameState.platforms) {
        if (p.id === agent.lastPlatformId) {
            referencePlatform = p;
            referenceDistSq = -1;
            break;
        }
        const px = p.position.x + p.width / 2;
        const dx = px - cx;
        const dy = p.position.y - agent.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < referenceDistSq) {
            referencePlatform = p;
            referenceDistSq = d2;
        }
    }

    let ahead1: PlatformState | null = null;
    let ahead2: PlatformState | null = null;
    let behind: PlatformState | null = null;
    let ahead1Dx = Infinity;
    let ahead2Dx = Infinity;
    let behindDx = Infinity;
    for (const p of gameState.platforms) {
        if (referencePlatform && p.id === referencePlatform.id) continue;
        const dx = p.position.x + p.width / 2 - cx;
        if (dx >= 0) {
            if (dx < ahead1Dx) {
                ahead2 = ahead1;
                ahead2Dx = ahead1Dx;
                ahead1 = p;
                ahead1Dx = dx;
            } else if (dx < ahead2Dx) {
                ahead2 = p;
                ahead2Dx = dx;
            }
        } else if (-dx < behindDx) {
            behind = p;
            behindDx = -dx;
        }
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Target/threat channels: 19..22.
    if (target) {
        const tx = target.position.x + AGENT_WIDTH / 2;
        const ty = target.position.y + AGENT_HEIGHT / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.lineWidth = 2.0 * unit;
        ctx.strokeStyle = primary;
        ctx.stroke();
        label(
            `T A${target.id} d(${state[19].toFixed(2)},${state[20].toFixed(2)}) v(${state[21].toFixed(2)},${state[22].toFixed(2)})`,
            (cx + tx) / 2,
            (cy + ty) / 2 - 10 * unit,
            'center',
        );
    }

    // Teammate position channels: 23..24.
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
        label(`M A${teammate.id} d(${state[23].toFixed(2)},${state[24].toFixed(2)})`, (cx + mx) / 2, (cy + my) / 2 + 10 * unit, 'center');
    }

    const semanticPlatforms: Array<{ platform: PlatformState | null; name: string; base: number }> = [
        { platform: ahead1, name: 'NEXT', base: 10 },
        { platform: ahead2, name: 'NEXT2', base: 13 },
        { platform: behind, name: 'PREV', base: 16 },
    ];
    semanticPlatforms.forEach(({ platform, name, base }, index) => {
        if (!platform) return;
        const px = platform.position.x + platform.width / 2;
        const py = platform.position.y + platform.height / 2;
        ctx.setLineDash([3 * unit, 4 * unit]);
        ctx.lineWidth = 1.1 * unit;
        ctx.strokeStyle = medium;
        ctx.strokeRect(platform.position.x - 2 * unit, platform.position.y - 2 * unit, platform.width + 4 * unit, platform.height + 4 * unit);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        label(`${name} d(${state[base].toFixed(2)},${state[base + 1].toFixed(2)}) w${state[base + 2].toFixed(2)}`, platform.position.x + platform.width / 2, platform.position.y - (10 + index * 13) * unit, 'center');
    });

    // Current/reference ledges: 8..9.
    if (referencePlatform) {
        const leftX = referencePlatform.position.x;
        const rightX = referencePlatform.position.x + referencePlatform.width;
        const topY = referencePlatform.position.y;
        ctx.setLineDash([2 * unit, 3 * unit]);
        ctx.lineWidth = 1.25 * unit;
        ctx.strokeStyle = faint;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(leftX, topY);
        ctx.moveTo(cx, cy);
        ctx.lineTo(rightX, topY);
        ctx.stroke();
        ctx.setLineDash([]);
        label(`LEDGE L${state[8].toFixed(2)} R${state[9].toFixed(2)}`, referencePlatform.position.x + referencePlatform.width / 2, referencePlatform.position.y + referencePlatform.height + 11 * unit, 'center');
    }

    // Policy-camera/fall boundaries: 5..7.
    ctx.setLineDash([2 * unit, 5 * unit]);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.beginPath();
    ctx.moveTo(leftEdge, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(rightEdge, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    label(`L ${state[5].toFixed(2)}`, leftEdge + 7 * unit, cy - 10 * unit, 'left');
    label(`R ${state[6].toFixed(2)}`, rightEdge - 7 * unit, cy - 10 * unit, 'right');

    const agentBottom = agent.position.y + AGENT_HEIGHT;
    const fallVisible = FALL_BOUNDARY >= gameState.cameraPosition.y && FALL_BOUNDARY <= visibleBottom;
    const fallEndY = fallVisible ? FALL_BOUNDARY : visibleBottom - 8 * unit;
    ctx.beginPath();
    ctx.moveTo(cx, agentBottom);
    ctx.lineTo(cx, fallEndY);
    ctx.lineWidth = 1.0 * unit;
    ctx.strokeStyle = faint;
    ctx.stroke();
    label(`FALL${fallVisible ? '' : '↓'} ${state[7].toFixed(2)}`, cx + 7 * unit, Math.min(fallEndY - 10 * unit, cy + 62 * unit), 'left');

    // Self channels: 0..4. Role is displayed from actual game status, not as a redundant input.
    const role = agent.status === AgentStatus.It ? 'C' : 'R';
    label(`A${agent.id} ${role} vx${state[0].toFixed(2)} vy${state[1].toFixed(2)} E${state[2].toFixed(2)} G${state[3].toFixed(0)} CD${state[4].toFixed(0)}`, cx, agent.position.y - 37 * unit, 'center');

    ctx.restore();
};

export const drawPlatform = (ctx: CanvasRenderingContext2D, platform: PlatformState) => {
  // Branch routes are subtly differentiated so route choices are readable without turning the
  // environment into a UI overlay. The merge returns to the normal visual language.
  if (platform.structureType === 'branch-upper') ctx.fillStyle = '#52667a';
  else if (platform.structureType === 'branch-lower') ctx.fillStyle = '#465b68';
  else if (platform.structureType === 'merge') ctx.fillStyle = '#56616d';
  else ctx.fillStyle = '#4a5568';
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