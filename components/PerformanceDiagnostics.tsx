import React, { useMemo, useState } from 'react';
import type { DiagnosticsState } from '../types';
import type { NeatGenerationMetrics, NeatGenomeData } from '../learning/neat';
import { ACTION_SPACE } from '../constants';
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
} from 'lucide-react';

interface PerformanceDiagnosticsProps {
  diagnostics: DiagnosticsState;
  simulationSpeed: number;
  onSetSimulationSpeed: (speed: number) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  onStepFrame: () => void;
  onResetWeights: () => void;
  avgSurvivalTime: number;
  avgTimeToTag: number;
  isOpen: boolean;
  onClose: () => void;
  onExportModels?: () => void;
  onImportModels?: (json: string) => boolean;
  onSaveLocalStorage?: () => void;
  onLoadLocalStorage?: () => void;
  hasSavedModel?: boolean;
}

const fmt = (v: number | undefined, digits = 2) => (Number.isFinite(v) ? Number(v).toFixed(digits) : '—');

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
    const hidden = genome.nodes.filter(n => n.type === 'hidden').sort((a, b) => a.id - b.id);
    const outputs = genome.nodes.filter(n => n.type === 'output').sort((a, b) => a.id - b.id);
    const pos = new Map<number, { x: number; y: number }>();
    const place = (nodes: typeof genome.nodes, x: number) => nodes.forEach((n, i) => {
      pos.set(n.id, { x, y: 18 + ((i + 0.5) / Math.max(1, nodes.length)) * 304 });
    });
    place(inputs, 26);
    place(hidden, 180);
    place(outputs, 334);
    return { pos, inputs, hidden, outputs };
  }, [genome]);

  if (!genome || !layout) {
    return <div className="h-80 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl">Champion topology appears after the first completed generation.</div>;
  }

  const enabled = genome.connections.filter(c => c.enabled);
  return (
    <div className="rounded-xl border border-gray-800 bg-black/40 p-3">
      <svg viewBox="0 0 360 340" className="w-full h-[340px]">
        {enabled.map(c => {
          const a = layout.pos.get(c.inNode);
          const b = layout.pos.get(c.outNode);
          if (!a || !b) return null;
          const weight = Math.min(4, Math.max(0.4, Math.abs(c.weight)));
          return (
            <line
              key={c.innovation}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              className={c.weight >= 0 ? 'text-emerald-400/20' : 'text-rose-400/20'}
              strokeWidth={weight}
            />
          );
        })}
        {genome.nodes.map(n => {
          const p = layout.pos.get(n.id)!;
          const cls = n.type === 'input' ? 'text-gray-400' : n.type === 'output' ? 'text-amber-300' : 'text-violet-300';
          return <circle key={n.id} cx={p.x} cy={p.y} r={n.type === 'hidden' ? 5 : 3.5} fill="currentColor" className={cls} />;
        })}
        <text x="8" y="12" className="fill-gray-500 text-[8px]">39 INPUTS</text>
        <text x="155" y="12" className="fill-gray-500 text-[8px]">HIDDEN</text>
        <text x="314" y="12" className="fill-gray-500 text-[8px]">4 OUTPUTS</text>
      </svg>
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-400 text-center">
        <div><span className="text-white font-mono">{genome.nodes.length}</span> nodes</div>
        <div><span className="text-white font-mono">{enabled.length}</span> enabled links</div>
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
      <div><div className="text-gray-500">Compatibility δ</div><div className="font-mono text-lg text-white">{fmt(metrics?.compatibilityThreshold)}</div></div>
      <div><div className="text-gray-500">Champion nodes</div><div className="font-mono text-lg text-white">{metrics?.championNodes ?? '—'}</div></div>
      <div><div className="text-gray-500">Champion links</div><div className="font-mono text-lg text-white">{metrics?.championConnections ?? '—'}</div></div>
    </div>
  </div>
);

