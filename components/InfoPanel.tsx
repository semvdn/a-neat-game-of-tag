

import React from 'react';
import type { AgentState, RewardBreakdown, TrainingFitnessConfig, UpgradeConfig, UpgradeMode, UpgradeRule, SprintUpgradeRule, SprintRoleAdvanced, TerrainVarietyConfig } from '../types';
import { AgentStatus } from '../types';
import { Radar, Swords, Zap, ArrowUp, SlidersHorizontal, Eye, Route, Gauge, ChevronDown } from 'lucide-react';
import { MAX_SPEED, SPRINT_MAX_SPEED, SPRINT_ENERGY_COST_PER_SEC, MIN_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_TARGET_PX, MAX_RUNNER_PACE_REWARD_PER_WINDOW, MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM, STATE_VECTOR_SIZE } from '../constants';
import { STATE_VECTOR_LABELS } from '../learning/state';

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
  settingsLocked?: boolean;
}

const statusColors: Record<AgentStatus, string> = {
    [AgentStatus.It]: 'bg-red-500 text-white',
    [AgentStatus.Normal]: 'bg-blue-500 text-white',
    [AgentStatus.Cooldown]: 'bg-gray-500 text-white',
}

const ToggleSwitch: React.FC<{ id: string; checked: boolean; onChange: () => void; label?: string; disabled?: boolean }> = ({ id, checked, onChange, label, disabled = false }) => (
  <label htmlFor={id} className={`flex items-center ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
    <span className={`relative h-5 w-9 rounded-full border transition-colors ${checked ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-gray-600 bg-gray-700'}`}>
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} aria-label={label || id} disabled={disabled} />
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4 bg-cyan-200' : 'translate-x-0.5'}`}></span>
    </span>
  </label>
);

const CommittedRange: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  valueText?: (value: number) => string;
  valueClassName?: string;
  onCommit: (value: number) => void;
}> = ({ label, min, max, step, value, disabled = false, valueText = value => String(value), valueClassName = 'text-cyan-300', onCommit }) => {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = React.useCallback(() => {
    if (disabled || draft === value) return;
    onCommit(draft);
  }, [disabled, draft, onCommit, value]);
  return (
    <div className={disabled ? 'opacity-40' : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px]">
        <span className="text-gray-500">{label}</span>
        <span className={`shrink-0 font-mono ${valueClassName}`}>{valueText(draft)}</span>
      </div>
      <input
        aria-label={label}
        className="w-full accent-cyan-400 disabled:cursor-not-allowed"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={event => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {!disabled && draft !== value && <div className="mt-0.5 text-right text-[8px] text-gray-600">release to apply</div>}
    </div>
  );
};

const RoleToggle: React.FC<{ id: string; label: string; checked: boolean; onChange: () => void }> = ({ id, label, checked, onChange }) => (
  <label htmlFor={id} className={`flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1.5 text-[10px] transition-colors ${checked ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' : 'border-gray-700 bg-gray-950/60 text-gray-500'}`}>
    <span className="font-semibold">{label}</span>
    <span className="relative h-4 w-7 shrink-0 rounded-full bg-gray-700">
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} aria-label={`${label} enabled`} />
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`}></span>
    </span>
  </label>
);

const stateVectorLabels = STATE_VECTOR_LABELS;

const rewardTermOrder = [
    // Chaser rewards & penalties
    'successfulTag',
    'closingDistance',
    'proximityToTarget',
    'timePenalty',
    // Runner rewards & penalties
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
    const normalizedLabel = label.toLowerCase();
    const isBoolean = normalizedLabel.includes('grounded');
    const isUnipolar = isBoolean || normalizedLabel.includes('energy') || normalizedLabel.includes('cooldown') || normalizedLabel.includes('width') || normalizedLabel.includes('ledge');
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
  const validSize = vector.length === STATE_VECTOR_SIZE && stateVectorLabels.length === STATE_VECTOR_SIZE;
  return (
    <details className="group mt-3 rounded border border-gray-800 bg-black/20 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[10px] font-semibold text-gray-400 transition-colors hover:text-white">
        <span>Brain inputs · {STATE_VECTOR_SIZE}</span>
        <span className={`font-mono text-[9px] ${validSize ? 'text-emerald-400' : 'text-red-300'}`}>{validSize ? 'schema matched' : `vector ${vector.length}`}</span>
      </summary>
      <div className="mt-2 space-y-1 border-t border-gray-800 pt-2">
        {stateVectorLabels.map((label, index) => (
          <VectorBar key={`${label}-${index}`} label={label} value={vector[index] === undefined ? 0 : vector[index]} />
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
        if (status === AgentStatus.It && evaderTerms.includes(term)) return false;
        if (status !== AgentStatus.It && taggerTerms.includes(term)) return false;
        return Math.abs(Number(breakdown[term] || 0)) > 0.0005;
    });

    return (
        <details className="mt-3 group">
            <summary className="flex cursor-pointer list-none justify-between gap-2 text-[10px] font-semibold text-gray-400 transition-colors hover:text-white">
                <span>Visual-only heuristic</span>
                <span className={`font-mono ${totalReward > 0 ? 'text-green-400' : totalReward < 0 ? 'text-red-400' : ''}`}>
                    {totalReward >= 0 ? '+' : ''}{totalReward.toFixed(2)}
                </span>
            </summary>
            <div className="mt-2 space-y-1 pr-1">
                {relevantTerms.length > 0 ? relevantTerms.map(term => (
                    <RewardBar key={term} label={term} value={breakdown[term] || 0} />
                )) : <div className="text-[9px] text-gray-600">No active visual heuristic terms this frame.</div>}
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
  settingsLocked = false,
}) => {
  const anyBranchingEnabled = terrainVarietyConfig.trainingBranchingEnabled || terrainVarietyConfig.continuousBranchingEnabled;
  const anyMovingEnabled = terrainVarietyConfig.trainingMovingPlatformsEnabled || terrainVarietyConfig.continuousMovingPlatformsEnabled;
  const movingInBranchesAvailable =
    (terrainVarietyConfig.trainingBranchingEnabled && terrainVarietyConfig.trainingMovingPlatformsEnabled) ||
    (terrainVarietyConfig.continuousBranchingEnabled && terrainVarietyConfig.continuousMovingPlatformsEnabled);

  return (
    <aside className="w-80 shrink-0 overflow-y-auto rounded-xl border border-gray-700/70 bg-gray-800/95 shadow-xl">
      <div className="sticky top-0 z-10 border-b border-gray-700/70 bg-gray-800/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-cyan-300">Arena controls</h2>
            <p className="text-[9px] text-gray-500">View, terrain, abilities & live policy telemetry</p>
          </div>
          <button
            onClick={onOpenDiagnostics}
            className="rounded-md border border-cyan-500/30 bg-cyan-950/20 px-2 py-1 text-[9px] font-semibold text-cyan-200 hover:bg-cyan-900/30"
            title="Open full NEAT diagnostics"
          >
            Diagnostics
          </button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {settingsLocked && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-[9px] leading-relaxed text-amber-200">
            Experiment validation is running. Training-affecting settings are locked until the original run is restored; view overlays remain available.
          </div>
        )}
        <section className="rounded-lg border border-gray-700 bg-gray-900/55 p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <Eye className="h-3.5 w-3.5 text-cyan-300" /> View overlays
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 rounded-md bg-black/20 px-2.5 py-2">
              <div>
                <div className="text-[10px] font-semibold text-gray-300">Trails</div>
                <div className="text-[9px] text-gray-600">Recent movement paths</div>
              </div>
              <ToggleSwitch id="trails-toggle" label="Show agent trails" checked={showTrails} onChange={onToggleTrails} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-black/20 px-2.5 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <Radar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <div>
                  <div className="text-[10px] font-semibold text-gray-300">Agent senses</div>
                  <div className="text-[9px] text-gray-600">23 world-relative inputs · shortcut S</div>
                </div>
              </div>
              <ToggleSwitch id="senses-toggle" label="Show agent senses" checked={showSenses} onChange={onToggleSenses} />
            </div>
          </div>
        </section>

        <details className="group rounded-lg border border-violet-500/25 bg-violet-950/10">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
            <Route className="h-3.5 w-3.5 text-violet-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-violet-200">Terrain variety</div>
              <div className="truncate text-[9px] text-gray-600">
                Training B {terrainVarietyConfig.trainingBranchingEnabled ? `${terrainVarietyConfig.trainingBranchingEpisodePercent}%` : 'off'} · M {terrainVarietyConfig.trainingMovingPlatformsEnabled ? `${terrainVarietyConfig.trainingMovingEpisodePercent}%` : 'off'}
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-600 transition-transform group-open:rotate-180" />
          </summary>
          <fieldset disabled={settingsLocked} className={`space-y-3 border-0 border-t border-violet-500/15 p-3 ${settingsLocked ? 'opacity-45' : ''}`}>
            <p className="text-[9px] leading-relaxed text-gray-600">
              Branches are route-locked: the first landing commits an agent to that sibling route until its matching merge. Nested forks remain inside the parent corridor.
            </p>

            <div className="space-y-2 rounded-md border border-gray-800 bg-black/20 p-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cyan-300">Training distribution</div>
              <div className="flex items-center justify-between gap-2">
                <div><div className="text-[10px] text-gray-300">Branching episodes</div><div className="text-[9px] text-gray-600">Include exclusive route trees</div></div>
                <ToggleSwitch id="training-branches" label="Enable branching terrain during training" checked={terrainVarietyConfig.trainingBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ trainingBranchingEnabled: !terrainVarietyConfig.trainingBranchingEnabled })} />
              </div>
              {terrainVarietyConfig.trainingBranchingEnabled && (
                <CommittedRange label="Episodes with branches" min={0} max={100} step={5} value={terrainVarietyConfig.trainingBranchingEpisodePercent} valueText={v => `${v.toFixed(0)}%`} onCommit={v => onUpdateTerrainVarietyConfig({ trainingBranchingEpisodePercent: v })} />
              )}
              <div className="flex items-center justify-between gap-2 border-t border-gray-800 pt-2">
                <div><div className="text-[10px] text-gray-300">Moving-platform episodes</div><div className="text-[9px] text-gray-600">Guarantee moving terrain exposure</div></div>
                <ToggleSwitch id="training-moving" label="Enable moving platforms during training" checked={terrainVarietyConfig.trainingMovingPlatformsEnabled} onChange={() => onUpdateTerrainVarietyConfig({ trainingMovingPlatformsEnabled: !terrainVarietyConfig.trainingMovingPlatformsEnabled })} />
              </div>
              {terrainVarietyConfig.trainingMovingPlatformsEnabled && (
                <CommittedRange label="Episodes with moving platforms" min={0} max={100} step={5} value={terrainVarietyConfig.trainingMovingEpisodePercent} valueText={v => `${v.toFixed(0)}%`} onCommit={v => onUpdateTerrainVarietyConfig({ trainingMovingEpisodePercent: v })} />
              )}
              <div className="text-[8px] leading-relaxed text-gray-700">Training-distribution sliders apply when released, avoiding repeated partial-generation restarts while dragging.</div>
            </div>

            <div className="space-y-2 rounded-md border border-gray-800 bg-black/20 p-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-amber-300">Continuous champion view</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-gray-300">Branching paths</span>
                <ToggleSwitch id="continuous-branches" label="Enable branching paths in champion view" checked={terrainVarietyConfig.continuousBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ continuousBranchingEnabled: !terrainVarietyConfig.continuousBranchingEnabled })} />
              </div>
              {terrainVarietyConfig.continuousBranchingEnabled && (
                <CommittedRange label="Branch spawn chance" min={0} max={75} step={1} value={terrainVarietyConfig.continuousBranchSpawnPercent} valueText={v => `${v.toFixed(0)}%`} valueClassName="text-amber-300" onCommit={v => onUpdateTerrainVarietyConfig({ continuousBranchSpawnPercent: v })} />
              )}
              <div className="flex items-center justify-between gap-2 border-t border-gray-800 pt-2">
                <span className="text-[10px] text-gray-300">Moving platforms</span>
                <ToggleSwitch id="continuous-moving" label="Enable moving platforms in champion view" checked={terrainVarietyConfig.continuousMovingPlatformsEnabled} onChange={() => onUpdateTerrainVarietyConfig({ continuousMovingPlatformsEnabled: !terrainVarietyConfig.continuousMovingPlatformsEnabled })} />
              </div>
              {terrainVarietyConfig.continuousMovingPlatformsEnabled && (
                <CommittedRange label="Moving-platform spawn chance" min={0} max={80} step={1} value={terrainVarietyConfig.continuousMovingSpawnPercent} valueText={v => `${v.toFixed(0)}%`} valueClassName="text-amber-300" onCommit={v => onUpdateTerrainVarietyConfig({ continuousMovingSpawnPercent: v })} />
              )}
            </div>

            <div className={`space-y-2 rounded-md border border-gray-800 bg-black/20 p-2.5 ${!anyBranchingEnabled ? 'opacity-45' : ''}`}>
              <div className="text-[9px] font-bold uppercase tracking-wider text-violet-300">Branch complexity</div>
              <CommittedRange label="Maximum platforms per route" min={1} max={6} step={1} value={terrainVarietyConfig.maxPlatformsPerBranch} disabled={!anyBranchingEnabled} valueText={v => v.toFixed(0)} valueClassName="text-violet-300" onCommit={v => onUpdateTerrainVarietyConfig({ maxPlatformsPerBranch: v })} />
              <div className="flex items-center justify-between gap-2">
                <div><div className="text-[10px] text-gray-300">Sub-branching</div><div className="text-[9px] text-gray-600">Allow committed routes to split again</div></div>
                <ToggleSwitch id="sub-branching" label="Enable recursive sub-branching" disabled={!anyBranchingEnabled} checked={terrainVarietyConfig.subBranchingEnabled} onChange={() => onUpdateTerrainVarietyConfig({ subBranchingEnabled: !terrainVarietyConfig.subBranchingEnabled })} />
              </div>
              {terrainVarietyConfig.subBranchingEnabled && (
                <CommittedRange label="Maximum branch depth" min={1} max={4} step={1} value={terrainVarietyConfig.maxBranchDepth} disabled={!anyBranchingEnabled} valueText={v => v.toFixed(0)} valueClassName="text-violet-300" onCommit={v => onUpdateTerrainVarietyConfig({ maxBranchDepth: v })} />
              )}
              <div className="flex items-center justify-between gap-2 border-t border-gray-800 pt-2">
                <div><div className="text-[10px] text-gray-300">Moving platforms in branches</div><div className="text-[9px] text-gray-600">Horizontal route motion; merges stay fixed</div></div>
                <ToggleSwitch id="moving-in-branches" label="Allow moving platforms inside branch routes" disabled={!movingInBranchesAvailable} checked={terrainVarietyConfig.movingPlatformsInBranches} onChange={() => onUpdateTerrainVarietyConfig({ movingPlatformsInBranches: !terrainVarietyConfig.movingPlatformsInBranches })} />
              </div>
              {!movingInBranchesAvailable && <div className="text-[8px] text-gray-700">Enable both branching and moving terrain in at least one mode to use branch motion.</div>}
            </div>

            <CommittedRange label="Maximum moving-platform speed" min={0} max={180} step={5} value={terrainVarietyConfig.movingPlatformMaxSpeed} disabled={!anyMovingEnabled} valueText={v => `${v.toFixed(0)} px/s`} onCommit={v => onUpdateTerrainVarietyConfig({ movingPlatformMaxSpeed: v })} />
          </fieldset>
        </details>

        <details className="group rounded-lg border border-emerald-500/20 bg-emerald-950/10">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
            <Zap className="h-3.5 w-3.5 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-emerald-200">Manual abilities</div>
              <div className="text-[9px] text-gray-600">Sprint {sprintUpgradeActive ? 'on' : 'off'} · Controlled jump {controlledJumpUpgradeActive ? 'on' : 'off'}</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-600 transition-transform group-open:rotate-180" />
          </summary>
          <fieldset disabled={settingsLocked} className={`space-y-2 border-0 border-t border-emerald-500/15 p-3 ${settingsLocked ? 'opacity-45' : ''}`}>
            <UpgradeControl
              title="Sprint"
              description="Adds an independent sprint-intensity output. Effective sprint costs stamina and must be released for regeneration."
              icon={<Zap className="h-4 w-4" />}
              rule={upgradeConfig.sprint}
              active={sprintUpgradeActive}
              onChange={patch => onUpdateUpgrade('sprint', patch)}
            />
            <SprintAdvancedMenus rule={upgradeConfig.sprint} onChange={patch => onUpdateUpgrade('sprint', patch)} />
            <UpgradeControl
              title="Controlled Jump"
              description="Lets the independent jump output choose 45–100% impulse while horizontal drive remains active. A release is required before another jump."
              icon={<ArrowUp className="h-4 w-4" />}
              rule={upgradeConfig.controlledJump}
              active={controlledJumpUpgradeActive}
              onChange={patch => onUpdateUpgrade('controlledJump', patch)}
            />
          </fieldset>
        </details>

        <details className="group rounded-lg border border-cyan-500/20 bg-cyan-950/10">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
            <Gauge className="h-3.5 w-3.5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-cyan-200">Training shaping</div>
              <div className="text-[9px] text-gray-600">Pace target {trainingFitnessConfig.runnerPaceTargetPxPerWindow.toFixed(0)} px / 2s · follow +{trainingFitnessConfig.chaserPursuitRewardPerPlatform.toFixed(1)}</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-600 transition-transform group-open:rotate-180" />
          </summary>
          <fieldset disabled={settingsLocked} className={`space-y-3 border-0 border-t border-cyan-500/15 p-3 ${settingsLocked ? 'opacity-45' : ''}`}>
            <p className="text-[9px] leading-relaxed text-gray-600">Advanced fitness shaping only. Tag, fall, and Chaser-escape outcomes remain dominant. Values apply when the slider is released.</p>
            <CommittedRange label="Runner pace target / 2s" min={MIN_RUNNER_PACE_TARGET_PX} max={MAX_RUNNER_PACE_TARGET_PX} step={10} value={trainingFitnessConfig.runnerPaceTargetPxPerWindow} valueText={v => `${v.toFixed(0)} px`} onCommit={v => onUpdateTrainingFitnessConfig({ runnerPaceTargetPxPerWindow: v })} />
            <CommittedRange label="Runner maximum reward / window" min={0} max={MAX_RUNNER_PACE_REWARD_PER_WINDOW} step={1} value={trainingFitnessConfig.runnerPaceRewardPerWindow} valueText={v => `+${v.toFixed(1)}`} onCommit={v => onUpdateTrainingFitnessConfig({ runnerPaceRewardPerWindow: v })} />
            <CommittedRange label="Chaser follow reward / platform" min={0} max={MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM} step={0.5} value={trainingFitnessConfig.chaserPursuitRewardPerPlatform} valueText={v => `+${v.toFixed(1)}`} valueClassName="text-amber-300" onCommit={v => onUpdateTrainingFitnessConfig({ chaserPursuitRewardPerPlatform: v })} />
            <div className="text-[8px] leading-relaxed text-gray-700">Changing a shaping value starts a fresh evaluation of the current generation so genomes are never compared under mixed fitness settings.</div>
          </fieldset>
        </details>

        {chaserElo !== undefined && evaderElo !== undefined && (
          <section className="rounded-lg border border-gray-700 bg-gray-900/55 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-300"><Swords className="h-3.5 w-3.5 text-amber-400" /> Role Elo signal</div>
              <button onClick={onOpenDiagnostics} className="text-[9px] font-semibold text-cyan-400 hover:text-cyan-300">Details</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-red-500/25 bg-red-950/25 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-red-300">Chaser</div>
                <div className="font-mono text-base font-bold text-red-400">{chaserElo} <span className="text-[9px] font-normal text-gray-500">Elo</span></div>
              </div>
              <div className="rounded border border-cyan-500/25 bg-cyan-950/25 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-cyan-300">Runner</div>
                <div className="font-mono text-base font-bold text-cyan-400">{evaderElo} <span className="text-[9px] font-normal text-gray-500">Elo</span></div>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Agent telemetry</h3>
            <span className="text-[9px] text-gray-600">expand for brain inputs</span>
          </div>
          <div className="space-y-2">
            {agents.map(agent => {
              const safeMaxEnergy = Number.isFinite(agent.maxEnergy) && agent.maxEnergy > 0 ? agent.maxEnergy : 1;
              const safeEnergy = Number.isFinite(agent.energy) ? Math.max(0, Math.min(agent.energy, safeMaxEnergy)) : 0;
              const staminaRatio = safeEnergy / safeMaxEnergy;
              const staminaPercent = staminaRatio * 100;
              const roleLabel = agent.status === AgentStatus.It ? 'Chaser' : 'Runner';
              const badgeLabel = agent.status === AgentStatus.Cooldown ? 'Tag cooldown' : roleLabel;
              const formattedAction = (agent.lastAction || 'idle').replace(/_/g, ' ');
              const displayModelId = (agent.modelId || 'model unavailable').replace(/evader/gi, 'runner');

              return (
                <details key={agent.id} className="group rounded-lg border border-gray-700 bg-gray-900/55">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-gray-200">Agent {agent.id}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${statusColors[agent.status]}`}>{badgeLabel}</span>
                      </div>
                      <div className="truncate text-[9px] text-gray-600">{formattedAction} · stamina {staminaPercent.toFixed(0)}%</div>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-600 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-gray-800 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px] text-gray-500">
                      <span>Stamina {safeEnergy.toFixed(1)} / {safeMaxEnergy.toFixed(1)}</span>
                      <span className="max-w-[145px] truncate text-right" title={agent.lastAction}>
                        {formattedAction}
                        {(agent.sprintIntensity || 0) > 0.05 ? ` · sprint ${Math.round((agent.sprintIntensity || 0) * 100)}%` : ''}
                        {(agent.jumpPower || 0) > 0 ? ` · jump ${Math.round((agent.jumpPower || 0) * 100)}%` : ''}
                        {agent.jumpArmed === false ? ' · jump locked' : ''}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-700" role="progressbar" aria-label={`Agent ${agent.id} stamina`} aria-valuemin={0} aria-valuemax={safeMaxEnergy} aria-valuenow={safeEnergy}>
                      <div className={`${staminaRatio < 0.3 ? 'bg-amber-500' : 'bg-emerald-500'} h-full w-full origin-left`} style={{ transform: `scaleX(${staminaRatio})` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] text-gray-500" title={agent.modelId}>
                      <span className="min-w-0 truncate">{displayModelId}</span>
                      {agent.elo !== undefined ? <span className="shrink-0 rounded bg-black/30 px-1.5 py-0.5 text-amber-300">{agent.elo} Elo</span> : agent.modelPerformance !== undefined ? <span className="shrink-0 text-cyan-400">{(agent.modelPerformance / 1000).toFixed(1)}s</span> : null}
                    </div>
                    {agent.stateVector && isSimulating && <StateVectorDisplay vector={agent.stateVector} />}
                    {agent.rewardBreakdown && isSimulating && <RewardBreakdownDisplay breakdown={agent.rewardBreakdown} status={agent.status} />}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2 text-[9px] leading-relaxed text-gray-600">
          Policy schema: <span className="font-mono text-gray-400">23 inputs → 3 outputs</span> · signed horizontal drive + independent jump + sprint. Camera state is presentation-only.
        </div>
      </div>
    </aside>
  );
};
