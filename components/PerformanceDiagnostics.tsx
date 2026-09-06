import React, { useEffect, useMemo, useState } from 'react';
import type { DiagnosticsState } from '../types';
import { NETWORK_ARCHITECTURE_PRESETS, NETWORK_ARCHITECTURE_PRESET_INFO, NETWORK_ARCHITECTURE_SUITE_PRESETS, sanitizeNetworkArchitectureSuite, type NeatGenerationMetrics, type NeatGenomeData, type NetworkArchitectureConfig, type NetworkArchitecturePreset, type NetworkArchitectureSuiteConfig, type NetworkArchitectureSuitePreset } from '../learning/neat';
import { ACTION_SPACE, STATE_VECTOR_SIZE } from '../constants';
import {
  Activity,
  X,
  Play,
  Pause,
  FastForward,
  RotateCcw,
  Brain,
  Network,
  Trophy,
  BarChart3,
  Download,
  Upload,
  Save,
  HardDrive,
  MonitorPlay,
  Cpu,
} from 'lucide-react';

interface PerformanceDiagnosticsProps {
  diagnostics: DiagnosticsState;
  visualSpeed: number;
  onSetVisualSpeed: (speed: number) => void;
  isVisualPaused: boolean;
  onToggleVisualPause: () => void;
  isTrainingPaused: boolean;
  onToggleTrainingPause: () => void;
  onResetChampionGame: () => void;
  onStepFrame: () => void;
  onResetWeights: () => void;
  avgSurvivalTime: number;
  avgTimeToTag: number;
  isOpen: boolean;
  onClose: () => void;
  onExportModels?: () => void;
  onExportAnalysis?: () => void;
  onImportModels?: (json: string) => boolean;
  onSaveLocalStorage?: () => void;
  onLoadLocalStorage?: () => void;
  hasSavedModel?: boolean;
  networkArchitecture: NetworkArchitectureSuiteConfig;
  onApplyNetworkArchitecture: (config: NetworkArchitectureSuiteConfig) => void;
}

const fmt = (v: number | undefined, digits = 2) => (Number.isFinite(v) ? Number(v).toFixed(digits) : '—');
const formatTrainingRate = (value: number | undefined) => {
  const safe = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(1)}M`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}k`;
  if (safe >= 100) return safe.toFixed(0);
  if (safe >= 10) return safe.toFixed(1);
  return safe.toFixed(2);
};

const MetricCard: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
    <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
    <div className="mt-1 text-2xl font-bold font-mono text-white">{value}</div>
    {hint && <div className="mt-1 text-[11px] text-gray-500">{hint}</div>}
  </div>
);

const lineColors = [
  { stroke: 'text-red-400', legend: 'text-red-300' },
  { stroke: 'text-cyan-400', legend: 'text-cyan-300' },
  { stroke: 'text-orange-400', legend: 'text-orange-300' },
  { stroke: 'text-violet-400', legend: 'text-violet-300' },
  { stroke: 'text-emerald-400', legend: 'text-emerald-300' },
  { stroke: 'text-pink-400', legend: 'text-pink-300' },
];