export const PerformanceDiagnostics: React.FC<PerformanceDiagnosticsProps> = ({
  diagnostics,
  simulationSpeed,
  onSetSimulationSpeed,
  isPaused,
  onTogglePause,
  onStepFrame,
  onResetWeights,
  avgSurvivalTime,
  avgTimeToTag,
  isOpen,
  onClose,
  onExportModels,
  onImportModels,
  onSaveLocalStorage,
  onLoadLocalStorage,
  hasSavedModel,
}) => {
  const [tab, setTab] = useState<'overview' | 'fitness' | 'network' | 'actions' | 'models'>('overview');
  const [role, setRole] = useState<'chaser' | 'evader'>('chaser');
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  if (!isOpen) return null;

  const chaserHistory = diagnostics.chaserNeatHistory || [];
  const evaderHistory = diagnostics.evaderNeatHistory || [];
  const balanceHistory = diagnostics.balanceHistory || [];
  const balance = diagnostics.lastGenerationBalance;
  const curriculum = diagnostics.curriculum;
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
      setStatus(ok ? 'Imported NEAT champions.' : 'Import failed. This build expects NEAT genome JSON.');
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
        <div className="ml-auto flex items-center gap-2">
          {[1, 2, 5, 10, 25, 50].map(speed => (
            <button key={speed} onClick={() => onSetSimulationSpeed(speed)} className={`px-2 py-1 rounded text-xs font-mono border ${simulationSpeed === speed ? 'bg-violet-500/25 border-violet-400 text-violet-100' : 'border-gray-800 text-gray-500 hover:text-white'}`}>{speed}x</button>
          ))}
          <button onClick={onTogglePause} className="p-2 rounded border border-gray-800 hover:bg-gray-900">{isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
          <button onClick={onStepFrame} className="p-2 rounded border border-gray-800 hover:bg-gray-900" title="Step visual frame"><FastForward className="w-4 h-4" /></button>
          <button onClick={onClose} className="p-2 rounded border border-gray-800 hover:bg-gray-900"><X className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="px-5 pt-3 flex gap-2 border-b border-gray-900 bg-gray-950">
        {[
          ['overview', Activity, 'Overview'],
          ['fitness', Trophy, 'Fitness'],
          ['network', Network, 'Topology'],
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
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              <MetricCard label="Generation" value={generation} hint="one full population evaluation" />
              <MetricCard label="Chaser best" value={fmt(chaserMetrics?.bestFitness)} hint="same 0–220 scale as runner" />
              <MetricCard label="Runner best" value={fmt(evaderMetrics?.bestFitness)} hint="same 0–220 scale as chaser" />
              <MetricCard label="Species C / R" value={`${chaserMetrics?.speciesCount ?? '—'} / ${evaderMetrics?.speciesCount ?? '—'}`} />
              <MetricCard label="Chaser win" value={balance ? `${(balance.chaserWinRate * 100).toFixed(1)}%` : '—'} hint="tag or runner fall" />
              <MetricCard label="Runner win" value={balance ? `${(balance.evaderWinRate * 100).toFixed(1)}%` : '—'} hint="timeout or chaser fall" />
              <MetricCard label="Fall-ended" value={balance ? `${(balance.fallRate * 100).toFixed(1)}%` : '—'} hint={balance ? `${balance.chaserFalls} chaser / ${balance.evaderFalls} runner` : 'terrain failures'} />
              <MetricCard label="Avg tag time" value={balance?.avgTagTimeMs != null ? `${(balance.avgTagTimeMs / 1000).toFixed(2)}s` : '—'} hint={balance ? `${balance.matches} matches` : 'when a tag occurs'} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <FitnessSummary title="Chaser population" metrics={chaserMetrics} />
              <FitnessSummary title="Evader population" metrics={evaderMetrics} />
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <MetricCard label="Hall of Fame C / E" value={`${diagnostics.hallOfFame?.chaserSize ?? 0} / ${diagnostics.hallOfFame?.evaderSize ?? 0}`} hint={`max ${diagnostics.hallOfFame?.maxSize ?? 0} champions per role`} />
              <MetricCard label="Historical opponents" value={diagnostics.hallOfFame?.opponentsPerGenome ?? 0} hint="extra archive matchups per genome" />
              <MetricCard label="Archived generations" value={(diagnostics.hallOfFame?.chaserGenerations?.length || diagnostics.hallOfFame?.evaderGenerations?.length) ? `${diagnostics.hallOfFame?.chaserGenerations?.[0] ?? '—'}–${diagnostics.hallOfFame?.chaserGenerations?.slice(-1)[0] ?? '—'}` : '—'} hint="recent + reservoir-sampled history" />
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <h3 className="font-semibold text-emerald-200">Adaptive terrain curriculum</h3>
                  <p className="text-xs text-gray-500 mt-1">Difficulty rises only when the population is navigating reliably; it can step back if terrain failure becomes dominant.</p>
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-300">{curriculum ? `${(curriculum.difficulty * 100).toFixed(0)}%` : '—'}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <MetricCard label="Navigation" value={curriculum ? `${(curriculum.lastNavigationScore * 100).toFixed(0)}%` : '—'} hint="last generation" />
                <MetricCard label="Fall endings" value={curriculum ? `${(curriculum.lastFallTerminationRate * 100).toFixed(1)}%` : '—'} hint="matches ended by terrain failure" />
                <MetricCard label="Branches" value={curriculum?.branchesUnlocked ? 'ON' : 'locked'} hint={curriculum?.lastCourseBranchCount != null ? `${curriculum.lastCourseBranchCount} in sampled course` : undefined} />
                <MetricCard label="Moving" value={curriculum?.movingUnlocked ? 'ON' : 'locked'} hint={curriculum?.lastCourseMovingPlatforms != null ? `${curriculum.lastCourseMovingPlatforms} platforms` : undefined} />
                <MetricCard label="Crumbling" value={curriculum?.crumblingUnlocked ? 'ON' : 'locked'} hint={curriculum?.lastCourseCrumblingPlatforms != null ? `${curriculum.lastCourseCrumblingPlatforms} platforms` : undefined} />
                <MetricCard label="Course seed" value={curriculum?.lastCourseSeed ?? '—'} hint="deterministic replay seed" />
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-300" /><h3 className="font-semibold text-white">Best fitness by generation</h3></div>
              <LineChart series={[{ label: 'Chaser', values: chaserHistory.map(m => m.bestFitness) }, { label: 'Evader', values: evaderHistory.map(m => m.bestFitness) }]} />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-300" /><h3 className="font-semibold text-white">Game balance by generation</h3></div>
              <LineChart
                series={[
                  { label: 'Tag %', values: balanceHistory.map(m => m.tagRate * 100) },
                  { label: 'Runner timeout %', values: balanceHistory.map(m => m.survivalRate * 100) },
                  { label: 'Chaser fall %', values: balanceHistory.map(m => (m.chaserFalls / Math.max(1, m.matches)) * 100) },
                  { label: 'Runner fall %', values: balanceHistory.map(m => (m.evaderFalls / Math.max(1, m.matches)) * 100) },
                ]}
                emptyLabel="Complete generations to populate the balance chart."
              />
              <p className="mt-2 text-xs text-gray-500">Current-population matches only. A fall is a terminal loss in evolutionary evaluation; Hall-of-Fame tests remain excluded from this balance signal.</p>
            </div>

            <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-4 text-sm text-gray-400 leading-relaxed">
              <strong className="text-violet-200">Training architecture:</strong> both roles have identical physical abilities and evolve against rotating current opponents plus Hall-of-Fame champions. Episodes use seeded course graphs with a guaranteed reachable backbone; as navigation competence rises the curriculum unlocks branch/rejoin routes, moving platforms and contact-triggered crumbling platforms. Training falls are terminal losses, so neither role can exploit the void as a teleport, stamina refill or escape from an imminent tag.
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
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Species count</h3><LineChart series={[{ label: 'Chaser species', values: chaserHistory.map(m => m.speciesCount) }, { label: 'Evader species', values: evaderHistory.map(m => m.speciesCount) }]} /></div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"><h3 className="font-semibold text-white mb-3">Minimum fitness</h3><LineChart series={[{ label: 'Chaser min', values: chaserHistory.map(m => m.minFitness) }, { label: 'Evader min', values: evaderHistory.map(m => m.minFitness) }]} /></div>
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
                Green links are positive weights; red links are negative. NEAT begins with direct input→output links, then structural mutations split links to create hidden nodes and add new acyclic connections.
              </div>
            </div>
            <NetworkGraph genome={selectedGenome} />
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
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 mb-4"><HardDrive className="w-4 h-4 text-violet-300" /><h3 className="font-semibold text-white">Champion persistence</h3></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { onSaveLocalStorage?.(); setStatus('Saved NEAT champions locally.'); }} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1"><Save className="w-3.5 h-3.5" />Save</button>
                <button disabled={!hasSavedModel} onClick={() => { onLoadLocalStorage?.(); setStatus('Loaded local champions.'); }} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1 disabled:opacity-40"><HardDrive className="w-3.5 h-3.5" />Load</button>
                <button onClick={onExportModels} className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" />Export JSON</button>
                <label className="px-3 py-2 rounded border border-gray-700 text-xs flex items-center gap-1 cursor-pointer"><Upload className="w-3.5 h-3.5" />Import JSON<input type="file" accept="application/json" className="hidden" onChange={upload} /></label>
              </div>
              {status && <div className="mt-3 text-xs text-violet-200">{status}</div>}
              <p className="mt-4 text-xs text-gray-500 leading-relaxed">The worker maintains the Hall of Fame during the current training session. Loading a champion seeds a fresh archive baseline around that imported champion.</p>
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
