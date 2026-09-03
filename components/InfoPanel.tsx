

import React from 'react';
import type { AgentState, RewardBreakdown } from '../types';
import { AgentStatus } from '../types';
import { Activity, Play, Gauge, FastForward, Award, Radar, Shield, Swords, Zap } from 'lucide-react';

interface InfoPanelProps {
  agents: AgentState[];
  isSimulating: boolean;
  showTrails: boolean;
  onToggleTrails: () => void;
  showLidar: boolean;
  onToggleLidar: () => void;
  avgSurvivalTime: number;
  avgTimeToTag: number;
  onOpenDiagnostics: () => void;
  simulationSpeed: number;
  onSetSimulationSpeed?: (speed: number) => void;
  onChangeSpeed?: (speed: number) => void;
  totalGeneration?: number;
  onRunBenchmark: () => void;
  benchmarkActive: boolean;
  benchmarkTimeRemaining?: number;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onStepFrame?: () => void;
  chaserElo?: number;
  evaderElo?: number;
  eloLeaderboard?: any[];
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

const stateVectorLabels = [
    // Self Kinematics & Status (6)
    { label: 'Vel X' }, { label: 'Vel Y' }, { label: 'Energy' }, 
    { label: 'Ground' }, { label: 'Is It' }, { label: 'Cooldown' },
    // Explicit Boundary Distances (3)
    { label: 'Screen Left' }, { label: 'Screen Right' }, { label: 'Fall Depth' },
    // Explicit Platform & Ledge Distances (4)
    { label: 'L-Ledge' }, { label: 'R-Ledge' }, { label: 'Close Ledge' }, { label: 'Ledge Alert' },
    // Nearby Platforms (9)
    { label: 'P1 dX' }, { label: 'P1 dY' }, { label: 'P1 Width' },
    { label: 'P2 dX' }, { label: 'P2 dY' }, { label: 'P2 Width' },
    { label: 'P3 dX' }, { label: 'P3 dY' }, { label: 'P3 Width' },
    // Target / Threat (4)
    { label: 'Tgt dX' }, { label: 'Tgt dY' }, 
    { label: 'Tgt Vel X' }, { label: 'Tgt Vel Y' },
    // Teammate (4)
    { label: 'Mate dX' }, { label: 'Mate dY' }, 
    { label: 'Mate Vel X' }, { label: 'Mate Vel Y' },
    // Lidar Perception Rays (8)
    { label: 'Ray 0° (R)' }, { label: 'Ray 45° (DR)' }, 
    { label: 'Ray 90° (D)' }, { label: 'Ray 135° (DL)' },
    { label: 'Ray 180° (L)' }, { label: 'Ray 225° (UL)' }, 
    { label: 'Ray 270° (U)' }, { label: 'Ray 315° (UR)' },
    // Bias (1)
    { label: 'Bias' },
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
    const isBoolean = label === 'Ground' || label === 'Is It' || label === 'Cooldown';
    const barColor = isBoolean
        ? (value > 0.5 ? '#22c55e' : 'transparent')
        : (clampedValue >= 0.01 ? '#22c55e' : (clampedValue <= -0.01 ? '#ef4444' : 'transparent'));
    
    return (
        <div title={`${label}: ${value.toFixed(3)}`} className="flex items-center justify-between text-gray-300 text-xs">
            <span className="w-20 truncate" title={label}>{label}</span>
            <div className="flex-1 h-3 bg-gray-800 rounded-sm relative mx-2">
                {!isBoolean && <div className="absolute top-0 left-1/2 w-px h-full bg-gray-600"></div>}
                <div 
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                        left: isBoolean ? '0%' : (clampedValue > 0 ? '50%' : `calc(50% - ${Math.abs(clampedValue) * 50}%)`),
                        width: isBoolean ? `${clampedValue * 100}%` : `${Math.abs(clampedValue) * 50}%`,
                        backgroundColor: barColor,
                    }}
                ></div>
            </div>
            <span className="w-10 text-right font-mono">{value.toFixed(2)}</span>
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
                <span>Reward Function</span>
                <span className={`font-mono ${totalReward > 0 ? 'text-green-400' : totalReward < 0 ? 'text-red-400' : ''}`}>
                    Total: {totalReward.toFixed(2)}
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
  showLidar,
  onToggleLidar,
  avgSurvivalTime,
  avgTimeToTag,
  onOpenDiagnostics,
  simulationSpeed,
  onSetSimulationSpeed,
  onChangeSpeed,
  totalGeneration,
  onRunBenchmark,
  benchmarkActive,
  benchmarkTimeRemaining,
  isPaused,
  onTogglePause,
  onStepFrame,
  chaserElo,
  evaderElo,
  eloLeaderboard,
}) => {
  const generation = totalGeneration ?? 0;
  const updateSpeed = onChangeSpeed || onSetSimulationSpeed || (() => {});

  return (
    <aside className="w-80 bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Diagnostics Tool Action Button */}
      <div className="bg-gradient-to-r from-cyan-950/60 to-blue-950/60 border border-cyan-500/40 rounded-lg p-3">
        <button
          onClick={onOpenDiagnostics}
          className="w-full py-2.5 px-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-md text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all transform active:scale-95"
        >
          <Activity className="w-4 h-4" />
          <span>Performance Diagnostics</span>
          <span className="ml-auto text-[10px] bg-black/30 text-black font-mono px-1.5 py-0.5 rounded font-extrabold">
            G{generation}
          </span>
        </button>

        {/* Speed Controls inside Sidebar */}
        <div className="mt-2.5 pt-2 border-t border-cyan-500/20">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-gray-300 flex items-center gap-1 font-medium">
              <FastForward className="w-3.5 h-3.5 text-cyan-400" />
              Sim Speed:
            </span>
            {simulationSpeed >= 25 && (
              <span className="text-[10px] font-bold text-amber-300 bg-amber-950/80 border border-amber-500/40 px-1.5 py-0.2 rounded animate-pulse">
                ⚡ Web Worker Turbo
              </span>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1">
            {[1, 2, 5, 10, 25, 50].map(speed => (
              <button
                key={speed}
                onClick={() => updateSpeed(speed)}
                className={`py-1 rounded text-[10px] font-bold transition-all text-center ${
                  simulationSpeed === speed
                    ? speed >= 25
                      ? 'bg-amber-400 text-black shadow-sm font-extrabold'
                      : 'bg-cyan-400 text-black font-extrabold'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>

        {/* Quick Benchmark Button */}
        <button
          disabled={benchmarkActive}
          onClick={onRunBenchmark}
          className="w-full mt-2 py-1.5 px-2 bg-gray-800/90 hover:bg-gray-700/90 border border-gray-700 text-gray-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <Award className="w-3.5 h-3.5 text-amber-400" />
          <span>{benchmarkActive ? `Benchmarking (${Math.ceil((benchmarkTimeRemaining || 0) / 1000)}s)...` : 'Run 20s Benchmark'}</span>
        </button>
      </div>

      <h2 className="text-xl font-bold text-cyan-400 border-b-2 border-cyan-400/30 pb-2">Simulation Status</h2>
      
      {isSimulating && (
        <div className="p-3 bg-gray-700 rounded-md text-sm">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan-400" />
                    Agent Abilities
                </h3>
                <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-medium">
                    Base Movement
                </span>
            </div>
            
            <div className="text-xs space-y-1.5 text-gray-300">
                <div className="flex justify-between items-center" title="Evader average survival time before tag">
                    <span className="text-gray-400">Avg. Survival Time:</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                        {(avgSurvivalTime / 1000).toFixed(2)}s
                    </span>
                </div>
                <div className="flex justify-between items-center" title="Tagger average time to catch evaders">
                    <span className="text-gray-400">Avg. Time to Tag:</span>
                    <span className="font-mono text-amber-400 font-semibold">
                        {(avgTimeToTag / 1000).toFixed(2)}s
                    </span>
                </div>
            </div>

            <div className="mt-2.5 pt-2 border-t border-gray-600">
                <div className="text-[11px] text-gray-400 flex items-center justify-between">
                    <span>Active Action Space:</span>
                    <span className="text-gray-300 font-medium">Left, Right, Jump, Idle</span>
                </div>
            </div>
        </div>
      )}

      <div className="flex justify-between items-center p-3 bg-gray-700 rounded-md">
        <h3 className="font-semibold text-gray-300">Show Trails</h3>
        <ToggleSwitch id="trails-toggle" checked={showTrails} onChange={onToggleTrails} />
      </div>

      <div className="flex justify-between items-center p-3 bg-gray-700 rounded-md">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-cyan-400" />
          <h3 className="font-semibold text-gray-300">Lidar Spatial Rays</h3>
        </div>
        <ToggleSwitch id="lidar-toggle" checked={showLidar} onChange={onToggleLidar} />
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
            {agents.map(agent => (
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
                    {/* Energy Bar */}
                    <div className="w-full bg-gray-600 rounded-full h-2.5 mb-2">
                        <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${(agent.energy / agent.maxEnergy) * 100}%` }}></div>
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
            ))}
        </div>
      </div>

      <div className="mt-auto bg-gray-700 p-3 rounded-md text-xs text-gray-400">
        <h4 className="font-bold text-gray-300 mb-1">How it works:</h4>
        <p>Agents evolve with separate chaser and evader NEAT populations. Speciation protects new topologies while crossover and mutation search both connection weights and network structure.</p>
      </div>
    </aside>
  );
};