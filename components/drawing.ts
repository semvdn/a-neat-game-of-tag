

import type { PlatformState, AgentState, TagEffect, GameState } from '../types';
import { AgentStatus } from '../types';
import { AGENT_WIDTH, AGENT_HEIGHT } from '../constants';
import { canAgentUsePlatform } from '../learning/terrainRoutes';
import { drawPixelAgent } from './agentSprite';

export const drawTagEffect = (ctx: CanvasRenderingContext2D, effect: TagEffect) => {
    const progress = 1 - (effect.life / effect.initialLife);
    if (progress < 0 || progress > 1) return;

    const cx = effect.position.x + AGENT_WIDTH / 2;
    const cy = effect.position.y + AGENT_HEIGHT / 2;
    const distance = 8 + progress * 44;
    const opacity = 1 - progress;
    const particleColors = ['#f8fafc', '#e8bd31', '#d83b32'];

    ctx.save();
    ctx.globalAlpha = opacity;
    for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        const stagger = i % 3 === 0 ? 1.15 : 1;
        const x = Math.round(cx + Math.cos(angle) * distance * stagger);
        const y = Math.round(cy + Math.sin(angle) * distance * stagger);
        const size = i % 4 === 0 ? 7 : 4;
        ctx.fillStyle = particleColors[i % particleColors.length];
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    const coreSize = Math.max(2, Math.round((1 - progress) * 11));
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(cx - coreSize / 2, cy - coreSize / 2, coreSize, coreSize);
    ctx.restore();
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
 * Visualizes the exact compact 23-input world-relative policy state. No extra sensing is calculated here;
 * object lookup is used only to place labels/lines corresponding to already-computed inputs.
 */
export const drawAgentSenses = (
    ctx: CanvasRenderingContext2D,
    agent: AgentState,
    gameState: GameState,
    cameraScale: number,
) => {
    const state = agent.stateVector;
    if (!state || state.length < 23) return;

    const unit = 1 / Math.max(0.0001, cameraScale);
    const cx = agent.position.x + AGENT_WIDTH / 2;
    const cy = agent.position.y + AGENT_HEIGHT / 2;
    const primary = rgbaFromHex(agent.color, 0.92);
    const medium = rgbaFromHex(agent.color, 0.52);
    const faint = rgbaFromHex(agent.color, 0.24);
    const textBg = 'rgba(3, 7, 18, 0.78)';

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
        if (!canAgentUsePlatform(agent, p)) continue;
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

    // Target/threat channels: 17..20, with target/threat cooldown in channel 5.
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
            `T A${target.id} d(${state[17].toFixed(2)},${state[18].toFixed(2)}) v(${state[19].toFixed(2)},${state[20].toFixed(2)}) CD${state[5].toFixed(2)}`,
            (cx + tx) / 2,
            (cy + ty) / 2 - 10 * unit,
            'center',
        );
    }

    // Teammate position channels: 21..22.
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
        label(`M A${teammate.id} d(${state[21].toFixed(2)},${state[22].toFixed(2)})`, (cx + mx) / 2, (cy + my) / 2 + 10 * unit, 'center');
    }

    const semanticPlatforms: Array<{ platform: PlatformState | null; name: string; base: number }> = [
        { platform: ahead1, name: 'NEXT', base: 8 },
        { platform: ahead2, name: 'NEXT2', base: 11 },
        { platform: behind, name: 'PREV', base: 14 },
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

    // Current/reference ledges: 6..7.
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
        label(`LEDGE L${state[6].toFixed(2)} R${state[7].toFixed(2)}`, referencePlatform.position.x + referencePlatform.width / 2, referencePlatform.position.y + referencePlatform.height + 11 * unit, 'center');
    }

    // Camera position and viewport boundaries are intentionally absent from policy sensing.

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
  if (platform.motion) {
    // Thin center glyph makes moving terrain readable without adding a large UI overlay.
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (platform.motion.axis === 'x') {
      const cy = platform.position.y + platform.height / 2;
      ctx.moveTo(platform.position.x + platform.width * 0.35, cy);
      ctx.lineTo(platform.position.x + platform.width * 0.65, cy);
    } else {
      const cx = platform.position.x + platform.width / 2;
      ctx.moveTo(cx, platform.position.y + platform.height * 0.25);
      ctx.lineTo(cx, platform.position.y + platform.height * 0.75);
    }
    ctx.stroke();
  }
};

const drawItIndicator = (ctx: CanvasRenderingContext2D, agent: AgentState) => {
    const x = agent.position.x + AGENT_WIDTH / 2;
    const y = agent.position.y - 12;
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    // Pixel crown/chevron keeps the role marker legible without competing with the sprite palette.
    ctx.fillRect(x - 7, y, 4, 4);
    ctx.fillRect(x - 2, y - 4, 4, 4);
    ctx.fillRect(x + 3, y, 4, 4);
    ctx.fillRect(x - 7, y + 4, 14, 3);
    ctx.restore();
};

export const drawAgent = (ctx: CanvasRenderingContext2D, agent: AgentState, nowMs: number) => {
  drawPixelAgent(ctx, agent, nowMs);
  if (agent.status === AgentStatus.It) drawItIndicator(ctx, agent);
};
