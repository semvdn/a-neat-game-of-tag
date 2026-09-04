# NEAT Tag Agents — Original Controls + Current UI/Training Harness

This merged build deliberately keeps the **simple movement and senses from the first NEAT version** while applying the **current UI/camera, diagnostics, and maximum-throughput background-training setup**.

## Preserved from the initial version

The agent policy interface is unchanged:

- **Actions:** `move_left`, `move_right`, `jump`, `wait`
- **Movement:** original acceleration, friction, max-speed, fixed jump impulse, passive energy regeneration and jump energy cost
- **Inputs:** original **39-value state vector**
- **LiDAR:** original **8 radial obstacle rays**
- **Other senses:** self kinematics/status, camera boundaries, fall distance, platform ledges, 3 nearby platforms, target/threat dynamics, teammate dynamics and bias
- **Episode physics/fitness:** the original discrete controller and original dense fitness terms are retained in headless evaluation

The later continuous left/right drive, variable jump power, sprint channel, fatigue physiology and 31-input compact sense model are **not** used in this build.

## Applied from the current version

### Independent champion arena

The visible game is presentation only. It runs continuously with the latest completed chaser and evader champions and has its own:

- view speed controls (`0.5x`, `1x`, `2x`, `5x`, `10x`);
- pause/step controls;
- reset-view control;
- visual camera zoom from 50% to 200%;
- responsive full-bleed camera that does not change physics or neural inputs.

### Maximum-throughput training

There is no user-set training multiplier. Once simulation starts, background evolution runs as fast as the browser/device can process it.

The training worker:

- uses a nested CPU evaluator pool when supported;
- reserves one logical CPU for the browser/UI and caps the pool at 12 workers;
- falls back to an optimized single-worker burst loop if nested workers are unavailable;
- reports measured simulated-time speed (`×`), episodes/second, backend and worker count;
- keeps rendering independent from training throughput.

The NEAT phenotype evaluator also uses the newer dense-array activation path from the current build to reduce allocation/GC overhead without changing the old action/state interface.

### Current diagnostics

The current diagnostics suite is included, adapted to the original action/sense model. It shows:

- training throughput and backend;
- fitness histories for both roles;
- species/topology metrics;
- action distributions for the original four actions;
- champion network graph (39 inputs, 4 outputs);
- role Elo signal;
- current-population game-balance history;
- Hall-of-Fame archive diagnostics;
- champion save/load/import/export.

## Evolution setup

Two independent populations are evolved:

- Chaser population: 48 genomes
- Evader population: 48 genomes
- Rotating current-population opponents: 3 per genome
- Historical Hall-of-Fame opponents: 1 per genome when available
- Episode limit: 12 seconds simulated time

The Hall of Fame retains recent champions plus reservoir-sampled older champions. This is part of the current diagnostics/training harness; it does not alter the preserved movement or sensing interface.

## Important files

- `learning/state.ts` — original 39-D state vector and LiDAR inputs
- `learning/raycast.ts` — original 8-ray sensing
- `learning/agent.ts` — original 4-action NEAT controller wrapper
- `learning/trainingEpisode.ts` — headless implementation of the original movement/episode behavior
- `learning/neat.ts` — NEAT core with newer allocation-efficient phenotype evaluation
- `workers/trainingWorker.ts` — max-throughput population/Hall-of-Fame trainer and telemetry
- `workers/episodeWorker.ts` — parallel episode evaluator
- `components/GameCanvas.tsx` — current responsive presentation camera with original LiDAR overlay
- `components/InfoPanel.tsx` — current compact status panel adapted to 39 inputs
- `components/PerformanceDiagnostics.tsx` — current diagnostics suite
- `App.tsx` — independent champion-view and background-training orchestration

## Run locally

```bash
npm install
npm run dev
```

Type-check:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

## Senses view
The champion arena includes the newer full Agent Senses overlay (toggle in the sidebar or press `S`), adapted to the original 39-input controller. It visualizes target/threat, teammate, nearby platform slots, ledges, policy-camera boundaries, fall distance, self-state, and all eight original LiDAR rays. The overlay reads the already-computed policy state and does not alter the sensing or movement implementation.
