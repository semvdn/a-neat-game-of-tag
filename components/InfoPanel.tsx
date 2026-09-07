

import React from 'react';
import type { AgentState, RewardBreakdown, TrainingFitnessConfig, UpgradeConfig, UpgradeMode, UpgradeRule, SprintUpgradeRule, SprintRoleAdvanced, TerrainVarietyConfig } from '../types';
import { AgentStatus } from '../types';
import { Radar, Shield, Swords, Zap, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { MAX_SPEED, SPRINT_MAX_SPEED, SPRINT_ENERGY_COST_PER_SEC, MIN_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_REWARD_PER_WINDOW, MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM } from '../constants';

interface InfoPanelProps {
  agents: AgentState[];
  isSimulating: boolean;
  showTrails: boolean;
  onToggleTrails: () => void;
  showSenses: boolean;
  onToggleSenses: () => void;
  onOpenDiagnostics: () => void;
  chaserElo?: number;
  evaderElo?: number;
  upgradeConfig: UpgradeConfig;
  sprintUpgradeActive: boolean;
  controlledJumpUpgradeActive: boolean;
  onUpdateUpgrade: (upgrade: keyof UpgradeConfig, patch: Partial<UpgradeRule> | Partial<SprintUpgradeRule>) => void;
  trainingFitnessConfig: TrainingFitnessConfig;
  onUpdateTrainingFitnessConfig: (patch: Partial<TrainingFitnessConfig>) => void;
  terrainVarietyConfig: TerrainVarietyConfig;
  onUpdateTerrainVarietyConfig: (patch: Partial<TerrainVarietyConfig>) => void;
}

const statusColors: Record<AgentStatus, string> = {
    [AgentStatus.It]: 'bg-red-500 text-white',
    [AgentStatus.Normal]: 'bg-blue-500 text-white',
    [AgentStatus.Cooldown]: 'bg-gray-500 text-white',
}

const ToggleSwitch: React.FC<{ id: string; checked: boolean; onChange: () => void; }> = ({ id, checked, onChange }) => (
    <label htmlFor={id} className="flex items-center cursor-pointer">
        <div className="relative">
            <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
            <div className="block bg-gray-600 w-14 h-8 rounded-full"></div>
            <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${checked ? 'transform translate-x-6 bg-cyan-400' : ''}`}></div>
        </div>
    </label>
);

const RoleToggle: React.FC<{ id: string; label: string; checked: boolean; onChange: () => void }> = ({ id, label, checked, onChange }) => (
  <label htmlFor={id} className={`flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1.5 text-[10px] transition-colors ${checked ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' : 'border-gray-700 bg-gray-950/60 text-gray-500'}`}>
    <span className="font-semibold">{label}</span>
    <span className="relative h-4 w-7 shrink-0 rounded-full bg-gray-700">
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`}></span>
    </span>
  </label>
);

const stateVectorLabels = [
    // Self (5)
    { label: 'Vel X' }, { label: 'Vel Y' }, { label: 'Energy' }, { label: 'Ground' }, { label: 'Self CD' },
    // Policy frame + target cooldown (3)
    { label: 'Screen Left' }, { label: 'Screen Right' }, { label: 'Target CD' },
    // Current/reference platform ledges (2)
    { label: 'L-Ledge' }, { label: 'R-Ledge' },
    // Stable semantic platforms (9): next, second-next, previous
    { label: 'Next dX' }, { label: 'Next dY' }, { label: 'Next Width' },
    { label: 'Next2 dX' }, { label: 'Next2 dY' }, { label: 'Next2 Width' },
    { label: 'Prev dX' }, { label: 'Prev dY' }, { label: 'Prev Width' },
    // Target / threat dynamics (4)
    { label: 'Tgt dX' }, { label: 'Tgt dY' }, { label: 'Tgt Vel X' }, { label: 'Tgt Vel Y' },
    // Closest teammate position (2)
    { label: 'Mate dX' }, { label: 'Mate dY' },
];

const rewardTermOrder = [
    // Tagger Rewards & Penalties
    'successfulTag',
    'closingDistance',
    'proximityToTarget',
    'timePenalty',
    // Evader Rewards & Penalties
    'wasTagged',
    'increasingDistance',
    'distanceFromTagger',
    'survival',
    // Left-Side Boundary & Rightward Flow Reward Terms
    'leftBoundaryTouchPenalty',
    'leftBoundaryPushPenalty',
    'leftBoundaryProximityPenalty',
    'rightwardVelocityReward',
    'rightwardProgressionReward',
    'successfulJump',
    'stayOnPlatform',
    'fallPenalty',
    'highEnergyUse',
    'inactivity',
    'highEnergy',
];

const VectorBar: React.FC<{label: string, value: number}> = ({label, value}) => {
    const clampedValue = Math.max(-1, Math.min(1, value));
    const isBoolean = label === 'Ground';
    const isUnipolar = isBoolean || label === 'Energy' || label === 'Self CD' || label === 'Target CD' || label.includes('Width') || label.includes('Ledge') || label.startsWith('Screen ');
    const barColor = isUnipolar
        ? (value > 0.001 ? '#22c55e' : 'transparent')
        : (clampedValue >= 0.01 ? '#22c55e' : (clampedValue <= -0.01 ? '#ef4444' : 'transparent'));
    
    return (
        <div title={`${label}: ${value.toFixed(3)}`} className="flex items-center justify-between text-gray-300 text-xs">
            <span className="w-20 truncate" title={label}>{label}</span>
            <div className="flex-1 h-3 bg-gray-800 rounded-sm relative mx-2">
                {!isUnipolar && <div className="absolute top-0 left-1/2 w-px h-full bg-gray-600"></div>}
                <div 
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                        left: isUnipolar ? '0%' : (clampedValue > 0 ? '50%' : `calc(50% - ${Math.abs(clampedValue) * 50}%)`),
                        width: isUnipolar ? `${Math.max(0, clampedValue) * 100}%` : `${Math.abs(clampedValue) * 50}%`,
                        backgroundColor: barColor,
                    }}
                ></div>
            </div>
            <span className="w-10 text-right font-mono">{value.toFixed(2)}</span>
        </div>
    );
};

const UpgradeControl: React.FC<{
  title: string;
  description: string;
  icon: React.ReactNode;
  rule: UpgradeRule;
  active: boolean;
  onChange: (patch: Partial<UpgradeRule>) => void;
}> = ({ title, description, icon, rule, active, onChange }) => {
  const modes: UpgradeMode[] = ['off', 'on'];
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-gray-700 bg-gray-800/70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-2">
          <div className={active ? 'text-emerald-300' : 'text-gray-500'}>{icon}</div>
          <div>
            <div className="text-xs font-bold text-gray-200">{title}</div>
            <div className="text-[10px] leading-relaxed text-gray-500">{description}</div>
          </div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-900 text-gray-500'}`}>
          {active ? 'enabled' : 'disabled'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-gray-950 p-1">
        {modes.map(mode => (
          <button
            key={mode}
            onClick={() => onChange({ mode })}
            className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${rule.mode === mode ? 'bg-cyan-500 text-black' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          >
            {mode}
          </button>
        ))}
      </div>
      {rule.mode === 'on' && (
        <div className="mt-2">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">Enabled role</div>
          <div className="grid grid-cols-2 gap-1.5">
            <RoleToggle
              id={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-chaser`}
              label="Chaser"
              checked={rule.chaserEnabled}
              onChange={() => onChange({ chaserEnabled: !rule.chaserEnabled })}
            />
            <RoleToggle
              id={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-runner`}
              label="Runner"
              checked={rule.runnerEnabled}
              onChange={() => onChange({ runnerEnabled: !rule.runnerEnabled })}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const SprintRoleAdvancedMenu: React.FC<{
  role: 'Chaser' | 'Runner';
  tuning: SprintRoleAdvanced;
  onChange: (next: SprintRoleAdvanced) => void;
}> = ({ role, tuning, onChange }) => {
  const setNumber = (key: 'maxSpeed' | 'staminaCostPerSec', value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    if (key === 'maxSpeed') onChange({ ...tuning, maxSpeed: Math.max(MAX_SPEED, Math.min(20, parsed)) });
    else onChange({ ...tuning, staminaCostPerSec: Math.max(0, Math.min(200, parsed)) });
  };

  const effectiveSpeed = tuning.maxSpeedOverride ? tuning.maxSpeed : SPRINT_MAX_SPEED;
  const effectiveCost = tuning.staminaCostOverride ? tuning.staminaCostPerSec : SPRINT_ENERGY_COST_PER_SEC;

  return (
    <details className="group rounded-md border border-gray-700/80 bg-gray-950/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[10px] text-gray-400 hover:text-gray-200">
        <span className="flex items-center gap-1.5 font-semibold"><SlidersHorizontal className="h-3 w-3" /> Advanced · {role}</span>
        <span className="font-mono text-[9px] text-gray-500">{effectiveSpeed.toFixed(2)} max · {effectiveCost.toFixed(1)}/s</span>
      </summary>
      <div className="space-y-2 border-t border-gray-800 p-2.5">
        <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
          <RoleToggle
            id={`sprint-${role.toLowerCase()}-custom-max-speed`}
            label="Override max sprint speed"
            checked={tuning.maxSpeedOverride}
            onChange={() => onChange({ ...tuning, maxSpeedOverride: !tuning.maxSpeedOverride })}
          />
          {tuning.maxSpeedOverride && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
              <label className="text-gray-500">Max speed</label>
              <input
                type="number"
                min={MAX_SPEED}
                max={20}
                step={0.25}
                value={tuning.maxSpeed}
                onChange={e => setNumber('maxSpeed', e.target.value)}
                className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-right font-mono text-gray-200 outline-none focus:border-cyan-500"
              />
            </div>
          )}
          {!tuning.maxSpeedOverride && <div className="mt-1.5 text-[9px] text-gray-600">Default: {SPRINT_MAX_SPEED.toFixed(2)}</div>}
        </div>

        <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
          <RoleToggle
            id={`sprint-${role.toLowerCase()}-custom-stamina-cost`}
            label="Override stamina cost"
            checked={tuning.staminaCostOverride}
            onChange={() => onChange({ ...tuning, staminaCostOverride: !tuning.staminaCostOverride })}
          />
          {tuning.staminaCostOverride && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
              <label className="text-gray-500">Cost / sec at full sprint</label>
              <input
                type="number"
                min={0}
                max={200}
                step={1}
                value={tuning.staminaCostPerSec}
                onChange={e => setNumber('staminaCostPerSec', e.target.value)}
                className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-right font-mono text-gray-200 outline-none focus:border-cyan-500"
              />
            </div>
          )}
          {!tuning.staminaCostOverride && <div className="mt-1.5 text-[9px] text-gray-600">Default: {SPRINT_ENERGY_COST_PER_SEC.toFixed(1)} stamina/sec</div>}
        </div>
        <div className="text-[9px] leading-relaxed text-gray-600">Sprint output strength still scales continuously from base speed {MAX_SPEED.toFixed(2)} to this max. Effective sprint drains stamina; holding Sprint high while not using it blocks stamina regeneration, so permanently saturated Sprint is no longer free.</div>
      </div>
    </details>
  );
};

const SprintAdvancedMenus: React.FC<{
  rule: SprintUpgradeRule;
  onChange: (patch: Partial<SprintUpgradeRule>) => void;
}> = ({ rule, onChange }) => {
  if (rule.mode === 'off') return null;
  if (!rule.chaserEnabled && !rule.runnerEnabled) return null;
  return (
    <div className="-mt-1 space-y-1.5 rounded-b-lg border-x border-b border-gray-700/60 bg-gray-900/40 px-2 pb-2 pt-2">
      <div className="px-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">Sprint role tuning</div>
      {rule.chaserEnabled && (
        <SprintRoleAdvancedMenu
          role="Chaser"
          tuning={rule.chaserAdvanced}
          onChange={chaserAdvanced => onChange({ chaserAdvanced })}
        />
      )}
      {rule.runnerEnabled && (
        <SprintRoleAdvancedMenu
          role="Runner"
          tuning={rule.runnerAdvanced}
          onChange={runnerAdvanced => onChange({ runnerAdvanced })}
        />
      )}
    </div>
  );
};

const StateVectorDisplay: React.FC<{ vector: number[] }> = ({ vector }) => {
    if (!vector || vector.length === 0) return null;
    return (
        <details className="mt-3 group">
            <summary className="text-xs font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors">
                State Vector (Brain Inputs)
            </summary>
            <div className="mt-2 space-y-1 pr-1">
                {stateVectorLabels.map((info, index) => (
                     <VectorBar key={`${info.label}-${index}`} label={info.label} value={vector[index] === undefined ? 0 : vector[index]} />
                ))}
            </div>
        </details>
    );
};

const RewardBar: React.FC<{label: string, value: number}> = ({label, value}) => {
  const MAX_VISUAL_REWARD = 5;
  const normalizedValue = Math.max(-1, Math.min(1, value / MAX_VISUAL_REWARD));
  const barColor = value > 0.001 ? '#22c55e' : value < -0.001 ? '#ef4444' : 'transparent';
  
  // Format camelCase label to 'Normal Case' for display
  const displayLabel = label.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  
  return (
      <div title={`${displayLabel}: ${value.toFixed(3)}`} className="flex items-center justify-between text-gray-300 text-xs">
          <span className="w-20 truncate" title={displayLabel}>{displayLabel}</span>
          <div className="flex-1 h-3 bg-gray-800 rounded-sm relative mx-2">
              <div className="absolute top-0 left-1/2 w-px h-full bg-gray-600"></div>
              <div 
                  className="absolute top-0 h-full rounded-sm"
                  style={{
                      left: normalizedValue > 0 ? '50%' : `calc(50% - ${Math.abs(normalizedValue) * 50}%)`,
                      width: `${Math.abs(normalizedValue) * 50}%`,
                      backgroundColor: barColor,
                  }}
              ></div>
          </div>
          <span className="w-10 text-right font-mono">{value.toFixed(2)}</span>
      </div>
  );
};

const RewardBreakdownDisplay: React.FC<{ breakdown: RewardBreakdown, status: AgentStatus }> = ({ breakdown, status }) => {
    if (!breakdown) return null;

    const totalReward = Object.values(breakdown).reduce<number>((s, v) => s + (Number(v) || 0), 0);
    
    const taggerTerms = ['successfulTag', 'closingDistance', 'timePenalty', 'proximityToTarget'];
    const evaderTerms = ['wasTagged', 'increasingDistance', 'survival', 'distanceFromTagger'];

    const relevantTerms = rewardTermOrder.filter(term => {
        if (status === AgentStatus.It) {
            return !evaderTerms.includes(term);
        }
        // Normal and Cooldown are treated as evaders for display purposes
        return !taggerTerms.includes(term);
    });

    return (
        <details className="mt-3 group">
            <summary className="text-xs font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors flex justify-between">
                <span>Visual heuristic · not training fitness</span>
                <span className={`font-mono ${totalReward > 0 ? 'text-green-400' : totalReward < 0 ? 'text-red-400' : ''}`}>
                    Visual total: {totalReward.toFixed(2)}
                </span>
            </summary>
            <div className="mt-2 space-y-1 pr-1">
                {relevantTerms.map(term => (
                    <RewardBar key={term} label={term} value={breakdown[term] || 0} />
                ))}
            </div>
        </details>
    );
};


export const InfoPanel: React.FC<InfoPanelProps> = ({
  agents,
  isSimulating,
  showTrails,
  onToggleTrails,
  showSenses,
  onToggleSenses,
  onOpenDiagnostics,
  chaserElo,
  evaderElo,
  upgradeConfig,
  sprintUpgradeActive,
  controlledJumpUpgradeActive,
  onUpdateUpgrade,
  trainingFitnessConfig,
  onUpdateTrainingFitnessConfig,
  terrainVarietyConfig,
  onUpdateTerrainVarietyConfig,
}) => {
  return (
    <aside className="w-80 bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col gap-4 overflow-y-auto">
      <h2 className="text-xl font-bold text-cyan-400 border-b-2 border-cyan-400/30 pb-2">Simulation Status</h2>
      

      <div className="flex justify-between items-center p-3 bg-gray-700 rounded-md">
        <h3 className="font-semibold text-gray-300">Show Trails</h3>
        <ToggleSwitch id="trails-toggle" checked={showTrails} onChange={onToggleTrails} />
      </div>

      <div className="flex justify-between items-center p-3 bg-gray-700 rounded-md">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-cyan-400" />
          <div>
            <h3 className="font-semibold text-gray-300">Agent Senses</h3>
            <p className="text-[10px] text-gray-400">23-D world-relative brain inputs · no redundant LiDAR · press S</p>
          </div>
        </div>
        <ToggleSwitch id="senses-toggle" checked={showSenses} onChange={onToggleSenses} />
      </div>

      <details className="rounded-lg border border-violet-500/25 bg-violet-950/10 p-3" open>
        <summary className="cursor-pointer list-none text-xs font-bold text-violet-200 flex items-center justify-between">
          <span className="flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Terrain variety</span>
          <span className="text-[9px] font-normal text-gray-500">training + continuous</span>
        </summary>
        <p className="mt-1 text-[9px] leading-relaxed text-gray-500">
          Branches are true exclusive routes: landing commits an agent to that route until its merge. Nested branches can split a committed route again.
        </p>

        <div className="mt-3 space-y-3">
          <div className="rounded border border-gray-700 bg-gray-950/40 p-2.5 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Training episodes</div>
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-[10px] text-gray-300">Branching paths</div><div className="text-[9px] text-gray-600">Enable route-tree episodes</div></div>
              <ToggleSwitch id="training-branches" checked={terrainVarietyConfig.trainingBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ trainingBranchingEnabled: !terrainVarietyConfig.trainingBranchingEnabled })} />
            </div>
            {terrainVarietyConfig.trainingBranchingEnabled && <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Episodes containing branches</span><span className="font-mono text-cyan-300">{terrainVarietyConfig.trainingBranchingEpisodePercent.toFixed(0)}%</span></div>
              <input className="w-full" type="range" min={0} max={100} step={5} value={terrainVarietyConfig.trainingBranchingEpisodePercent} onChange={e => onUpdateTerrainVarietyConfig({ trainingBranchingEpisodePercent: Number(e.target.value) })} />
            </div>}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-800">
              <div><div className="text-[10px] text-gray-300">Moving platforms</div><div className="text-[9px] text-gray-600">Enable motion-enabled episodes</div></div>
              <ToggleSwitch id="training-moving" checked={terrainVarietyConfig.trainingMovingPlatformsEnabled} onChange={() => onUpdateTerrainVarietyConfig({ trainingMovingPlatformsEnabled: !terrainVarietyConfig.trainingMovingPlatformsEnabled })} />
            </div>
            {terrainVarietyConfig.trainingMovingPlatformsEnabled && <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Episodes containing moving platforms</span><span className="font-mono text-cyan-300">{terrainVarietyConfig.trainingMovingEpisodePercent.toFixed(0)}%</span></div>
              <input className="w-full" type="range" min={0} max={100} step={5} value={terrainVarietyConfig.trainingMovingEpisodePercent} onChange={e => onUpdateTerrainVarietyConfig({ trainingMovingEpisodePercent: Number(e.target.value) })} />
            </div>}
          </div>

          <div className="rounded border border-gray-700 bg-gray-950/40 p-2.5 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Continuous champion view</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-300">Branching paths</span>
              <ToggleSwitch id="continuous-branches" checked={terrainVarietyConfig.continuousBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ continuousBranchingEnabled: !terrainVarietyConfig.continuousBranchingEnabled })} />
            </div>
            {terrainVarietyConfig.continuousBranchingEnabled && <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Branch spawn chance</span><span className="font-mono text-amber-300">{terrainVarietyConfig.continuousBranchSpawnPercent.toFixed(0)}%</span></div>
              <input className="w-full" type="range" min={0} max={75} step={1} value={terrainVarietyConfig.continuousBranchSpawnPercent} onChange={e => onUpdateTerrainVarietyConfig({ continuousBranchSpawnPercent: Number(e.target.value) })} />
            </div>}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-800">
              <span className="text-[10px] text-gray-300">Moving platforms</span>
              <ToggleSwitch id="continuous-moving" checked={terrainVarietyConfig.continuousMovingPlatformsEnabled} onChange={() => onUpdateTerrainVarietyConfig({ continuousMovingPlatformsEnabled: !terrainVarietyConfig.continuousMovingPlatformsEnabled })} />
            </div>
            {terrainVarietyConfig.continuousMovingPlatformsEnabled && <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Moving-platform spawn chance</span><span className="font-mono text-amber-300">{terrainVarietyConfig.continuousMovingSpawnPercent.toFixed(0)}%</span></div>
              <input className="w-full" type="range" min={0} max={80} step={1} value={terrainVarietyConfig.continuousMovingSpawnPercent} onChange={e => onUpdateTerrainVarietyConfig({ continuousMovingSpawnPercent: Number(e.target.value) })} />
            </div>}
          </div>

          <div className="rounded border border-gray-700 bg-gray-950/40 p-2.5 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-300">Branch complexity</div>
            <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Max platforms per route</span><span className="font-mono text-violet-300">{terrainVarietyConfig.maxPlatformsPerBranch}</span></div>
              <input className="w-full" type="range" min={1} max={6} step={1} value={terrainVarietyConfig.maxPlatformsPerBranch} onChange={e => onUpdateTerrainVarietyConfig({ maxPlatformsPerBranch: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-[10px] text-gray-300">Sub-branching</div><div className="text-[9px] text-gray-600">Allow routes to split again</div></div>
              <ToggleSwitch id="sub-branching" checked={terrainVarietyConfig.subBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ subBranchingEnabled: !terrainVarietyConfig.subBranchingEnabled })} />
            </div>
            {terrainVarietyConfig.subBranchingEnabled && <div>
              <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Maximum branch depth</span><span className="font-mono text-violet-300">{terrainVarietyConfig.maxBranchDepth}</span></div>
              <input className="w-full" type="range" min={1} max={4} step={1} value={terrainVarietyConfig.maxBranchDepth} onChange={e => onUpdateTerrainVarietyConfig({ maxBranchDepth: Number(e.target.value) })} />
            </div>}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-800">
              <div><div className="text-[10px] text-gray-300">Moving platforms in branches</div><div className="text-[9px] text-gray-600">Route platforms may oscillate; merges stay fixed</div></div>
              <ToggleSwitch id="moving-in-branches" checked={terrainVarietyConfig.movingPlatformsInBranches} onChange={() => onUpdateTerrainVarietyConfig({ movingPlatformsInBranches: !terrainVarietyConfig.movingPlatformsInBranches })} />
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-[9px]"><span className="text-gray-500">Maximum moving-platform speed</span><span className="font-mono text-cyan-300">{terrainVarietyConfig.movingPlatformMaxSpeed.toFixed(0)} px/s</span></div>
            <input className="w-full" type="range" min={0} max={180} step={5} value={terrainVarietyConfig.movingPlatformMaxSpeed} onChange={e => onUpdateTerrainVarietyConfig({ movingPlatformMaxSpeed: Number(e.target.value) })} />
          </div>
        </div>
      </details>

      <div className="space-y-2">
        <div>
          <h3 className="font-semibold text-gray-300">Manual Abilities</h3>
          <p className="text-[10px] text-gray-500">Sprint and controlled jump change only when you enable or disable them.</p>
        </div>
        <UpgradeControl
          title="Sprint"
          description="Raises top speed and acceleration up to 35%; the independent Sprint output controls intensity. Effective sprint costs stamina, and Sprint must be released to regenerate it, so timing the output matters."
          icon={<Zap className="w-4 h-4" />}
          rule={upgradeConfig.sprint}
          active={sprintUpgradeActive}
          onChange={patch => onUpdateUpgrade('sprint', patch)}
        />
        <SprintAdvancedMenus
          rule={upgradeConfig.sprint}
          onChange={patch => onUpdateUpgrade('sprint', patch)}
        />
        <UpgradeControl
          title="Controlled Jump"
          description="The independent Jump output controls 45–100% of the jump impulse while horizontal drive remains active. After a jump, the output must release below the low threshold before another jump can fire."
          icon={<ArrowUp className="w-4 h-4" />}
          rule={upgradeConfig.controlledJump}
          active={controlledJumpUpgradeActive}
          onChange={patch => onUpdateUpgrade('controlledJump', patch)}
        />
      </div>

      <div className="rounded-lg border border-cyan-500/25 bg-cyan-950/10 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-cyan-200">Gameplay pace shaping</h3>
            <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
              Runners earn a capped reward for meeting a modest safe-right pace every 2 seconds. Going faster than the target earns nothing extra, leaving room to dodge, reverse, wait for terrain, and choose routes. Chasers get a small capped reward for safely reaching platforms already used by a Runner.
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-gray-400">Runner pace target / 2s</span><span className="font-mono text-cyan-300">{trainingFitnessConfig.runnerPaceTargetPxPerWindow.toFixed(0)} px</span></div>
            <input type="range" min={MIN_RUNNER_PACE_TARGET_PX} max={MAX_RUNNER_PACE_TARGET_PX} step={10} value={trainingFitnessConfig.runnerPaceTargetPxPerWindow} onChange={e => onUpdateTrainingFitnessConfig({ runnerPaceTargetPxPerWindow: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-gray-400">Runner max reward / window</span><span className="font-mono text-cyan-300">+{trainingFitnessConfig.runnerPaceRewardPerWindow.toFixed(1)}</span></div>
            <input type="range" min={0} max={MAX_RUNNER_PACE_REWARD_PER_WINDOW} step={1} value={trainingFitnessConfig.runnerPaceRewardPerWindow} onChange={e => onUpdateTrainingFitnessConfig({ runnerPaceRewardPerWindow: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-gray-400">Chaser follow reward / platform</span><span className="font-mono text-amber-300">+{trainingFitnessConfig.chaserPursuitRewardPerPlatform.toFixed(1)}</span></div>
            <input type="range" min={0} max={MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM} step={0.5} value={trainingFitnessConfig.chaserPursuitRewardPerPlatform} onChange={e => onUpdateTrainingFitnessConfig({ chaserPursuitRewardPerPlatform: Number(e.target.value) })} className="w-full" />
          </div>
        </div>

        <p className="mt-2 text-[9px] leading-relaxed text-gray-600">
          Default pace is 260 px per 2 seconds with +15 maximum reward. Missing pace is no longer free: the unsatisfied fraction also carries a shortfall penalty equal to two-thirds of the configured reward scale. The Chaser follow reward is capped at +5 per 2-second window, so actual tags remain much more valuable. Changing any shaping value restarts the current evaluation generation on a new benchmark revision.
        </p>
      </div>

      {chaserElo !== undefined && evaderElo !== undefined && (
        <div className="p-3 bg-gray-800/90 border border-gray-700 rounded-md text-xs">
          <div className="flex items-center justify-between font-bold mb-2 text-gray-300">
            <span className="flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-amber-400" />
              Role-level Elo Signal
            </span>
            <button
              onClick={onOpenDiagnostics}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
            >
              Leaderboard
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-red-950/40 border border-red-500/30 p-2 rounded">
              <div className="text-[10px] text-red-300 uppercase tracking-wider font-semibold">Tagger Policy</div>
              <div className="text-base font-mono font-bold text-red-400">{chaserElo} <span className="text-[10px] font-normal text-gray-400">Elo</span></div>
            </div>
            <div className="bg-blue-950/40 border border-blue-500/30 p-2 rounded">
              <div className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold">Runner Policy</div>
              <div className="text-base font-mono font-bold text-blue-400">{evaderElo} <span className="text-[10px] font-normal text-gray-400">Elo</span></div>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2 text-gray-300">Agent States</h3>
        <div className="space-y-2">
            {agents.map(agent => {
                const safeMaxEnergy = Number.isFinite(agent.maxEnergy) && agent.maxEnergy > 0 ? agent.maxEnergy : 1;
                const safeEnergy = Number.isFinite(agent.energy) ? Math.max(0, Math.min(agent.energy, safeMaxEnergy)) : 0;
                const staminaRatio = safeEnergy / safeMaxEnergy;
                const staminaPercent = staminaRatio * 100;

                return (
                <div key={agent.id} className="p-3 bg-gray-700 rounded-md transition-all">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: agent.color }}></div>
                            <span className="font-bold">Agent {agent.id}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${statusColors[agent.status]}`}>
                            {agent.status}
                        </span>
                    </div>
                    {/* Stamina Bar */}
                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                        <span>Stamina {safeEnergy.toFixed(1)}/{safeMaxEnergy.toFixed(1)} ({staminaPercent.toFixed(0)}%)</span>
                        <span className="truncate max-w-[150px]" title={agent.lastAction}>
                          {agent.lastAction}
                          {(agent.sprintIntensity || 0) > 0.05 ? ` · sprint ${Math.round((agent.sprintIntensity || 0) * 100)}%` : ''}
                          {(agent.jumpPower || 0) > 0 ? ` · jump ${Math.round((agent.jumpPower || 0) * 100)}%` : ''}{agent.jumpArmed === false ? ' · jump locked' : ''}
                        </span>
                    </div>
                    <div
                      className="w-full bg-gray-600 rounded-full h-2.5 mb-2 overflow-hidden"
                      role="progressbar"
                      aria-label={`Agent ${agent.id} stamina`}
                      aria-valuemin={0}
                      aria-valuemax={safeMaxEnergy}
                      aria-valuenow={safeEnergy}
                    >
                        <div
                          className={`${staminaRatio < 0.3 ? 'bg-amber-500' : 'bg-green-500'} h-full w-full origin-left`}
                          style={{ transform: `scaleX(${staminaRatio})` }}
                        ></div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-gray-400 font-mono" title={agent.modelId}>
                        <div>
                          Model: <span className="truncate inline-block align-bottom" style={{maxWidth: '100px'}}>{agent.modelId}</span>
                        </div>
                        {agent.elo !== undefined ? (
                          <span className="px-1.5 py-0.2 bg-gray-800 text-amber-300 rounded text-[10px] font-bold">{agent.elo} Elo</span>
                        ) : (
                          agent.modelPerformance !== undefined && (
                            <span className="text-cyan-400">({(agent.modelPerformance / 1000).toFixed(1)}s)</span>
                          )
                        )}
                    </div>
                    
                    {agent.stateVector && isSimulating && (
                        <StateVectorDisplay vector={agent.stateVector} />
                    )}
                    {agent.rewardBreakdown && isSimulating && (
                        <RewardBreakdownDisplay breakdown={agent.rewardBreakdown} status={agent.status} />
                    )}
                </div>
                );
            })}
        </div>
      </div>

      <div className="mt-auto bg-gray-700 p-3 rounded-md text-xs text-gray-400">
        <h4 className="font-bold text-gray-300 mb-1">How it works:</h4>
        <p>Agents use three factorized outputs—signed horizontal drive, jump, and sprint—on the compact 23-input world-relative state. Horizontal movement and jumping can happen simultaneously. Sprint and controlled jump remain manual abilities.</p>
      </div>
    </aside>
  );
};