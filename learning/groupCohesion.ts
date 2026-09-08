import type { AgentState } from '../types';
import { AgentStatus } from '../types';

/** World-space soft bands, not viewport bounds. No reward for contact or stationary clustering. */
export const GROUP_COHESION = { runnerComfortPx: 300, runnerFarPx: 700, chaseComfortPx: 600, chaseFarPx: 1000, penaltyCap: 6 } as const;
const excess = (distance: number, comfortable: number, far: number) => Math.max(0, Math.min(1, (distance - comfortable) / (far - comfortable)));
export function measureGroupCohesion(agents: AgentState[]) {
  const runners = agents.filter(a => a.status !== AgentStatus.It);
  const chaser = agents.find(a => a.status === AgentStatus.It);
  const distance = (a: AgentState, b: AgentState) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  const runnerDistance = runners.length > 1 ? distance(runners[0], runners[1]) : 0;
  const chaseDistance = chaser ? Math.max(0, ...runners.map(r => distance(chaser, r))) : 0;
  const runnerExcess = excess(runnerDistance, GROUP_COHESION.runnerComfortPx, GROUP_COHESION.runnerFarPx);
  const chaseExcess = excess(chaseDistance, GROUP_COHESION.chaseComfortPx, GROUP_COHESION.chaseFarPx);
  return { runnerDistance, groupDiameter: Math.max(runnerDistance, chaseDistance), runnerCost: Math.max(runnerExcess, chaseExcess), chaserCost: chaseExcess };
}
