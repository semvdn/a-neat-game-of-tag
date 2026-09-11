import React, { useEffect, useMemo, useState } from 'react';
import type { DiagnosticsState } from '../types';
import type { StoredCheckpointSummary } from '../services/checkpointStore';
import { NETWORK_ARCHITECTURE_PRESETS, NETWORK_ARCHITECTURE_PRESET_INFO, NETWORK_ARCHITECTURE_SUITE_PRESETS, sanitizeNetworkArchitectureSuite, type NeatGenerationMetrics, type NeatGenomeData, type NetworkArchitectureConfig, type NetworkArchitecturePreset, type NetworkArchitectureSuiteConfig, type NetworkArchitectureSuitePreset } from '../learning/neat';
import { ACTION_SPACE, POLICY_OUTPUT_SPACE, STATE_VECTOR_SIZE } from '../constants';
import { STATE_VECTOR_LABELS } from '../learning/state';
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
  FolderOpen,
  Trash2,
  Database,
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
  onImportModels?: (json: string, fileName?: string) => Promise<boolean>;
  storedCheckpoints: StoredCheckpointSummary[];
  checkpointLibraryBusy: boolean;
  checkpointLibraryMessage?: string | null;
  onSaveCheckpoint: (name: string) => void;
  onLoadStoredCheckpoint: (id: string) => Promise<boolean>;
  onDeleteStoredCheckpoint: (id: string) => Promise<void>;
  onExportStoredCheckpoint: (id: string) => Promise<void>;
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

const DISPLAY_ACTIONS = [...ACTION_SPACE, 'idle'] as const;

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
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

type LineChartSeries = {
  label: string;
  values: number[];
  tipDigits?: number;
  tipSuffix?: string;
};