const LineChart: React.FC<{
  series: { label: string; values: number[] }[];
  height?: number;
  emptyLabel?: string;
}> = ({ series, height = 190, emptyLabel = 'Run evolutionary training to populate this chart.' }) => {
  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (values.length < 2) {
    return <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">{emptyLabel}</div>;
  }
  const width = 720;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);
  const pad = 18;
  const points = (data: number[]) => data.map((v, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-xl border border-gray-800 bg-black/30">
        {[0.25, 0.5, 0.75].map(frac => (
          <line key={frac} x1={pad} x2={width - pad} y1={height * frac} y2={height * frac} stroke="currentColor" className="text-gray-800" strokeWidth="1" />
        ))}
        {series.map((s, idx) => {
          const color = lineColors[idx % lineColors.length];
          return (
            <polyline
              key={s.label}
              points={points(s.values)}
              fill="none"
              stroke="currentColor"
              className={color.stroke}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
        {series.map((s, idx) => {
          const color = lineColors[idx % lineColors.length];
          return (
            <span key={s.label} className={color.legend}>
              ● {s.label}
            </span>
          );
        })}
        <span className="ml-auto font-mono text-gray-500">range {fmt(min)} – {fmt(max)}</span>
      </div>
    </div>
  );
};

const NetworkGraph: React.FC<{ genome?: NeatGenomeData | null }> = ({ genome }) => {
  const layout = useMemo(() => {
    if (!genome) return null;
    const inputs = genome.nodes.filter(n => n.type === 'input').sort((a, b) => a.id - b.id);
    const hidden = genome.nodes.filter(n => n.type === 'hidden').sort((a, b) => (a.depth ?? 0.5) - (b.depth ?? 0.5) || a.id - b.id);
    const outputs = genome.nodes.filter(n => n.type === 'output').sort((a, b) => a.id - b.id);
    const pos = new Map<number, { x: number; y: number }>();
    const place = (nodes: typeof genome.nodes, x: number) => nodes.forEach((n, i) => {
      pos.set(n.id, { x, y: 18 + ((i + 0.5) / Math.max(1, nodes.length)) * 304 });
    });
    place(inputs, 26);
    place(outputs, 334);
    const depthGroups = new Map<string, typeof genome.nodes>();
    for (const node of hidden) {
      const key = (node.depth ?? 0.5).toFixed(6);
      const group = depthGroups.get(key) || [];
      group.push(node);
      depthGroups.set(key, group);
    }
    for (const [key, nodes] of depthGroups) {
      const depth = Number(key);
      place(nodes, 26 + depth * 308);
    }
    return { pos, inputs, hidden, outputs, hiddenLayers: depthGroups.size };
  }, [genome]);

  if (!genome || !layout) {
    return <div className="h-80 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">Champion topology appears after the first completed generation.</div>;
  }

  const enabled = genome.connections.filter(c => c.enabled);
  const recurrent = enabled.filter(c => c.recurrent);
  const feedForward = enabled.filter(c => !c.recurrent);
  return (
    <div className="rounded-xl border border-gray-800 bg-black/40 p-3">
      <svg viewBox="0 0 360 340" className="w-full h-[340px]">
        {feedForward.map(c => {
          const a = layout.pos.get(c.inNode);
          const b = layout.pos.get(c.outNode);
          if (!a || !b) return null;
          const weight = Math.min(4, Math.max(0.4, Math.abs(c.weight)));
          return <line key={c.innovation} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className={c.weight >= 0 ? 'text-emerald-400/20' : 'text-rose-400/20'} strokeWidth={weight} />;
        })}
        {recurrent.map(c => {
          const a = layout.pos.get(c.inNode);
          const b = layout.pos.get(c.outNode);
          if (!a || !b) return null;
          const bend = Math.max(10, Math.abs(b.x - a.x) * 0.25 + 12);
          const midX = (a.x + b.x) / 2;
          const midY = Math.max(8, Math.min(332, Math.min(a.y, b.y) - bend));
          return <path key={`r-${c.innovation}`} d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`} fill="none" stroke="currentColor" className="text-fuchsia-300/35" strokeWidth={Math.min(3, Math.max(0.5, Math.abs(c.weight)))} strokeDasharray="4 3" />;
        })}
        {genome.nodes.map(n => {
          const p = layout.pos.get(n.id)!;
          const cls = n.type === 'input' ? 'text-gray-400' : n.type === 'output' ? 'text-amber-300' : 'text-violet-300';
          return <circle key={n.id} cx={p.x} cy={p.y} r={n.type === 'hidden' ? 5 : 3.5} fill="currentColor" className={cls} />;
        })}
        <text x="8" y="12" className="fill-gray-500 text-[8px]">{STATE_VECTOR_SIZE} INPUTS</text>
        <text x="140" y="12" className="fill-gray-500 text-[8px]">{layout.hiddenLayers} HIDDEN LAYERS</text>
        <text x="314" y="12" className="fill-gray-500 text-[8px]">4 OUTPUTS</text>
      </svg>
      <div className="grid grid-cols-4 gap-2 text-xs text-gray-400 text-center">
        <div><span className="text-white font-mono">{genome.nodes.length}</span> nodes</div>
        <div><span className="text-white font-mono">{feedForward.length}</span> feed-forward</div>
        <div><span className="text-fuchsia-300 font-mono">{recurrent.length}</span> recurrent</div>
        <div><span className="text-white font-mono">{genome.connections.length - enabled.length}</span> disabled</div>
      </div>
    </div>
  );
};

const FitnessSummary: React.FC<{ title: string; metrics?: NeatGenerationMetrics | null }> = ({ title, metrics }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="font-semibold text-white">{title}</div>
      <div className="text-xs font-mono text-gray-400">Gen {metrics?.generation ?? 0}</div>
    </div>
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div><div className="text-gray-500">Best fitness</div><div className="font-mono text-lg text-emerald-300">{fmt(metrics?.bestFitness)}</div></div>
      <div><div className="text-gray-500">Mean fitness</div><div className="font-mono text-lg text-white">{fmt(metrics?.averageFitness)}</div></div>
      <div><div className="text-gray-500">Species</div><div className="font-mono text-lg text-violet-300">{metrics?.speciesCount ?? '—'}</div></div>
      <div><div className="text-gray-500">Reproducing</div><div className="font-mono text-lg text-violet-200">{metrics?.reproductiveSpeciesCount ?? metrics?.speciesCount ?? '—'}</div></div>
      <div><div className="text-gray-500">Stagnant</div><div className="font-mono text-lg text-amber-300">{metrics?.stagnantSpeciesCount ?? '—'}</div></div>
      <div><div className="text-gray-500">Extinct this gen</div><div className="font-mono text-lg text-gray-300">{metrics?.extinctSpeciesCount ?? '—'}</div></div>
      <div><div className="text-gray-500">Oldest species</div><div className="font-mono text-lg text-white">{metrics?.oldestSpeciesAge != null ? `${metrics.oldestSpeciesAge} gen` : '—'}</div></div>
      <div><div className="text-gray-500">Mean species age</div><div className="font-mono text-lg text-white">{metrics?.averageSpeciesAge != null ? `${metrics.averageSpeciesAge.toFixed(1)} gen` : '—'}</div></div>
      <div><div className="text-gray-500">Compatibility δ</div><div className="font-mono text-lg text-white">{fmt(metrics?.compatibilityThreshold)}</div></div>
      <div><div className="text-gray-500">Champion topology</div><div className="font-mono text-lg text-white">{metrics ? `${metrics.championHiddenLayers ?? '—'}L · ${metrics.championHiddenNodes ?? '—'}H · ${metrics.championRecurrentConnections ?? 0}R` : '—'}</div></div>
    </div>
  </div>
);

const architectureEstimate = (config: NetworkArchitectureConfig) => {
  const layers = [STATE_VECTOR_SIZE, ...config.hiddenLayers, ACTION_SPACE.length];
  const hiddenNodes = config.hiddenLayers.reduce((a, b) => a + b, 0);
  const nodes = STATE_VECTOR_SIZE + ACTION_SPACE.length + hiddenNodes;
  let candidates = 0;
  for (let i = 0; i < layers.length - 1; i++) candidates += layers[i] * layers[i + 1];
  if (config.hiddenLayers.length > 0 && config.inputOutputSkip) candidates += STATE_VECTOR_SIZE * ACTION_SPACE.length;
  if (config.hiddenLayerSkips && config.hiddenLayers.length > 1) {
    for (let i = 0; i < config.hiddenLayers.length - 1; i++) {
      for (let j = i + 2; j < config.hiddenLayers.length; j++) candidates += config.hiddenLayers[i] * config.hiddenLayers[j];
    }
  }
  return {
    nodes,
    hiddenNodes,
    connections: Math.max(ACTION_SPACE.length, Math.round(candidates * config.connectionDensity)) + config.initialRecurrentConnections,
  };
};

const ArchitectureRoleEditor: React.FC<{
  role: 'chaser' | 'runner';
  config: NetworkArchitectureConfig;
  disabled?: boolean;
  onChange: (next: NetworkArchitectureConfig) => void;
}> = ({ role, config, disabled, onChange }) => {
  const estimate = architectureEstimate(config);
  const update = (patch: Partial<NetworkArchitectureConfig>) => onChange({ ...config, ...patch, preset: 'custom' });
  const selectPreset = (preset: NetworkArchitecturePreset) => {
    if (preset === 'custom') return;
    const base = NETWORK_ARCHITECTURE_PRESETS[preset];
    onChange({ ...base, hiddenLayers: [...base.hiddenLayers] });
  };
  const setLayerCount = (count: number) => {
    const next = [...config.hiddenLayers];
    while (next.length < count) next.push(next.length === 0 ? 16 : Math.max(8, Math.round(next[next.length - 1] * 0.75)));
    next.length = count;
    update({
      hiddenLayers: next,
      maxHiddenLayers: Math.max(config.maxHiddenLayers, count),
      maxHiddenNodes: Math.max(config.maxHiddenNodes, next.reduce((a, b) => a + b, 0)),
    });
  };
  const setLayerWidth = (index: number, width: number) => {
    const next = [...config.hiddenLayers];
    next[index] = Math.max(1, Math.min(64, Math.round(width || 1)));
    update({ hiddenLayers: next, maxHiddenNodes: Math.max(config.maxHiddenNodes, next.reduce((a, b) => a + b, 0)) });
  };
  const roleColor = role === 'chaser' ? 'text-red-200' : 'text-cyan-200';

  return (
    <div className={`rounded-xl border p-4 ${role === 'chaser' ? 'border-red-500/20 bg-red-950/10' : 'border-cyan-500/20 bg-cyan-950/10'} ${disabled ? 'opacity-55' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className={`font-semibold ${roleColor}`}>{role === 'chaser' ? 'Chaser' : 'Runner'} network</h4>
          <p className="text-[10px] text-gray-500">Generation 1: {estimate.nodes} nodes · ~{estimate.connections} links · {config.initialRecurrentConnections} recurrent</p>
        </div>
        <select disabled={disabled} value={config.preset} onChange={e => selectPreset(e.target.value as NetworkArchitecturePreset)} className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50">
          {Object.entries(NETWORK_ARCHITECTURE_PRESET_INFO).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
          <option value="custom">Custom</option>
        </select>
      </div>
      {config.preset !== 'custom' && NETWORK_ARCHITECTURE_PRESET_INFO[config.preset] && (
        <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
          <div className="text-[10px] font-semibold text-gray-300">{NETWORK_ARCHITECTURE_PRESET_INFO[config.preset].summary}</div>
          <div className="mt-0.5 text-[10px] text-gray-600">{NETWORK_ARCHITECTURE_PRESET_INFO[config.preset].use}</div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-white">Hidden layers</div><div className="text-[10px] text-gray-500">Choose starting depth, whether depth can evolve, and its hard ceiling.</div></div><span className="font-mono text-xs text-violet-300">{config.hiddenLayers.length} → max {config.maxHiddenLayers}</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-400">Starting hidden layers
            <select disabled={disabled} value={config.hiddenLayers.length} onChange={e => setLayerCount(Number(e.target.value))} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 text-gray-200">
              {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n === 0 ? '0 · minimal' : n}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2 text-xs text-gray-400"><span>Evolve layer count</span><input disabled={disabled} type="checkbox" checked={config.evolveHiddenLayers} onChange={e => update({ evolveHiddenLayers: e.target.checked })} /></label>
          <label className="text-xs text-gray-400">Maximum hidden layers
            <input disabled={disabled || !config.evolveHiddenLayers} type="number" min={config.hiddenLayers.length} max={8} value={config.maxHiddenLayers} onChange={e => update({ maxHiddenLayers: Math.max(config.hiddenLayers.length, Number(e.target.value) || config.hiddenLayers.length) })} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 font-mono text-gray-200 disabled:opacity-50" />
          </label>
        </div>
        {config.evolveHiddenLayers && <label className="mt-3 block text-xs text-gray-400">Add-layer mutation <span className="float-right font-mono text-amber-300">{(config.addLayerRate * 100).toFixed(1)}%</span><input disabled={disabled} type="range" min={0} max={0.1} step={0.002} value={config.addLayerRate} onChange={e => update({ addLayerRate: Number(e.target.value) })} className="mt-2 w-full" /></label>}
      </div>

      <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-white">Hidden nodes</div><div className="text-[10px] text-gray-500">Layer widths define the starting node count; evolution may add nodes inside existing layers up to the cap.</div></div><span className="font-mono text-xs text-violet-300">{estimate.hiddenNodes} → max {config.maxHiddenNodes}</span></div>
        {config.hiddenLayers.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {config.hiddenLayers.map((width, index) => <label key={index} className="text-[10px] text-gray-500">Layer {index + 1} nodes<input disabled={disabled} type="number" min={1} max={64} value={width} onChange={e => setLayerWidth(index, Number(e.target.value))} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-xs text-gray-200" /></label>)}
        </div> : <p className="mt-2 text-[10px] text-gray-600">No starting hidden nodes. If layer evolution is enabled, NEAT can create the first hidden layer later.</p>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2 text-xs text-gray-400"><span>Evolve hidden node count</span><input disabled={disabled} type="checkbox" checked={config.evolveHiddenNodes} onChange={e => update({ evolveHiddenNodes: e.target.checked })} /></label>
          <label className="text-xs text-gray-400">Maximum hidden nodes
            <input disabled={disabled || !config.evolveHiddenNodes} type="number" min={estimate.hiddenNodes} max={384} value={config.maxHiddenNodes} onChange={e => update({ maxHiddenNodes: Math.max(estimate.hiddenNodes, Number(e.target.value) || estimate.hiddenNodes) })} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 font-mono text-gray-200 disabled:opacity-50" />
          </label>
        </div>
        {config.evolveHiddenNodes && <label className="mt-3 block text-xs text-gray-400">Add-node mutation <span className="float-right font-mono text-amber-300">{(config.addNodeRate * 100).toFixed(1)}%</span><input disabled={disabled} type="range" min={0} max={0.2} step={0.005} value={config.addNodeRate} onChange={e => update({ addNodeRate: Number(e.target.value) })} className="mt-2 w-full" /></label>}
      </div>

      <div className="mt-3 rounded-lg border border-fuchsia-500/20 bg-fuchsia-950/10 p-3">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-fuchsia-200">Recurrent memory connections</div><div className="text-[10px] text-gray-500">One-step delayed links give each physical agent its own memory state. Self-links and backward links are allowed.</div></div><span className="font-mono text-xs text-fuchsia-300">{config.initialRecurrentConnections} → max {config.maxRecurrentConnections}</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-400">Starting recurrent links
            <input disabled={disabled} type="number" min={0} max={256} value={config.initialRecurrentConnections} onChange={e => { const n = Math.max(0, Math.min(256, Number(e.target.value) || 0)); update({ initialRecurrentConnections: n, maxRecurrentConnections: Math.max(config.maxRecurrentConnections, n) }); }} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 font-mono text-gray-200" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2 text-xs text-gray-400"><span>Evolve recurrent count</span><input disabled={disabled} type="checkbox" checked={config.evolveRecurrentConnections} onChange={e => update({ evolveRecurrentConnections: e.target.checked })} /></label>
          <label className="text-xs text-gray-400">Maximum recurrent links
            <input disabled={disabled || !config.evolveRecurrentConnections} type="number" min={config.initialRecurrentConnections} max={512} value={config.maxRecurrentConnections} onChange={e => update({ maxRecurrentConnections: Math.max(config.initialRecurrentConnections, Number(e.target.value) || config.initialRecurrentConnections) })} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 font-mono text-gray-200 disabled:opacity-50" />
          </label>
        </div>
        {config.evolveRecurrentConnections && <label className="mt-3 block text-xs text-gray-400">Add-recurrent mutation <span className="float-right font-mono text-fuchsia-300">{(config.addRecurrentConnectionRate * 100).toFixed(1)}%</span><input disabled={disabled} type="range" min={0} max={0.2} step={0.002} value={config.addRecurrentConnectionRate} onChange={e => update({ addRecurrentConnectionRate: Number(e.target.value) })} className="mt-2 w-full" /></label>}
      </div>

      <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 p-3">
        <div className="text-xs font-semibold text-white">Feed-forward wiring</div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <label className="text-xs text-gray-400">Initial connection density <span className="float-right font-mono text-violet-300">{Math.round(config.connectionDensity * 100)}%</span><input disabled={disabled} type="range" min={0.1} max={1} step={0.05} value={config.connectionDensity} onChange={e => update({ connectionDensity: Number(e.target.value) })} className="mt-2 w-full" /></label>
          <label className="text-xs text-gray-400">Initial weight scale <span className="float-right font-mono text-violet-300">±{config.initialWeightScale.toFixed(2)}</span><input disabled={disabled} type="range" min={0.1} max={3} step={0.05} value={config.initialWeightScale} onChange={e => update({ initialWeightScale: Number(e.target.value) })} className="mt-2 w-full" /></label>
          <label className="text-xs text-gray-400">Add feed-forward connection <span className="float-right font-mono text-amber-300">{(config.addConnectionRate * 100).toFixed(1)}%</span><input disabled={disabled} type="range" min={0} max={0.3} step={0.005} value={config.addConnectionRate} onChange={e => update({ addConnectionRate: Number(e.target.value) })} className="mt-2 w-full" /></label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2 text-xs text-gray-400"><span>Input → output skip links</span><input disabled={disabled} type="checkbox" checked={config.inputOutputSkip} onChange={e => update({ inputOutputSkip: e.target.checked })} /></label>
          <label className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2 text-xs text-gray-400"><span>Hidden-layer skip links</span><input disabled={disabled || config.hiddenLayers.length < 2} type="checkbox" checked={config.hiddenLayerSkips} onChange={e => update({ hiddenLayerSkips: e.target.checked })} /></label>
        </div>
      </div>
    </div>
  );
};

export const PerformanceDiagnostics: React.FC<PerformanceDiagnosticsProps> = ({
  diagnostics,
  visualSpeed,
  onSetVisualSpeed,
  isVisualPaused,
  onToggleVisualPause,
  isTrainingPaused,
  onToggleTrainingPause,
  onResetChampionGame,
  onStepFrame,
  onResetWeights,
  avgSurvivalTime,
  avgTimeToTag,
  isOpen,
  onClose,
  onExportModels,
  onExportAnalysis,
  onImportModels,
  onSaveLocalStorage,
  onLoadLocalStorage,
  hasSavedModel,
  networkArchitecture,
  onApplyNetworkArchitecture,
}) => {
  const [tab, setTab] = useState<'overview' | 'fitness' | 'network' | 'architecture' | 'actions' | 'models'>('overview');
  const [role, setRole] = useState<'chaser' | 'evader'>('chaser');
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [architectureDraft, setArchitectureDraft] = useState<NetworkArchitectureSuiteConfig>(() => sanitizeNetworkArchitectureSuite(networkArchitecture));
  useEffect(() => setArchitectureDraft(sanitizeNetworkArchitectureSuite(networkArchitecture)), [networkArchitecture]);
  const architectureDirty = JSON.stringify(sanitizeNetworkArchitectureSuite(architectureDraft)) !== JSON.stringify(sanitizeNetworkArchitectureSuite(networkArchitecture));
  if (!isOpen) return null;

  const chaserHistory = diagnostics.chaserNeatHistory || [];
  const evaderHistory = diagnostics.evaderNeatHistory || [];
  const balanceHistory = diagnostics.balanceHistory || [];
  const benchmarkHistory = diagnostics.benchmarkHistory || [];
  const benchmark = diagnostics.lastCrossGenerationBenchmark;
  const balance = diagnostics.lastGenerationBalance;
  const retainedChaser = diagnostics.chaserGeneralistChampion;
  const retainedRunner = diagnostics.evaderGeneralistChampion;
  const chaserMetrics = diagnostics.lastChaserNeatMetrics;
  const evaderMetrics = diagnostics.lastEvaderNeatMetrics;
  const selectedGenome = role === 'chaser' ? diagnostics.chaserChampionGenome : diagnostics.evaderChampionGenome;
  const selectedMetrics = role === 'chaser' ? chaserMetrics : evaderMetrics;
  const generation = diagnostics.generation || Math.max(chaserMetrics?.generation || 0, evaderMetrics?.generation || 0);

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onImportModels) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = onImportModels(String(reader.result || ''));
      setStatus(ok ? 'Imported NEAT checkpoint/model.' : 'Import failed. This build expects a compatible NEAT checkpoint or genome JSON.');
      setTimeout(() => setStatus(null), 3500);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col text-gray-200">
      <header className="border-b border-gray-800 bg-gray-950 px-5 py-3 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center"><Brain className="w-5 h-5 text-violet-300" /></div>
        <div>
          <div className="flex items-center gap-2"><h2 className="font-bold text-lg text-white">NEAT Evolution Diagnostics</h2><span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">population based</span></div>
          <p className="text-xs text-gray-500">Fitness, speciation and topology growth replace PPO loss, critic and gradient telemetry.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-black/30 p-1" title="Champion-view speed">
            <MonitorPlay className="w-3.5 h-3.5 text-cyan-300 ml-1" />
            <span className="text-[10px] uppercase tracking-wider text-cyan-300 mr-1">View</span>
            {[0.5, 1, 2, 5, 10].map(speed => (
              <button key={speed} onClick={() => onSetVisualSpeed(speed)} className={`px-2 py-1 rounded text-xs font-mono ${visualSpeed === speed ? 'bg-cyan-500 text-black' : 'text-gray-500 hover:text-white'}`}>{speed}x</button>
            ))}
            <button onClick={onToggleVisualPause} className="p-1.5 rounded hover:bg-gray-900 text-cyan-200" title={isVisualPaused ? 'Resume champion view' : 'Pause champion view'}>{isVisualPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
            <button onClick={onStepFrame} className="p-1.5 rounded hover:bg-gray-900 text-cyan-200" title="Step champion view"><FastForward className="w-4 h-4" /></button>
            <button onClick={onResetChampionGame} className="p-1.5 rounded hover:bg-gray-900 text-cyan-200" title="Reset champion game only"><RotateCcw className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-black/30 px-2 py-1.5" title="Background training always runs as fast as this device can process it">
            <Cpu className="w-3.5 h-3.5 text-amber-300 ml-1" />
            <span className="text-[10px] uppercase tracking-wider text-amber-300">Train</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 text-[9px] font-bold uppercase tracking-wider text-amber-200">Max</span>
            <span className="text-xs font-mono font-semibold text-amber-100 min-w-[58px] text-right">
              {isTrainingPaused ? 'paused' : `${formatTrainingRate(diagnostics.trainingSpeedX)}×`}
            </span>
            <span className="text-[10px] font-mono text-gray-500 min-w-[62px]">
              {formatTrainingRate(diagnostics.trainingEpisodesPerSecond)} ep/s
            </span>
            <span className="text-[10px] font-mono text-gray-600" title={diagnostics.trainingBackend || 'CPU training'}>
              {diagnostics.trainingWorkerCount || 1} workers
            </span>
            {(diagnostics.trainingRecoveryCount || 0) > 0 && (
              <span className="text-[10px] font-mono text-orange-300" title={diagnostics.trainingLastRecoveryReason || 'Recovered stalled evaluator batch'}>
                {diagnostics.trainingRecoveryCount} recovered
              </span>
            )}
            <button onClick={onToggleTrainingPause} className="p-1.5 rounded hover:bg-gray-900 text-amber-200" title={isTrainingPaused ? 'Resume background training' : 'Pause background training'}>{isTrainingPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
          </div>
          <button onClick={onClose} className="p-2 rounded border border-gray-800 hover:bg-gray-900"><X className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="px-5 pt-3 flex gap-2 border-b border-gray-900 bg-gray-950">
        {[
          ['overview', Activity, 'Overview'],
          ['fitness', Trophy, 'Fitness'],
          ['network', Network, 'Topology'],
          ['architecture', Brain, 'Architecture'],
          ['actions', BarChart3, 'Actions'],
          ['models', HardDrive, 'Models'],
        ].map(([id, Icon, label]) => {
          const C = Icon as React.FC<{ className?: string }>;
          return <button key={String(id)} onClick={() => setTab(id as typeof tab)} className={`flex items-center gap-2 px-3 py-2 text-xs border-b-2 ${tab === id ? 'border-violet-400 text-violet-200' : 'border-transparent text-gray-500 hover:text-gray-300'}`}><C className="w-4 h-4" />{String(label)}</button>;
        })}
      </div>

      <main className="flex-1 overflow-auto p-5">
        {tab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-10 gap-3">
              <MetricCard label="Generation" value={generation} hint="one full population evaluation" />
              <MetricCard label="Chaser best" value={fmt(chaserMetrics?.bestFitness)} hint="tags − own falls; no exploration shaping" />
              <MetricCard label="Runner best" value={fmt(evaderMetrics?.bestFitness)} hint="−tags − own falls + capped pace-window reward" />
              <MetricCard label="Species C / R" value={`${chaserMetrics?.speciesCount ?? '—'} / ${evaderMetrics?.speciesCount ?? '—'}`} hint={`reproducing ${chaserMetrics?.reproductiveSpeciesCount ?? chaserMetrics?.speciesCount ?? '—'} / ${evaderMetrics?.reproductiveSpeciesCount ?? evaderMetrics?.speciesCount ?? '—'}`} />
              <MetricCard label="Tag rate" value={balance ? `${(balance.tagRate * 100).toFixed(1)}%` : '—'} hint="contact tags only" />
              <MetricCard label="Runner clean survival" value={balance ? `${(balance.survivalRate * 100).toFixed(1)}%` : '—'} hint="no tag and no runner fall" />
              <MetricCard label="Chaser fall rate" value={balance?.chaserFallRate != null ? `${(balance.chaserFallRate * 100).toFixed(1)}%` : '—'} hint={balance?.chaserFalls != null ? `${balance.chaserFalls} matches with chaser fall` : 'population matches'} />
              <MetricCard label="Runner fall rate" value={balance?.runnerFallRate != null ? `${(balance.runnerFallRate * 100).toFixed(1)}%` : '—'} hint={balance?.runnerFalls != null ? `${balance.runnerFalls} matches with runner fall` : 'population matches'} />
              <MetricCard label="Avg tag time" value={balance?.avgTagTimeMs != null ? `${(balance.avgTagTimeMs / 1000).toFixed(2)}s` : '—'} hint="when a contact tag occurs" />
              <MetricCard label="Matches" value={balance?.matches ?? '—'} hint="last completed generation" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <FitnessSummary title="Chaser population" metrics={chaserMetrics} />
              <FitnessSummary title="Evader population" metrics={evaderMetrics} />
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <MetricCard label="Hall of Fame C / E" value={`${diagnostics.hallOfFame?.chaserSize ?? 0} / ${diagnostics.hallOfFame?.evaderSize ?? 0}`} hint={`max ${diagnostics.hallOfFame?.maxSize ?? 0} champions per role`} />
              <MetricCard label="Recent C / E" value={`${diagnostics.hallOfFame?.chaserRecentSize ?? 0} / ${diagnostics.hallOfFame?.evaderRecentSize ?? 0}`} hint="always retained to track current coevolution" />
              <MetricCard label="Diverse history C / E" value={`${diagnostics.hallOfFame?.chaserDiverseSize ?? 0} / ${diagnostics.hallOfFame?.evaderDiverseSize ?? 0}`} hint="behaviorally distinct older champions" />
              <MetricCard label="Archive diversity C / E" value={`${fmt(diagnostics.hallOfFame?.chaserDiversity, 3)} / ${fmt(diagnostics.hallOfFame?.evaderDiversity, 3)}`} hint="mean behavioral descriptor distance" />
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <MetricCard label="Fixed benchmark C" value={benchmark ? fmt(benchmark.chaser.meanFitness) : '—'} hint={benchmark ? `${benchmark.chaser.matches} permanent reference matches · generation champion` : 'frozen-suite validation'} />
              <MetricCard label="Fixed benchmark R" value={benchmark ? fmt(benchmark.evader.meanFitness) : '—'} hint={benchmark ? `${benchmark.evader.matches} matches · ${((benchmark.evader.paceCompletion ?? 0) * 100).toFixed(0)}% pace · generation champion` : 'frozen-suite validation'} />
              <MetricCard label="Benchmark suite" value={benchmark ? `v${benchmark.suiteRevision}` : `v${diagnostics.benchmarkSuiteRevision ?? 0}`} hint="same frozen opponents, seeds and start modes across generations" />
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <MetricCard label="Retained Chaser" value={retainedChaser ? `g${retainedChaser.generation}` : '—'} hint={retainedChaser ? `generalist ${retainedChaser.score.toFixed(1)} · benchmark ${retainedChaser.benchmark.meanFitness.toFixed(1)}` : 'best validated generalist so far'} />
              <MetricCard label="Retained Runner" value={retainedRunner ? `g${retainedRunner.generation}` : '—'} hint={retainedRunner ? `generalist ${retainedRunner.score.toFixed(1)} · ${((retainedRunner.benchmark.paceCompletion ?? 0) * 100).toFixed(0)}% pace` : 'best validated generalist so far'} />
              <MetricCard label="Runner retained fitness" value={retainedRunner ? retainedRunner.benchmark.meanFitness.toFixed(1) : '—'} hint="frozen benchmark; low-pace camping is penalized in retention score" />
              <MetricCard label="Retention margin" value="+1.5" hint="challenger must clearly beat incumbent; population selection itself is unchanged" />
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <MetricCard label="Runner right-drive" value={benchmark ? `${(benchmark.evader.rightActionShare * 100).toFixed(1)}%` : '—'} hint="independent control active; can overlap jump" />
              <MetricCard label="Runner jump" value={benchmark ? `${(benchmark.evader.jumpActionShare * 100).toFixed(1)}%` : '—'} hint="independent control active" />
              <MetricCard label="Runner sprint" value={benchmark ? `${(benchmark.evader.sprintActionShare * 100).toFixed(1)}%` : '—'} hint="effective sprint boost; saturated Sprint without movement no longer counts" />
              <MetricCard label="Runner idle" value={benchmark ? `${(benchmark.evader.idleActionShare * 100).toFixed(1)}%` : '—'} hint="no control above activation threshold" />
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <MetricCard label="Runner pace completion" value={balance?.runnerPaceCompletion != null ? `${(balance.runnerPaceCompletion * 100).toFixed(1)}%` : '—'} hint={`${diagnostics.trainingFitnessConfig?.runnerPaceTargetPxPerWindow ?? 0}px target every 2s`} />
              <MetricCard label="Runner pace bonus / ep" value={balance?.runnerPaceBonusPerEpisode != null ? `+${balance.runnerPaceBonusPerEpisode.toFixed(2)}` : '—'} hint={`capped at +${diagnostics.trainingFitnessConfig?.runnerPaceRewardPerWindow ?? 0} per window`} />
              <MetricCard label="Chaser pursuit bonus / ep" value={balance?.chaserPursuitBonusPerEpisode != null ? `+${balance.chaserPursuitBonusPerEpisode.toFixed(2)}` : '—'} hint="runner-visited platforms; capped +5 / 2s" />
              <MetricCard label="Safe right / episode" value={balance?.runnerFrontierExpansionViewportsPerEpisode != null ? `${balance.runnerFrontierExpansionViewportsPerEpisode.toFixed(2)} view` : '—'} hint="diagnostic distance only; no longer linear fitness" />
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <MetricCard label="Close encounters / ep" value={balance?.closeEncountersPerEpisode != null ? balance.closeEncountersPerEpisode.toFixed(2) : '—'} hint="nearest Runner enters ≤180px" />
              <MetricCard label="Successful evades / ep" value={balance?.successfulEvadesPerEpisode != null ? balance.successfulEvadesPerEpisode.toFixed(2) : '—'} hint="encounter opens back beyond 380px without a tag" />
              <MetricCard label="Mean chase distance" value={balance?.meanNearestRunnerDistancePx != null ? `${balance.meanNearestRunnerDistancePx.toFixed(0)} px` : '—'} hint={balance?.timeWithin400Pct != null ? `${(balance.timeWithin400Pct * 100).toFixed(0)}% of time within 400px` : 'nearest Runner'} />
              <MetricCard label="Tags after Runner fall" value={balance?.tagsSoonAfterRunnerFallPerEpisode != null ? balance.tagsSoonAfterRunnerFallPerEpisode.toFixed(2) : '—'} hint="tags within 2s of a Runner fall/respawn" />
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <MetricCard label="Runner landings / ep" value={balance?.runnerPlatformLandingsPerEpisode != null ? balance.runnerPlatformLandingsPerEpisode.toFixed(2) : '—'} hint={balance?.runnerBranchLandingsPerEpisode != null ? `${balance.runnerBranchLandingsPerEpisode.toFixed(2)} on branch routes` : 'new-platform landings'} />
              <MetricCard label="Chaser landings / ep" value={balance?.chaserPlatformLandingsPerEpisode != null ? balance.chaserPlatformLandingsPerEpisode.toFixed(2) : '—'} hint={balance?.chaserBranchLandingsPerEpisode != null ? `${balance.chaserBranchLandingsPerEpisode.toFixed(2)} on branch routes` : 'new-platform landings'} />
              <MetricCard label="Pursuit landings / ep" value={balance?.chaserPursuitLandingsPerEpisode != null ? balance.chaserPursuitLandingsPerEpisode.toFixed(2) : '—'} hint="first landing on Runner-used terrain" />
              <MetricCard label="Pace windows met / ep" value={balance?.runnerPaceWindowsSatisfiedPerEpisode != null ? balance.runnerPaceWindowsSatisfiedPerEpisode.toFixed(2) : '—'} hint="6 possible in a 12s episode" />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-emerald-300" /><h3 className="font-semibold text-white">Fixed cross-generation benchmark</h3></div>
              <LineChart
                series={[
                  { label: 'Chaser benchmark', values: benchmarkHistory.map(m => m.chaser.meanFitness) },
                  { label: 'Runner benchmark', values: benchmarkHistory.map(m => m.evader.meanFitness) },
                ]}
                emptyLabel="Complete at least two generations to compare champions on the permanent benchmark suite."
              />
              <p className="mt-2 text-xs text-gray-500">Each generation champion is tested against the same frozen run-start reference bank, permanent seeds, and visual/varied/mid-game scenario mix. These matches never alter breeding fitness or Elo. A separate retained-generalist layer uses the frozen suite only to decide which already-evolved policy is kept for the visible game/checkpoint, preventing transient co-evolutionary champions from replacing stronger generalists. The suite revision changes when a new run/import is seeded, enabled physics abilities change, or pace/pursuit shaping is retuned.</p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-300" /><h3 className="font-semibold text-white">Best fitness by generation</h3></div>
              <LineChart series={[{ label: 'Chaser', values: chaserHistory.map(m => m.bestFitness) }, { label: 'Evader', values: evaderHistory.map(m => m.bestFitness) }]} />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Game balance by generation</h3></div>
              <LineChart
                series={[
                  { label: 'Chaser tag %', values: balanceHistory.map(m => m.tagRate * 100) },
                  { label: 'Runner clean survival %', values: balanceHistory.map(m => m.survivalRate * 100) },
                ]}
                emptyLabel="Complete generations to populate the balance chart."
              />
              <p className="mt-2 text-xs text-gray-500">Measured only on current-population matchups; Hall-of-Fame tests are excluded so the balance signal stays comparable.</p>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Runner pace & safe progression by generation</h3></div>
              <LineChart
                series={[
                  { label: 'Pace completion %', values: balanceHistory.map(m => (m.runnerPaceCompletion ?? 0) * 100) },
                  { label: 'Full windows met %', values: balanceHistory.map(m => ((m.runnerPaceWindowsSatisfiedPerEpisode ?? 0) / 6) * 100) },
                ]}
                emptyLabel="Complete generations to populate pace diagnostics."
              />
              <p className="mt-2 text-xs text-gray-500">Both lines are normalized percentages. The pace reward saturates inside each 2-second window, so 100% means the minimum movement target is being met—not that the Runner should keep accelerating.</p>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-amber-300" /><h3 className="font-semibold text-white">Chase interaction by generation</h3></div>
              <LineChart series={[
                { label: 'Close encounters / ep', values: balanceHistory.map(m => m.closeEncountersPerEpisode ?? 0) },
                { label: 'Successful evades / ep', values: balanceHistory.map(m => m.successfulEvadesPerEpisode ?? 0) },
                { label: 'Tags after Runner fall / ep', values: balanceHistory.map(m => m.tagsSoonAfterRunnerFallPerEpisode ?? 0) },
                { label: 'Chaser pursuit bonus / ep', values: balanceHistory.map(m => m.chaserPursuitBonusPerEpisode ?? 0) },
              ]} emptyLabel="Complete generations to populate interaction diagnostics." />
              <p className="mt-2 text-xs text-gray-500">This separates actual pursuit/escape interactions from catches caused mainly by a Runner missing a platform and respawning.</p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-rose-300" /><h3 className="font-semibold text-white">Fall rate by generation</h3></div>
              <LineChart
                series={[
                  { label: 'Chaser fall %', values: balanceHistory.map(m => (m.chaserFallRate ?? 0) * 100) },
                  { label: 'Runner fall %', values: balanceHistory.map(m => (m.runnerFallRate ?? 0) * 100) },
                ]}
                emptyLabel="Complete generations to populate the fall-rate chart."
              />
              <p className="mt-2 text-xs text-gray-500">Rate = percentage of fixed-horizon current-population evaluation matches containing at least one fall by that role. Matches continue after falls and tags; Hall-of-Fame tests are excluded.</p>
            </div>

            <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-4 text-sm text-gray-400 leading-relaxed">
              <strong className="text-violet-200">Training architecture:</strong> persistent NEAT species now carry lineage age and progress across generations, with conservative stagnation pruning and protected young/top lineages. The compact 25-input policy now has factorized left-drive, right-drive, jump and sprint outputs, so horizontal movement and jumping can happen simultaneously. Sprint and controlled jump remain manual abilities. Every genome is evaluated against common opponent panels plus Hall of Fame champions. Recent champions are retained alongside a strength-aware behaviorally diverse historical archive, while a separate fixed benchmark tracks cross-generation progress and now gates only visible/generalist champion retention, never population breeding. Runner shaping is now a capped 2-second pace requirement rather than an unbounded distance reward, and Chaser shaping gives a small capped signal for safely following Runner-used terrain. Jump requires a release before it can fire again, and later procedural terrain can branch into upper/lower routes that reconnect. The worker pool preloads genomes and batches episodes for lower messaging overhead.
            </div>
          </div>
        )}

        {tab === 'fitness' && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="font-semibold text-white mb-3">Population fitness — best vs mean</h3>
              <LineChart series={[
                { label: 'Chaser best', values: chaserHistory.map(m => m.bestFitness) },
                { label: 'Evader best', values: evaderHistory.map(m => m.bestFitness) },
                { label: 'Chaser mean', values: chaserHistory.map(m => m.averageFitness) },
                { label: 'Runner mean', values: evaderHistory.map(m => m.averageFitness) },
              ]} />
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="font-semibold text-white mb-3">Topology complexity</h3>
              <LineChart series={[
                { label: 'Chaser avg nodes', values: chaserHistory.map(m => m.averageNodes) },
                { label: 'Evader avg nodes', values: evaderHistory.map(m => m.averageNodes) },
                { label: 'Chaser avg links', values: chaserHistory.map(m => m.averageConnections) },
              ]} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Species count</h3><LineChart series={[{ label: 'Chaser active', values: chaserHistory.map(m => m.speciesCount) }, { label: 'Evader active', values: evaderHistory.map(m => m.speciesCount) }, { label: 'Chaser reproducing', values: chaserHistory.map(m => m.reproductiveSpeciesCount ?? m.speciesCount) }, { label: 'Evader reproducing', values: evaderHistory.map(m => m.reproductiveSpeciesCount ?? m.speciesCount) }]} /></div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Species longevity</h3><LineChart series={[{ label: 'Chaser oldest age', values: chaserHistory.map(m => m.oldestSpeciesAge ?? 0) }, { label: 'Evader oldest age', values: evaderHistory.map(m => m.oldestSpeciesAge ?? 0) }, { label: 'Chaser stagnant', values: chaserHistory.map(m => m.stagnantSpeciesCount ?? 0) }, { label: 'Evader stagnant', values: evaderHistory.map(m => m.stagnantSpeciesCount ?? 0) }]} /></div>
            </div>
          </div>
        )}

        {tab === 'network' && (
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[360px_1fr] gap-5">
            <div className="space-y-3">
              <div className="flex rounded-lg border border-gray-800 overflow-hidden">
                <button onClick={() => setRole('chaser')} className={`flex-1 py-2 text-xs font-semibold ${role === 'chaser' ? 'bg-red-500/20 text-red-200' : 'bg-gray-950 text-gray-500'}`}>Chaser champion</button>
                <button onClick={() => setRole('evader')} className={`flex-1 py-2 text-xs font-semibold ${role === 'evader' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-gray-950 text-gray-500'}`}>Evader champion</button>
              </div>
              <FitnessSummary title={`${role === 'chaser' ? 'Chaser' : 'Evader'} champion`} metrics={selectedMetrics} />
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-400 leading-relaxed">
                Green/red links are feed-forward weights; recurrent links are one-step delayed memory edges. The Architecture tab controls starting size plus independent evolution switches and hard caps for layers, nodes and recurrent connections.
              </div>
            </div>
            <NetworkGraph genome={selectedGenome} />
          </div>
        )}

        {tab === 'architecture' && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="flex items-center gap-2"><Brain className="h-4 w-4 text-violet-300" /><h3 className="font-semibold text-white">Network architecture experiment suite</h3></div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">Configure generation-1 depth/width/memory and independently decide whether hidden layers, hidden nodes, and recurrent connections may evolve afterward. Applying a new architecture intentionally starts both populations at generation 1 so benchmark comparisons are clean. The settings are stored in full checkpoints and analysis exports.</p>
                </div>
                <label className="flex items-center gap-2 rounded border border-gray-700 bg-black/20 px-3 py-2 text-xs text-gray-300"><input type="checkbox" checked={architectureDraft.linkedRoles} onChange={e => setArchitectureDraft(prev => ({ ...prev, linkedRoles: e.target.checked, runner: e.target.checked ? { ...prev.chaser, hiddenLayers: [...prev.chaser.hiddenLayers] } : prev.runner }))} />Use same architecture for both roles</label>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-white">Experiment recipes</div><div className="text-[10px] text-gray-500">Whole-suite presets make role comparisons reproducible. Selecting one only edits the draft; Apply architecture & restart still controls when it takes effect.</div></div></div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {(Object.entries(NETWORK_ARCHITECTURE_SUITE_PRESETS) as [NetworkArchitectureSuitePreset, typeof NETWORK_ARCHITECTURE_SUITE_PRESETS[NetworkArchitectureSuitePreset]][]).map(([id, recipe]) => (
                    <button key={id} type="button" onClick={() => setArchitectureDraft(sanitizeNetworkArchitectureSuite(recipe.config))} className={`rounded-lg border px-3 py-2 text-left ${id === 'balanced_memory' ? 'border-fuchsia-500/40 bg-fuchsia-950/15' : 'border-gray-800 bg-black/20'}`}>
                      <div className={`text-[11px] font-semibold ${id === 'balanced_memory' ? 'text-fuchsia-200' : 'text-gray-200'}`}>{recipe.label}{id === 'balanced_memory' ? ' · recommended' : ''}</div>
                      <div className="mt-1 text-[9px] leading-relaxed text-gray-600">{recipe.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
                <span className="text-gray-300">Suggested sequence:</span> FF control → Memory Lite → Balanced Memory. Use Memory Discovery to test whether recurrence emerges without being seeded; Fixed Memory Control isolates recurrent state from structural growth; Deep Memory is a later high-capacity stress test.
              </div>
            </div>

            <ArchitectureRoleEditor role="chaser" config={architectureDraft.chaser} onChange={next => setArchitectureDraft(prev => ({ ...prev, chaser: next, runner: prev.linkedRoles ? { ...next, hiddenLayers: [...next.hiddenLayers] } : prev.runner }))} />
            <ArchitectureRoleEditor role="runner" config={architectureDraft.linkedRoles ? architectureDraft.chaser : architectureDraft.runner} disabled={architectureDraft.linkedRoles} onChange={next => setArchitectureDraft(prev => ({ ...prev, runner: next }))} />

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h4 className="font-semibold text-white">Apply experiment</h4><p className="text-xs text-gray-500">Architecture changes cannot be mixed into an existing population. Applying resets populations, species, Hall of Fame, Elo, benchmark bank and generation history.</p></div>
                <div className="flex gap-2"><button disabled={!architectureDirty} onClick={() => setArchitectureDraft(sanitizeNetworkArchitectureSuite(networkArchitecture))} className="rounded border border-gray-700 px-3 py-2 text-xs disabled:opacity-35">Revert draft</button><button disabled={!architectureDirty} onClick={() => { const applied = sanitizeNetworkArchitectureSuite(architectureDraft); onApplyNetworkArchitecture(applied); setArchitectureDraft(applied); setStatus('Architecture applied. Fresh populations started at generation 1.'); }} className="rounded bg-violet-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-35">Apply architecture & restart</button></div>
              </div>
              {!architectureDirty && <p className="mt-3 text-[10px] text-emerald-300">Draft matches the currently applied architecture.</p>}
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-5">
            {(['chaser', 'evader'] as const).map(r => {
              const counts = r === 'chaser' ? diagnostics.chaserActionDistribution : diagnostics.evaderActionDistribution;
              const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0) || 1;
              return (
                <div key={r} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                  <h3 className={`font-semibold mb-4 ${r === 'chaser' ? 'text-red-300' : 'text-cyan-300'}`}>{r === 'chaser' ? 'Chaser' : 'Evader'} action distribution</h3>
                  <div className="space-y-3">
                    {ACTION_SPACE.map(action => {
                      const n = counts[action] || 0;
                      const pct = (n / total) * 100;
                      return <div key={action}><div className="flex justify-between text-xs mb-1"><span className="font-mono text-gray-300">{action}</span><span className="text-gray-500">{pct.toFixed(1)}%</span></div><div className="h-2 rounded bg-gray-800 overflow-hidden"><div className={`h-full ${r === 'chaser' ? 'bg-red-400/70' : 'bg-cyan-400/70'}`} style={{ width: `${pct}%` }} /></div></div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'models' && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/10 p-4">
              <div className="flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Training analysis recording</h3></div>
              <p className="text-xs leading-relaxed text-gray-500">Export a compact analysis file designed for post-hoc review. It contains the full per-generation analysis log plus three deterministic champion probe episodes (visual, varied and mid-game) sampled every 250 ms with body positions, actions, roles, energy, cooldowns, camera position, platforms and frontier progression.</p>
              <button onClick={onExportAnalysis} className="mt-3 px-3 py-2 rounded border border-cyan-500/40 text-cyan-200 text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" />Export analysis JSON</button>
              <p className="mt-2 text-[10px] text-gray-600">Upload this JSON back into ChatGPT and I can analyze trends and actual learned movement rather than relying only on screenshots or descriptions.</p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-4"><HardDrive className="w-4 h-4 text-violet-300" /><h3 className="font-semibold text-white">Evolution checkpoint persistence</h3></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { onSaveLocalStorage?.(); setStatus('Saving full evolutionary checkpoint locally…'); }} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1"><Save className="w-3.5 h-3.5" />Save</button>
                <button disabled={!hasSavedModel} onClick={() => { onLoadLocalStorage?.(); setStatus('Loading full evolutionary checkpoint…'); }} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1 disabled:opacity-40"><HardDrive className="w-3.5 h-3.5" />Load</button>
                <button onClick={onExportModels} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" />Export checkpoint</button>
                <label className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1 cursor-pointer"><Upload className="w-3.5 h-3.5" />Import checkpoint<input type="file" accept="application/json" className="hidden" onChange={upload} /></label>
              </div>
              {status && <div className="mt-3 text-xs text-violet-200">{status}</div>}
              <p className="mt-4 text-xs text-gray-500 leading-relaxed">Full checkpoints preserve both populations, persistent species/innovation history, Hall of Fame, frozen benchmark references, Elo, diagnostics counters, and manual ability configuration. Checkpoints are captured at completed-generation boundaries so an interrupted evaluator batch can never corrupt evolutionary state. Legacy champion-only JSON remains importable and seeds fresh populations.</p>
            </div>

            <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-4">
              {!confirmReset ? <button onClick={() => setConfirmReset(true)} className="px-3 py-2 rounded border border-red-500/40 text-red-300 text-xs flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />Reset both populations</button> : <div className="flex items-center gap-2"><span className="text-xs text-red-300">Delete all evolved genomes, Hall of Fame entries, and restart at generation 1?</span><button onClick={() => { onResetWeights(); setConfirmReset(false); }} className="px-3 py-1.5 bg-red-500 text-black rounded text-xs font-bold">Reset</button><button onClick={() => setConfirmReset(false)} className="px-3 py-1.5 border border-gray-700 rounded text-xs">Cancel</button></div>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
