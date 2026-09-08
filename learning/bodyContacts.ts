import type { AgentState, PlatformState } from '../types';
import { AgentStatus } from '../types';
import { AGENT_HEIGHT as H, AGENT_WIDTH as W, FALL_BOUNDARY } from '../constants';

const horizontalOverlap = (a: AgentState, b: AgentState) =>
  a.position.x + W > b.position.x + 0.001 && b.position.x + W > a.position.x + 0.001;

export function hasRunnerOnHead(body: AgentState, bodies: AgentState[]): boolean {
  return body.status !== AgentStatus.It && bodies.some(other => other.id !== body.id &&
    other.status !== AgentStatus.It && horizontalOverlap(body, other) &&
    Math.abs(other.position.y + H - body.position.y) < 1 && other.velocity.y >= body.velocity.y - 0.001);
}

/** Symmetric swept contacts after all individual terrain steps. Chasers never obstruct bodies.
 * There are exactly two Runner slots. Teleporting bodies are excluded from sweeps. */
export function resolveRunnerContacts(bodies: AgentState[], before: AgentState[], platforms: PlatformState[]): void {
  for (const body of bodies) body.supportingAgentId = null;
  const runners = bodies.filter(a => a.status !== AgentStatus.It).sort((a, b) => a.id - b.id);
  if (runners.length !== 2) return;
  const [a, b] = runners;
  const pa = before.find(p => p.id === a.id)!;
  const pb = before.find(p => p.id === b.id)!;
  if (!pa || !pb) return;
  const teleport = (p: AgentState, n: AgentState) => p.position.y > FALL_BOUNDARY ||
    Math.hypot(n.position.x - p.position.x, n.position.y - p.position.y) > 200;
  // Respawn overlap is resolved at the destination, never along the teleport path.
  const sa = teleport(pa, a) ? a : pa;
  const sb = teleport(pb, b) ? b : pb;
  const dx = (a.position.x - sa.position.x) - (b.position.x - sb.position.x);
  const dy = (a.position.y - sa.position.y) - (b.position.y - sb.position.y);
  const axis = (start: number, speed: number, size: number): [number, number] => {
    if (Math.abs(speed) < 1e-9) return Math.abs(start) < size ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const t1 = (-size - start) / speed, t2 = (size - start) / speed;
    return [Math.min(t1, t2), Math.max(t1, t2)];
  };
  const [tx, ex] = axis(sa.position.x - sb.position.x, dx, W);
  const [ty, ey] = axis(sa.position.y - sb.position.y, dy, H);
  const entry = Math.max(tx, ty), exit = Math.min(ex, ey);
  const swept = entry >= -1e-7 && entry <= 1 && entry <= exit;
  const overlapX = W - Math.abs(a.position.x - b.position.x);
  const overlapY = H - Math.abs(a.position.y - b.position.y);
  const overlapping = overlapX > 0 && overlapY > 0;
  if (!swept && !overlapping) return;
  const vertical = swept ? ty > tx : overlapY <= overlapX;
  if (vertical) {
    const aAbove = swept ? sa.position.y < sb.position.y : a.position.y < b.position.y;
    const upper = aAbove ? a : b, lower = aAbove ? b : a;
    const upperBefore = aAbove ? sa : sb, lowerBefore = aAbove ? sb : sa;
    if (!horizontalOverlap(upper, lower)) {
      if (!swept || entry <= 0) return; // Walking off an existing stack is allowed.
      const upperX = upperBefore.position.x + (upper.position.x - upperBefore.position.x) * entry;
      const lowerX = lowerBefore.position.x + (lower.position.x - lowerBefore.position.x) * entry;
      upper.position.x = upperX + lower.position.x - lowerX;
    }
    if (lower.velocity.y < 0 && lower.position.y - lowerBefore.position.y < upper.position.y - upperBefore.position.y) {
      // A rising body hits the underside; never shove the upper body through terrain.
      lower.position.y = upper.position.y + H;
      lower.velocity.y = Math.max(0, upper.velocity.y);
    } else {
      upper.position.y = lower.position.y - H;
      upper.velocity.y = lower.velocity.y;
      upper.isOnGround = lower.isOnGround;
      upper.supportingAgentId = lower.id;
      // A body is support, not a new terrain checkpoint or a rewarded platform landing.
      upper.lastPlatformId = upperBefore.lastPlatformId;
      upper.positionAtLastTakeoff.x = upperBefore.positionAtLastTakeoff.x;
      upper.positionAtLastTakeoff.y = upperBefore.positionAtLastTakeoff.y;
      upper.energyAtLastTakeoff = upperBefore.energyAtLastTakeoff;
    }
  } else {
    if (swept) {
      a.position.x = sa.position.x + (a.position.x - sa.position.x) * Math.max(0, entry);
      b.position.x = sb.position.x + (b.position.x - sb.position.x) * Math.max(0, entry);
    } else {
      const sign = a.position.x <= b.position.x ? -1 : 1;
      a.position.x += sign * overlapX / 2;
      b.position.x -= sign * overlapX / 2;
    }
    a.velocity.x = 0;
    b.velocity.x = 0;
  }
  // Pair correction may move a grounded body off a ledge. Never leave a ghost floor or bank a
  // pre-contact checkpoint beyond the corrected position.
  for (const body of runners) {
    if (!body.isOnGround || body.supportingAgentId != null) continue;
    const platform = platforms.find(p => p.id === body.lastPlatformId);
    if (!platform || body.position.x + W <= platform.position.x || body.position.x >= platform.position.x + platform.width || Math.abs(body.position.y + H - platform.position.y) > 0.001) {
      body.isOnGround = false;
      const previous = body.id === pa.id ? pa : pb;
      body.lastPlatformId = previous.lastPlatformId;
      body.positionAtLastTakeoff.x = previous.positionAtLastTakeoff.x;
      body.positionAtLastTakeoff.y = previous.positionAtLastTakeoff.y;
      body.energyAtLastTakeoff = previous.energyAtLastTakeoff;
    } else {
      body.positionAtLastTakeoff.x = body.position.x;
      body.positionAtLastTakeoff.y = body.position.y;
    }
  }
  for (const body of runners) {
    if (body.supportingAgentId != null) body.isOnGround = bodies.find(a => a.id === body.supportingAgentId)?.isOnGround ?? false;
  }
}