const LineChart: React.FC<{
  series: LineChartSeries[];
  height?: number;
  emptyLabel?: string;
  yMin?: number;
  yMax?: number;
}> = ({ series, height = 190, emptyLabel = 'Run evolutionary training to populate this chart.', yMin, yMax }) => {
  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (values.length < 2) {
    return <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">{emptyLabel}</div>;
  }
  const width = 720;
  // Reserve a right-side gutter for current-value labels so they sit at the line tips without
  // overlapping the plot or being clipped by the SVG edge.
  const leftPad = 18;
  const rightPad = 82;
  const topPad = 18;
  const bottomPad = 18;
  const plotRight = width - rightPad;
  const observedMin = Math.min(...values);
  const observedMax = Math.max(...values);
  const min = Number.isFinite(yMin) ? Number(yMin) : observedMin;
  const max = Number.isFinite(yMax) ? Number(yMax) : observedMax;
  const range = Math.max(1e-9, max - min);
  const xFor = (index: number, length: number) => leftPad + (index / Math.max(1, length - 1)) * (plotRight - leftPad);
  const yFor = (value: number) => topPad + (1 - (value - min) / range) * (height - topPad - bottomPad);
  const points = (data: number[]) => data.map((v, i) => `${xFor(i, data.length)},${yFor(v)}`).join(' ');
  const formatTip = (line: LineChartSeries, value: number) => {
    const suffix = line.tipSuffix ?? '';
    const digits = line.tipDigits ?? (suffix === '%' ? 1 : Math.abs(value) >= 100 ? 1 : 2);
    return `${value.toFixed(digits)}${suffix}`;
  };

  // Keep endpoint labels readable when two or more series finish at nearly the same Y position.
  const endpointLabels = series.map((line, seriesIndex) => {
    let lastIndex = -1;
    for (let i = line.values.length - 1; i >= 0; i--) {
      if (Number.isFinite(line.values[i])) { lastIndex = i; break; }
    }
    if (lastIndex < 0) return null;
    const value = line.values[lastIndex];
    const x = xFor(lastIndex, line.values.length);
    const y = yFor(value);
    return { seriesIndex, value, x, y, labelY: y, text: formatTip(line, value) };
  }).filter((value): value is NonNullable<typeof value> => value !== null).sort((a, b) => a.y - b.y);

  const minimumLabelGap = 13;
  const labelMinY = 10;
  const labelMaxY = height - 10;
  for (let i = 0; i < endpointLabels.length; i++) {
    const previous = endpointLabels[i - 1];
    endpointLabels[i].labelY = Math.max(labelMinY, endpointLabels[i].y, previous ? previous.labelY + minimumLabelGap : labelMinY);
  }
  if (endpointLabels.length > 0 && endpointLabels[endpointLabels.length - 1].labelY > labelMaxY) {
    endpointLabels[endpointLabels.length - 1].labelY = labelMaxY;
    for (let i = endpointLabels.length - 2; i >= 0; i--) {
      endpointLabels[i].labelY = Math.min(endpointLabels[i].labelY, endpointLabels[i + 1].labelY - minimumLabelGap);
    }
  }
  const endpointBySeries = new Map(endpointLabels.map(endpoint => [endpoint.seriesIndex, endpoint]));

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-xl border border-gray-800 bg-black/30">
        {[0.25, 0.5, 0.75].map(frac => (
          <line key={frac} x1={leftPad} x2={plotRight} y1={height * frac} y2={height * frac} stroke="currentColor" className="text-gray-800" strokeWidth="1" />
        ))}
        {series.map((line, idx) => {
          const color = lineColors[idx % lineColors.length];
          const endpoint = endpointBySeries.get(idx);
          return (
            <g key={line.label}>
              <polyline
                points={points(line.values)}
                fill="none"
                stroke="currentColor"
                className={color.stroke}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              {endpoint && <>
                <circle cx={endpoint.x} cy={endpoint.y} r="3.4" fill="currentColor" className={color.stroke} />
                {Math.abs(endpoint.labelY - endpoint.y) > 1 && (
                  <line x1={endpoint.x + 4} y1={endpoint.y} x2={plotRight + 7} y2={endpoint.labelY} stroke="currentColor" className={`${color.stroke} opacity-50`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                )}
                <text
                  x={plotRight + 10}
                  y={endpoint.labelY}
                  dominantBaseline="middle"
                  fill="currentColor"
                  className={`${color.legend} text-[10px] font-mono font-semibold`}
                  stroke="#05070b"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {endpoint.text}
                </text>
              </>}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
        {series.map((line, idx) => {
          const color = lineColors[idx % lineColors.length];
          return (
            <span key={line.label} className={color.legend}>
              ● {line.label}
            </span>
          );
        })}
        <span className="ml-auto font-mono text-gray-500">range {fmt(min)} – {fmt(max)}</span>
      </div>
    </div>
  );
};

const TopologyEvolutionChart: React.FC<{
  title: string;
  description: string;
  history: NeatGenerationMetrics[];
  championValue: (metric: NeatGenerationMetrics) => number | undefined;
  averageValue: (metric: NeatGenerationMetrics) => number | undefined;
  digits?: number;
}> = ({ title, description, history, championValue, averageValue, digits = 1 }) => {
  const rows = history
    .map(metric => ({ generation: metric.generation, champion: championValue(metric), average: averageValue(metric) }))
    .filter(row => Number.isFinite(row.champion) || Number.isFinite(row.average));

  if (rows.length < 2) return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{description}</p>
      <div className="mt-4 h-44 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">Complete at least two generations to show model evolution.</div>
    </div>
  );

  const width = 620, height = 220, left = 42, right = 72, top = 16, bottom = 34;
  const generations = rows.map(row => row.generation);
  const minGeneration = Math.min(...generations), maxGeneration = Math.max(...generations);
  const generationRange = Math.max(1, maxGeneration - minGeneration);
  const finiteValues = rows.flatMap(row => [row.champion, row.average]).filter((value): value is number => Number.isFinite(value));
  const maxValue = Math.max(1, ...finiteValues);
  const yMax = maxValue <= 5 ? Math.ceil(maxValue * 4) / 4 : Math.ceil(maxValue);
  const x = (generation: number) => left + ((generation - minGeneration) / generationRange) * (width - left - right);
  const y = (value: number) => top + (1 - value / yMax) * (height - top - bottom);
  const points = (key: 'champion' | 'average') => rows.filter(row => Number.isFinite(row[key])).map(row => `${x(row.generation)},${y(Number(row[key]))}`).join(' ');
  const firstChampion = rows.find(row => Number.isFinite(row.champion))?.champion;
  const lastChampionRow = [...rows].reverse().find(row => Number.isFinite(row.champion));
  const lastAverageRow = [...rows].reverse().find(row => Number.isFinite(row.average));
  const lastChampion = lastChampionRow?.champion;
  const lastAverage = lastAverageRow?.average;
  const delta = Number.isFinite(firstChampion) && Number.isFinite(lastChampion) ? Number(lastChampion) - Number(firstChampion) : undefined;
  const fmtTopology = (value: number | undefined) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
  const deltaLabel = Number.isFinite(delta) ? `${Number(delta) >= 0 ? '+' : ''}${Number(delta).toFixed(digits)}` : '—';
  const midGeneration = Math.round((minGeneration + maxGeneration) / 2);
  const championTip = lastChampionRow && Number.isFinite(lastChampionRow.champion)
    ? { x: x(lastChampionRow.generation), y: y(Number(lastChampionRow.champion)), value: Number(lastChampionRow.champion) }
    : null;
  const averageTip = lastAverageRow && Number.isFinite(lastAverageRow.average)
    ? { x: x(lastAverageRow.generation), y: y(Number(lastAverageRow.average)), value: Number(lastAverageRow.average) }
    : null;
  let championLabelY = championTip?.y ?? 0;
  let averageLabelY = averageTip?.y ?? 0;
  if (championTip && averageTip && Math.abs(championLabelY - averageLabelY) < 14) {
    if (championLabelY <= averageLabelY) {
      championLabelY = Math.max(9, championLabelY - 7);
      averageLabelY = Math.min(height - bottom - 2, averageLabelY + 7);
    } else {
      averageLabelY = Math.max(9, averageLabelY - 7);
      championLabelY = Math.min(height - bottom - 2, championLabelY + 7);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="font-semibold text-white">{title}</h3><p className="mt-1 text-[11px] leading-relaxed text-gray-500">{description}</p></div>
        <div className="shrink-0 text-right text-[10px] text-gray-500">
          <div><span className="text-violet-200 font-mono">{fmtTopology(lastChampion)}</span> champion</div>
          <div><span className="text-cyan-200 font-mono">{fmtTopology(lastAverage)}</span> population mean</div>
          <div><span className="text-gray-300 font-mono">{deltaLabel}</span> champion Δ</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full rounded-xl border border-gray-800 bg-black/30">
        {[0, .25, .5, .75, 1].map(frac => { const tickValue = yMax * (1 - frac); const tickY = top + frac * (height - top - bottom); return <g key={frac}><line x1={left} x2={width-right} y1={tickY} y2={tickY} stroke="currentColor" className="text-gray-800" strokeWidth="1" /><text x={left-7} y={tickY+3} textAnchor="end" fill="currentColor" className="text-gray-600 text-[9px]">{tickValue.toFixed(digits)}</text></g>; })}
        <polyline points={points('average')} fill="none" stroke="currentColor" className="text-cyan-400/70" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={points('champion')} fill="none" stroke="currentColor" className="text-violet-300" strokeWidth="2.6" vectorEffect="non-scaling-stroke" />
        {averageTip && <>
          <circle cx={averageTip.x} cy={averageTip.y} r="3" fill="currentColor" className="text-cyan-300" />
          {Math.abs(averageLabelY-averageTip.y)>1 && <line x1={averageTip.x+4} y1={averageTip.y} x2={width-right+7} y2={averageLabelY} stroke="currentColor" className="text-cyan-400/50" strokeWidth="1" />}
          <text x={width-right+10} y={averageLabelY} dominantBaseline="middle" fill="currentColor" className="text-cyan-200 text-[9px] font-mono font-semibold" stroke="#05070b" strokeWidth="3" paintOrder="stroke">{fmtTopology(averageTip.value)}</text>
        </>}
        {championTip && <>
          <circle cx={championTip.x} cy={championTip.y} r="3.2" fill="currentColor" className="text-violet-300" />
          {Math.abs(championLabelY-championTip.y)>1 && <line x1={championTip.x+4} y1={championTip.y} x2={width-right+7} y2={championLabelY} stroke="currentColor" className="text-violet-300/50" strokeWidth="1" />}
          <text x={width-right+10} y={championLabelY} dominantBaseline="middle" fill="currentColor" className="text-violet-200 text-[9px] font-mono font-semibold" stroke="#05070b" strokeWidth="3" paintOrder="stroke">{fmtTopology(championTip.value)}</text>
        </>}
        <text x={left} y={height-10} textAnchor="middle" fill="currentColor" className="text-gray-600 text-[9px]">g{minGeneration}</text><text x={x(midGeneration)} y={height-10} textAnchor="middle" fill="currentColor" className="text-gray-600 text-[9px]">g{midGeneration}</text><text x={width-right} y={height-10} textAnchor="middle" fill="currentColor" className="text-gray-600 text-[9px]">g{maxGeneration}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px]"><span className="text-violet-300">● Champion</span><span className="text-cyan-300">● Population mean</span><span className="ml-auto text-gray-600">generation →</span></div>
    </div>
  );
};

const ACTION_OUTPUT_LABELS: Record<string, string> = {
  horizontal_drive: 'Signed horizontal drive (left ↔ right)',
  jump: 'Jump control',
  sprint: 'Sprint control',
};

const NetworkGraph: React.FC<{ genome?: NeatGenomeData | null }> = ({ genome }) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
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
    const inputIndexById = new Map(inputs.map((node, index) => [node.id, index]));
    const outputIndexById = new Map(outputs.map((node, index) => [node.id, index]));
    return { pos, inputs, hidden, outputs, hiddenLayers: depthGroups.size, inputIndexById, outputIndexById };
  }, [genome]);

  if (!genome || !layout) {
    return <div className="h-80 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">Champion topology appears after the first completed generation.</div>;
  }

  const enabled = genome.connections.filter(c => c.enabled);
  const recurrent = enabled.filter(c => c.recurrent);
  const feedForward = enabled.filter(c => !c.recurrent);
  const nodeLabel = (node: NeatGenomeData['nodes'][number]) => {
    if (node.type === 'input') {
      const index = layout.inputIndexById.get(node.id) ?? node.id;
      return `Input ${index} · ${STATE_VECTOR_LABELS[index] || 'Unknown sense'}`;
    }
    if (node.type === 'output') {
      const index = layout.outputIndexById.get(node.id) ?? 0;
      const action = POLICY_OUTPUT_SPACE[index] || `output_${index}`;
      return `Output ${index} · ${ACTION_OUTPUT_LABELS[action] || action}`;
    }
    return `Hidden node ${node.id} · depth ${(node.depth ?? 0.5).toFixed(3)}`;
  };
  const hoveredNode = hoveredNodeId == null ? null : genome.nodes.find(node => node.id === hoveredNodeId) || null;
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
          const interactive = n.type === 'input' || n.type === 'output';
          return (
            <g key={n.id} onMouseEnter={() => interactive && setHoveredNodeId(n.id)} onMouseLeave={() => interactive && setHoveredNodeId(current => current === n.id ? null : current)} className={interactive ? 'cursor-help' : undefined}>
              {interactive && <circle cx={p.x} cy={p.y} r={9} fill="transparent"><title>{nodeLabel(n)}</title></circle>}
              <circle cx={p.x} cy={p.y} r={n.type === 'hidden' ? 5 : hoveredNodeId === n.id ? 5 : 3.5} fill="currentColor" className={cls}><title>{nodeLabel(n)}</title></circle>
            </g>
          );
        })}
        <text x="8" y="12" className="fill-gray-500 text-[8px]">{STATE_VECTOR_SIZE} INPUTS</text>
        <text x="140" y="12" className="fill-gray-500 text-[8px]">{layout.hiddenLayers} HIDDEN LAYERS</text>
        <text x="314" y="12" className="fill-gray-500 text-[8px]">{POLICY_OUTPUT_SPACE.length} OUTPUTS</text>
      </svg>
      <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${hoveredNode ? 'border-violet-500/30 bg-violet-950/15 text-violet-100' : 'border-gray-800 bg-black/20 text-gray-500'}`}>
        {hoveredNode ? nodeLabel(hoveredNode) : 'Hover an input or output node to see the exact sense or action it represents.'}
      </div>
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
  const layers = [STATE_VECTOR_SIZE, ...config.hiddenLayers, POLICY_OUTPUT_SPACE.length];
  const hiddenNodes = config.hiddenLayers.reduce((a, b) => a + b, 0);
  const nodes = STATE_VECTOR_SIZE + POLICY_OUTPUT_SPACE.length + hiddenNodes;
  let candidates = 0;
  for (let i = 0; i < layers.length - 1; i++) candidates += layers[i] * layers[i + 1];
  if (config.hiddenLayers.length > 0 && config.inputOutputSkip) candidates += STATE_VECTOR_SIZE * POLICY_OUTPUT_SPACE.length;
  if (config.hiddenLayerSkips && config.hiddenLayers.length > 1) {
    for (let i = 0; i < config.hiddenLayers.length - 1; i++) {
      for (let j = i + 2; j < config.hiddenLayers.length; j++) candidates += config.hiddenLayers[i] * config.hiddenLayers[j];
    }
  }
  return {
    nodes,
    hiddenNodes,
    connections: Math.max(POLICY_OUTPUT_SPACE.length, Math.round(candidates * config.connectionDensity)) + config.initialRecurrentConnections,
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
        <select disabled={disabled} value={config.preset} onChange={e => selectPreset(e.target.value as NetworkArchitecturePreset)} className={`rounded border px-2 py-1.5 text-xs font-semibold disabled:opacity-50 ${config.preset === 'custom' ? 'border-gray-700 bg-gray-950 text-gray-200' : 'border-violet-400/60 bg-violet-950/40 text-violet-100'}`} title="Selected architecture preset">
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
  storedCheckpoints,
  checkpointLibraryBusy,
  checkpointLibraryMessage,
  onSaveCheckpoint,
  onLoadStoredCheckpoint,
  onDeleteStoredCheckpoint,
  onExportStoredCheckpoint,
  networkArchitecture,
  onApplyNetworkArchitecture,
}) => {
  const [tab, setTab] = useState<'overview' | 'fitness' | 'network' | 'architecture' | 'actions' | 'models'>('overview');
  const [role, setRole] = useState<'chaser' | 'evader'>('chaser');
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [architectureDraft, setArchitectureDraft] = useState<NetworkArchitectureSuiteConfig>(() => sanitizeNetworkArchitectureSuite(networkArchitecture));
  useEffect(() => setArchitectureDraft(sanitizeNetworkArchitectureSuite(networkArchitecture)), [networkArchitecture]);
  const architectureDirty = JSON.stringify(sanitizeNetworkArchitectureSuite(architectureDraft)) !== JSON.stringify(sanitizeNetworkArchitectureSuite(networkArchitecture));
  const selectedSuitePreset = (Object.entries(NETWORK_ARCHITECTURE_SUITE_PRESETS) as [NetworkArchitectureSuitePreset, typeof NETWORK_ARCHITECTURE_SUITE_PRESETS[NetworkArchitectureSuitePreset]][]).find(([, recipe]) => JSON.stringify(sanitizeNetworkArchitectureSuite(recipe.config)) === JSON.stringify(sanitizeNetworkArchitectureSuite(architectureDraft)))?.[0] || null;
  if (!isOpen) return null;

  const chaserHistory = diagnostics.chaserNeatHistory || [];
  const evaderHistory = diagnostics.evaderNeatHistory || [];
  const balanceHistory = diagnostics.balanceHistory || [];
  const balance = diagnostics.lastGenerationBalance;
  const retainedChaser = diagnostics.chaserGeneralistChampion;
  const retainedRunner = diagnostics.evaderGeneralistChampion;
  const showcase = diagnostics.showcasePair;
  const chaserMetrics = diagnostics.lastChaserNeatMetrics;
  const evaderMetrics = diagnostics.lastEvaderNeatMetrics;
  const selectedGenome = role === 'chaser' ? diagnostics.chaserChampionGenome : diagnostics.evaderChampionGenome;
  const selectedMetrics = role === 'chaser' ? chaserMetrics : evaderMetrics;
  const generation = diagnostics.generation || Math.max(chaserMetrics?.generation || 0, evaderMetrics?.generation || 0);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportModels) return;
    try {
      const ok = await onImportModels(await file.text(), file.name);
      setStatus(ok ? 'Import accepted.' : 'Import failed.');
    } catch {
      setStatus('Import failed.');
    }
    setTimeout(() => setStatus(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col text-gray-200">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-800 bg-gray-950 px-5 py-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center"><Brain className="w-5 h-5 text-violet-300" /></div>
        <div>
          <div className="flex items-center gap-2"><h2 className="font-bold text-lg text-white">NEAT Evolution Diagnostics</h2><span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">population based</span></div>
          <p className="text-xs text-gray-500">Key training health at a glance, with detailed evolution and run tools in separate tabs.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-black/30 p-1" title="Champion-view speed">
            <MonitorPlay className="w-3.5 h-3.5 text-cyan-300 ml-1" />
            <span className="text-[10px] uppercase tracking-wider text-cyan-300 mr-1">View</span>
            {[0.5, 1, 2, 5, 10].map(speed => (
              <button key={speed} aria-pressed={visualSpeed === speed} onClick={() => onSetVisualSpeed(speed)} className={`px-2 py-1 rounded text-xs font-mono ${visualSpeed === speed ? 'bg-cyan-500 text-black' : 'text-gray-500 hover:text-white'}`}>{speed}x</button>
            ))}
            <button onClick={onToggleVisualPause} aria-label={isVisualPaused ? 'Resume champion view' : 'Pause champion view'} className="p-1.5 rounded hover:bg-gray-900 text-cyan-200" title={isVisualPaused ? 'Resume champion view' : 'Pause champion view'}>{isVisualPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
            <button onClick={onStepFrame} disabled={!isVisualPaused} aria-label="Step champion view one frame" className="p-1.5 rounded hover:bg-gray-900 text-cyan-200 disabled:cursor-not-allowed disabled:text-gray-700 disabled:hover:bg-transparent" title={isVisualPaused ? "Step champion view one frame" : "Pause the champion view to step frames"}><FastForward className="w-4 h-4" /></button>
            <button onClick={onResetChampionGame} aria-label="Reset champion arena" className="p-1.5 rounded hover:bg-gray-900 text-cyan-200" title="Reset champion game only"><RotateCcw className="w-4 h-4" /></button>
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
              {diagnostics.trainingWorkerCount || 1} worker{(diagnostics.trainingWorkerCount || 1) === 1 ? '' : 's'}
            </span>
            {(diagnostics.trainingRecoveryCount || 0) > 0 && (
              <span className="text-[10px] font-mono text-orange-300" title={diagnostics.trainingLastRecoveryReason || 'Recovered stalled evaluator batch'}>
                {diagnostics.trainingRecoveryCount} recovered
              </span>
            )}
            <button onClick={onToggleTrainingPause} aria-label={isTrainingPaused ? 'Resume background training' : 'Pause background training'} className="p-1.5 rounded hover:bg-gray-900 text-amber-200" title={isTrainingPaused ? 'Resume background training' : 'Pause background training'}>{isTrainingPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
          </div>
          <button onClick={onClose} aria-label="Close diagnostics" title="Close diagnostics" className="p-2 rounded border border-gray-800 hover:bg-gray-900"><X className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-gray-900 bg-gray-950 px-5 pt-3">
        {[
          ['overview', Activity, 'Overview'],
          ['fitness', Trophy, 'Fitness'],
          ['network', Network, 'Topology'],
          ['architecture', Brain, 'Architecture'],
          ['actions', BarChart3, 'Actions'],
          ['models', HardDrive, 'Runs & data'],
        ].map(([id, Icon, label]) => {
          const C = Icon as React.FC<{ className?: string }>;
          return <button key={String(id)} aria-pressed={tab === id} onClick={() => setTab(id as typeof tab)} className={`flex shrink-0 items-center gap-2 px-3 py-2 text-xs border-b-2 ${tab === id ? 'border-violet-400 text-violet-200' : 'border-transparent text-gray-500 hover:text-gray-300'}`}><C className="w-4 h-4" />{String(label)}</button>;
        })}
      </div>

      <main className="flex-1 overflow-auto p-5">
        {tab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">Training snapshot</h3>
                <p className="mt-1 text-xs text-gray-500">Only the signals needed to judge learning health and gameplay quality. Detailed evolution, topology, actions and run data stay in their dedicated tabs and exports.</p>
              </div>
              <span className="rounded-full border border-gray-800 bg-black/25 px-2.5 py-1 text-[10px] text-gray-500">last completed generation</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <MetricCard label="Generation" value={generation} hint="one full population evaluation" />
              <MetricCard label="Training rate" value={`${formatTrainingRate(diagnostics.trainingEpisodesPerSecond)} ep/s`} hint={`${diagnostics.trainingWorkerCount || 1} worker${(diagnostics.trainingWorkerCount || 1) === 1 ? '' : 's'} · max-throughput background training`} />
              <MetricCard label="Chaser best" value={fmt(chaserMetrics?.bestFitness)} hint="best population fitness this generation" />
              <MetricCard label="Runner best" value={fmt(evaderMetrics?.bestFitness)} hint="best population fitness this generation" />
              <MetricCard label="Species C / R" value={`${chaserMetrics?.speciesCount ?? '—'} / ${evaderMetrics?.speciesCount ?? '—'}`} hint="active evolutionary niches" />
              <MetricCard label="Clean tags / ep" value={balance?.cleanTagsPerEpisode != null ? balance.cleanTagsPerEpisode.toFixed(2) : '—'} hint="contact tags not caused by a recent Runner fall" />
              <MetricCard label="Runner pace" value={balance?.runnerPaceCompletion != null ? `${(balance.runnerPaceCompletion * 100).toFixed(0)}%` : '—'} hint={`${diagnostics.trainingFitnessConfig?.runnerPaceTargetPxPerWindow ?? 0}px target every 2s`} />
              <MetricCard label="Mean chase distance" value={balance?.meanNearestRunnerDistancePx != null ? `${balance.meanNearestRunnerDistancePx.toFixed(0)} px` : '—'} hint={balance?.timeWithin400Pct != null ? `${(balance.timeWithin400Pct * 100).toFixed(0)}% of time within 400px` : 'nearest reachable Runner'} />
              <MetricCard label="Chaser fall / escape" value={balance ? `${((balance.chaserFallRate ?? 0) * 100).toFixed(0)}% / ${((balance.chaserEscapeRate ?? 0) * 100).toFixed(0)}%` : '—'} hint="physical falls / terminal lost-chase escapes" />
              <MetricCard label="Runner fall" value={balance?.runnerFallRate != null ? `${(balance.runnerFallRate * 100).toFixed(0)}%` : '—'} hint="population matches containing a Runner fall" />
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <MetricCard label="Retained Chaser" value={retainedChaser ? `g${retainedChaser.generation}` : '—'} hint={retainedChaser ? `traversal ${fmt(retainedChaser.traversalScore)} ${retainedChaser.traversalGatePassed ? '✓' : '✗'} · ${((retainedChaser.traversalCompletion ?? 0) * 100).toFixed(0)}% demand completion · ${(retainedChaser.traversalUsefulPlatformLandingsPerEpisode ?? retainedChaser.traversalPlatformLandingsPerEpisode ?? 0).toFixed(2)} useful landings/ep · pursuit ${fmt(retainedChaser.contemporaryPursuitScore)}` : 'best validated generalist so far'} />
              <MetricCard label="Retained Runner" value={retainedRunner ? `g${retainedRunner.generation}` : '—'} hint={retainedRunner ? `${((retainedRunner.contemporaryPaceCompletion ?? 0) * 100).toFixed(0)}% contemporary pace · ${((retainedRunner.benchmark.paceCompletion ?? 0) * 100).toFixed(0)}% benchmark pace` : 'best validated generalist so far'} />
              <MetricCard label="Showcase pair" value={showcase ? `g${showcase.chaserGeneration} / g${showcase.runnerGeneration}` : '—'} hint={showcase ? `${(showcase.cleanTagsPerEpisode ?? showcase.tagsPerEpisode).toFixed(2)} clean tags/ep · ${(showcase.runnerPaceCompletion * 100).toFixed(0)}% Runner pace · demo/export only` : 'candidate demo/export pair; separate from the champion arena'} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-300" /><h3 className="font-semibold text-white">Best fitness trend</h3></div>
                <LineChart series={[{ label: 'Chaser', values: chaserHistory.map(m => m.bestFitness) }, { label: 'Runner', values: evaderHistory.map(m => m.bestFitness) }]} />
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4">
                <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Gameplay trend</h3></div>
                <LineChart
                  series={[
                    { label: 'Tag rate %', values: balanceHistory.map(m => m.tagRate * 100), tipDigits: 1, tipSuffix: '%' },
                    { label: 'Clean survival %', values: balanceHistory.map(m => m.survivalRate * 100), tipDigits: 1, tipSuffix: '%' },
                    { label: 'Runner pace %', values: balanceHistory.map(m => (m.runnerPaceCompletion ?? 0) * 100), tipDigits: 1, tipSuffix: '%' },
                  ]}
                  emptyLabel="Complete generations to populate gameplay telemetry."
                />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
                <div className="flex items-center gap-2 mb-1"><Trophy className="w-4 h-4 text-amber-300" /><h3 className="font-semibold text-white">Population win rate</h3></div>
                <p className="mb-3 text-[11px] leading-relaxed text-gray-500">A match with at least one contact tag is a Chaser win; a tag-free match is a Runner win.</p>
                <LineChart
                  series={[
                    { label: 'Chaser win %', values: balanceHistory.map(m => m.tagRate * 100), tipDigits: 1, tipSuffix: '%' },
                    { label: 'Runner win %', values: balanceHistory.map(m => (1 - m.tagRate) * 100), tipDigits: 1, tipSuffix: '%' },
                  ]}
                  yMin={0}
                  yMax={100}
                  emptyLabel="Complete generations to populate win-rate telemetry."
                />
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-rose-300" /><h3 className="font-semibold text-white">Failure trend</h3></div>
                <LineChart
                  series={[
                    { label: 'Chaser fall %', values: balanceHistory.map(m => (m.chaserFallRate ?? 0) * 100), tipDigits: 1, tipSuffix: '%' },
                    { label: 'Chaser escape %', values: balanceHistory.map(m => (m.chaserEscapeRate ?? 0) * 100), tipDigits: 1, tipSuffix: '%' },
                    { label: 'Runner fall %', values: balanceHistory.map(m => (m.runnerFallRate ?? 0) * 100), tipDigits: 1, tipSuffix: '%' },
                  ]}
                  emptyLabel="Complete generations to populate failure telemetry."
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'fitness' && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="font-semibold text-white mb-3">Population fitness — best vs mean</h3>
              <LineChart series={[
                { label: 'Chaser best', values: chaserHistory.map(m => m.bestFitness) },
                { label: 'Runner best', values: evaderHistory.map(m => m.bestFitness) },
                { label: 'Chaser mean', values: chaserHistory.map(m => m.averageFitness) },
                { label: 'Runner mean', values: evaderHistory.map(m => m.averageFitness) },
              ]} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Species count</h3><LineChart series={[{ label: 'Chaser active', values: chaserHistory.map(m => m.speciesCount), tipDigits: 0 }, { label: 'Runner active', values: evaderHistory.map(m => m.speciesCount), tipDigits: 0 }, { label: 'Chaser reproducing', values: chaserHistory.map(m => m.reproductiveSpeciesCount ?? m.speciesCount), tipDigits: 0 }, { label: 'Runner reproducing', values: evaderHistory.map(m => m.reproductiveSpeciesCount ?? m.speciesCount), tipDigits: 0 }]} /></div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Species longevity</h3><LineChart series={[{ label: 'Chaser oldest age', values: chaserHistory.map(m => m.oldestSpeciesAge ?? 0), tipDigits: 0 }, { label: 'Runner oldest age', values: evaderHistory.map(m => m.oldestSpeciesAge ?? 0), tipDigits: 0 }, { label: 'Chaser stagnant', values: chaserHistory.map(m => m.stagnantSpeciesCount ?? 0), tipDigits: 0 }, { label: 'Runner stagnant', values: evaderHistory.map(m => m.stagnantSpeciesCount ?? 0), tipDigits: 0 }]} /></div>
            </div>
          </div>
        )}

        {tab === 'network' && (
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="grid lg:grid-cols-[360px_1fr] gap-5">
              <div className="space-y-3">
                <div className="flex rounded-lg border border-gray-800 overflow-hidden">
                  <button onClick={() => setRole('chaser')} className={`flex-1 py-2 text-xs font-semibold ${role === 'chaser' ? 'bg-red-500/20 text-red-200' : 'bg-gray-950 text-gray-500'}`}>Chaser champion</button>
                  <button onClick={() => setRole('evader')} className={`flex-1 py-2 text-xs font-semibold ${role === 'evader' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-gray-950 text-gray-500'}`}>Runner champion</button>
                </div>
                <FitnessSummary title={`${role === 'chaser' ? 'Chaser' : 'Runner'} champion`} metrics={selectedMetrics} />
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-400 leading-relaxed">Green/red links are feed-forward weights; recurrent links are one-step delayed memory edges. The Architecture tab controls starting size plus independent evolution switches and hard caps for layers, nodes and recurrent connections.</div>
              </div>
              <NetworkGraph genome={selectedGenome} />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-gray-900 pt-5"><div><h3 className="font-semibold text-white">{role === 'chaser' ? 'Chaser' : 'Runner'} model evolution</h3><p className="mt-1 text-xs text-gray-500">Champion structure versus the population mean across completed generations. These views separate capacity, depth, connectivity and recurrent memory so structural changes are easier to interpret than a single complexity score.</p></div><span className="rounded-full border border-gray-800 bg-black/25 px-2.5 py-1 text-[10px] text-gray-500">role follows the champion selector above</span></div>
            <div className="grid lg:grid-cols-2 gap-4">
              <TopologyEvolutionChart title="Hidden nodes" description="How much internal representational capacity evolved beyond the fixed input/output layer." history={role === 'chaser' ? chaserHistory : evaderHistory} championValue={metric => metric.championHiddenNodes} averageValue={metric => metric.averageHiddenNodes} digits={1} />
              <TopologyEvolutionChart title="Hidden layers" description="Changes in feed-forward depth; useful for spotting when the model starts composing more stages of processing." history={role === 'chaser' ? chaserHistory : evaderHistory} championValue={metric => metric.championHiddenLayers} averageValue={metric => metric.averageHiddenLayers} digits={1} />
              <TopologyEvolutionChart title="Enabled connections" description="Growth or pruning in the active wiring of the network, shown independently from node count." history={role === 'chaser' ? chaserHistory : evaderHistory} championValue={metric => metric.championConnections} averageValue={metric => metric.averageConnections} digits={1} />
              <TopologyEvolutionChart title="Recurrent memory links" description="One-step delayed recurrent connections, showing when memory capacity appears and whether it spreads through the population." history={role === 'chaser' ? chaserHistory : evaderHistory} championValue={metric => metric.championRecurrentConnections} averageValue={metric => metric.averageRecurrentConnections} digits={1} />
            </div>
          </div>
        )}

        {tab === 'architecture' && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="flex items-center gap-2"><Brain className="h-4 w-4 text-violet-300" /><h3 className="font-semibold text-white">Network architecture</h3></div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">Configure generation-1 depth/width/memory and independently decide whether hidden layers, hidden nodes, and recurrent connections may evolve afterward. Applying a new architecture intentionally starts both populations at generation 1 so benchmark comparisons are clean. The settings are stored in full checkpoints and analysis exports.</p>
                </div>
                <label className={`flex items-center gap-2 rounded border border-gray-700 bg-black/20 px-3 py-2 text-xs text-gray-300`}><input type="checkbox" checked={architectureDraft.linkedRoles} onChange={e => setArchitectureDraft(prev => ({ ...prev, linkedRoles: e.target.checked, runner: e.target.checked ? { ...prev.chaser, hiddenLayers: [...prev.chaser.hiddenLayers] } : prev.runner }))} />Use same architecture for both roles</label>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-white">Architecture presets</div><div className="text-[10px] text-gray-500">Whole-suite presets provide repeatable starting topologies. Selecting one only edits the draft; Apply architecture & restart still controls when it takes effect.</div></div></div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                  {(Object.entries(NETWORK_ARCHITECTURE_SUITE_PRESETS) as [NetworkArchitectureSuitePreset, typeof NETWORK_ARCHITECTURE_SUITE_PRESETS[NetworkArchitectureSuitePreset]][]).map(([id, recipe]) => {
                    const selected = selectedSuitePreset === id;
                    return (
                      <button key={id} type="button" aria-pressed={selected} onClick={() => setArchitectureDraft(sanitizeNetworkArchitectureSuite(recipe.config))} className={`rounded-lg border px-3 py-2 text-left transition-colors ${selected ? 'border-violet-400 bg-violet-500/20 ring-1 ring-violet-400/35' : 'border-gray-800 bg-black/20 hover:border-gray-700'}`}>
                        <div className={`flex flex-wrap items-center gap-1.5 text-[11px] font-semibold ${selected ? 'text-violet-100' : 'text-gray-200'}`}><span>{recipe.label}</span>{selected && <span className="rounded-full bg-violet-400 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black">selected</span>}{id === 'memory_discovery' && <span className="rounded-full border border-emerald-500/35 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-emerald-300">default</span>}{id === 'ff_control' && <span className="rounded-full border border-fuchsia-500/35 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-fuchsia-300">control</span>}</div>
                        <div className={`mt-1 text-[9px] leading-relaxed ${selected ? 'text-violet-200/70' : 'text-gray-600'}`}>{recipe.summary}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-[10px] text-gray-500">Draft recipe: <span className={selectedSuitePreset ? 'font-semibold text-violet-300' : 'font-semibold text-gray-300'}>{selectedSuitePreset ? NETWORK_ARCHITECTURE_SUITE_PRESETS[selectedSuitePreset].label : 'Custom / modified'}</span></div>
              </div>
              <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
                <span className="text-gray-300">Suggested sequence:</span> FF control → Memory Discovery → Balanced Memory. Use the role editors for Memory Lite, Fixed Memory Control, Deep Memory, or asymmetric variants when you want a targeted follow-up.
              </div>
            </div>

            <ArchitectureRoleEditor role="chaser" config={architectureDraft.chaser} onChange={next => setArchitectureDraft(prev => ({ ...prev, chaser: next, runner: prev.linkedRoles ? { ...next, hiddenLayers: [...next.hiddenLayers] } : prev.runner }))} />
            <ArchitectureRoleEditor role="runner" config={architectureDraft.linkedRoles ? architectureDraft.chaser : architectureDraft.runner} disabled={architectureDraft.linkedRoles} onChange={next => setArchitectureDraft(prev => ({ ...prev, runner: next }))} />

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h4 className="font-semibold text-white">Apply architecture</h4><p className="text-xs text-gray-500">Architecture changes cannot be mixed into an existing population. Applying resets populations, species, Hall of Fame, Elo, benchmark bank and generation history.</p></div>
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
                  <h3 className={`font-semibold mb-4 ${r === 'chaser' ? 'text-red-300' : 'text-cyan-300'}`}>{r === 'chaser' ? 'Chaser' : 'Runner'} action distribution</h3>
                  <div className="space-y-3">
                    {DISPLAY_ACTIONS.map(action => {
                      const n = counts[action] || 0;
                      const pct = (n / total) * 100;
                      return <div key={action}><div className="flex justify-between text-xs mb-1"><span className="font-mono text-gray-300">{action.replace(/_/g, ' ')}</span><span className="text-gray-500">{pct.toFixed(1)}%</span></div><div className="h-2 rounded bg-gray-800 overflow-hidden"><div className={`h-full ${r === 'chaser' ? 'bg-red-400/70' : 'bg-cyan-400/70'}`} style={{ width: `${pct}%` }} /></div></div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'models' && (
          <div className="max-w-5xl mx-auto space-y-5">
            <div className="rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="flex items-center gap-2"><Database className="w-4 h-4 text-violet-300" /><h3 className="font-semibold text-white">Checkpoint library</h3></div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">Named full-run checkpoints are stored in IndexedDB rather than the old single localStorage slot, so large evolved populations can be kept without immediately hitting localStorage quota limits. Saves are captured only at a completed-generation boundary.</p>
                </div>
                <label className={`px-3 py-2 rounded border border-violet-500/40 text-violet-200 text-xs flex items-center gap-1 ${checkpointLibraryBusy ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-violet-950/30'}`}><Upload className="w-3.5 h-3.5" />Import run JSON & load<input type="file" accept="application/json,.json" aria-label="Import checkpoint JSON and load it" className="hidden" onChange={upload} disabled={checkpointLibraryBusy} /></label>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input aria-label="Checkpoint name" value={saveName} onChange={e => setSaveName(e.target.value)} disabled={checkpointLibraryBusy} placeholder={`Checkpoint gen ${generation}`} className="min-w-0 rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 disabled:opacity-50" />
                <button disabled={checkpointLibraryBusy} onClick={() => { onSaveCheckpoint(saveName.trim() || `Checkpoint gen ${generation}`); setSaveName(''); }} className="px-3 py-2 rounded bg-violet-400 text-black text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40"><Save className="w-3.5 h-3.5" />Save current run</button>
                <button disabled={checkpointLibraryBusy} onClick={onExportModels} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center justify-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" />Export full run</button>
              </div>
              {(checkpointLibraryMessage || status) && <div className="mt-3 rounded border border-violet-500/20 bg-black/20 px-3 py-2 text-xs text-violet-200">{checkpointLibraryMessage || status}</div>}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><div className="flex items-center gap-2"><HardDrive className="w-4 h-4 text-violet-300" /><h3 className="font-semibold text-white">Saved runs</h3></div><p className="mt-1 text-[10px] text-gray-600">Loading replaces the active populations, species, Hall of Fame, benchmark bank, retained champions, Elo and diagnostics with the selected checkpoint.</p></div>
                <span className="rounded-full border border-gray-800 bg-black/30 px-2 py-1 text-[10px] font-mono text-gray-400">{storedCheckpoints.length} saved</span>
              </div>

              {storedCheckpoints.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-800 px-4 py-7 text-center text-xs text-gray-600">No local checkpoints yet. Give the current run a name and save it above.</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {storedCheckpoints.map(item => (
                    <div key={item.id} className="rounded-lg border border-gray-800 bg-black/25 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{item.name}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                            <span className="font-mono text-violet-300">Gen {item.generation}</span>
                            <span>{new Date(item.savedAt).toLocaleString()}</span>
                            <span>{formatBytes(item.bytes)}</span>
                            <span className="capitalize">{item.architectureLabel}</span>
                            {(item.chaserChampionGeneration != null || item.runnerChampionGeneration != null) && <span>retained C{item.chaserChampionGeneration ?? '—'} / R{item.runnerChampionGeneration ?? '—'}</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button disabled={checkpointLibraryBusy} onClick={() => setPendingLoadId(item.id)} className="rounded border border-emerald-500/35 px-2.5 py-1.5 text-[10px] text-emerald-200 flex items-center gap-1 disabled:opacity-40"><FolderOpen className="w-3 h-3" />Load</button>
                          <button disabled={checkpointLibraryBusy} onClick={() => onExportStoredCheckpoint(item.id)} className="rounded border border-gray-700 px-2.5 py-1.5 text-[10px] text-gray-300 flex items-center gap-1 disabled:opacity-40"><Download className="w-3 h-3" />Export</button>
                          <button disabled={checkpointLibraryBusy} onClick={() => setPendingDeleteId(item.id)} className="rounded border border-red-500/25 px-2.5 py-1.5 text-[10px] text-red-300 flex items-center gap-1 disabled:opacity-40"><Trash2 className="w-3 h-3" />Delete</button>
                        </div>
                      </div>
                      {pendingLoadId === item.id && <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-emerald-500/20 bg-emerald-950/10 px-3 py-2 text-[10px] text-emerald-200"><span className="mr-auto">Replace the active run with this generation {item.generation} checkpoint?</span><button disabled={checkpointLibraryBusy} onClick={async () => { await onLoadStoredCheckpoint(item.id); setPendingLoadId(null); }} className="rounded bg-emerald-400 px-2.5 py-1 font-bold text-black">Load checkpoint</button><button onClick={() => setPendingLoadId(null)} className="rounded border border-gray-700 px-2.5 py-1 text-gray-300">Cancel</button></div>}
                      {pendingDeleteId === item.id && <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-red-500/20 bg-red-950/10 px-3 py-2 text-[10px] text-red-200"><span className="mr-auto">Delete this saved checkpoint from this browser?</span><button disabled={checkpointLibraryBusy} onClick={async () => { await onDeleteStoredCheckpoint(item.id); setPendingDeleteId(null); }} className="rounded bg-red-400 px-2.5 py-1 font-bold text-black">Delete</button><button onClick={() => setPendingDeleteId(null)} className="rounded border border-gray-700 px-2.5 py-1 text-gray-300">Cancel</button></div>}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-[10px] leading-relaxed text-gray-600">Full checkpoints preserve populations, innovation/species history, Hall of Fame, frozen benchmark references, retained generalist champions, Elo, architecture, fitness settings and diagnostics. Legacy champion-only JSON is still importable, but cannot restore a full evolutionary run.</p>
            </div>

            <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/10 p-4">
              <div className="flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Training analysis recording</h3></div>
              <p className="text-xs leading-relaxed text-gray-500">Export the compact analysis report separately from restorable checkpoints. It contains generation history and deterministic champion probes for evaluating learned behavior.</p>
              <button onClick={onExportAnalysis} className="mt-3 px-3 py-2 rounded border border-cyan-500/40 text-cyan-200 text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" />Export analysis JSON</button>
            </div>

            <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-4">
              {!confirmReset ? <button onClick={() => setConfirmReset(true)} className="px-3 py-2 rounded border border-red-500/40 text-red-300 text-xs flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />Reset both populations</button> : <div className="flex items-center gap-2"><span className="text-xs text-red-300">Delete all evolved genomes, Hall of Fame entries, and restart at generation 1?</span><button onClick={() => { onResetWeights(); setConfirmReset(false); }} className="px-3 py-1.5 bg-red-500 text-black rounded text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">Reset</button><button onClick={() => setConfirmReset(false)} className="px-3 py-1.5 border border-gray-700 rounded text-xs">Cancel</button></div>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
