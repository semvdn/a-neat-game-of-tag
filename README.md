# NEAT Tag Agents

An evolving game of tag intended to become a generative artwork: three autonomous bodies pursue, evade, and exchange roles across an infinite procedural landscape. Separate Chaser and Runner NEAT populations train in background workers; retained champions inhabit the continuous visible world.

The aim is engaging interaction and readable movement over long viewing periods. High fitness or frequent tags alone do not establish an interesting painting.

## Run

Requires Node.js 22 or newer and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The repository ships with a curated **generation 7422 full checkpoint**, which is loaded automatically as the default showcase and as the evolutionary resume point. The checkpoint preserves the exact display pair selected when it was exported—**Chaser g7410 + Runner g4381**—instead of substituting the older retained generalist champions stored elsewhere in the evolutionary state. Select **Start Simulation** to begin visible playback and background evolution. Use **Diagnostics → Runs & data** to import/export other full evolutionary checkpoints and analysis reports; training and visible playback can be paused independently.

For exhibition, choose **Exhibit** or press **G**. Entering exhibition writes `?exhibit=1` into the URL, so a reload returns to the same kiosk view. A page opened with `?exhibit=1` auto-loads the bundled showcase and starts visible playback with background evolution paused, preserving the curated pair. Use `?exhibit=1&train=1` only when you intentionally want evolution to continue during an installation. **F** toggles browser fullscreen where supported; **G** or **Escape** returns to the studio. See [artwork and installation guidance](docs/ARTWORK.md).

## Evaluate changes

```sh
npm run evaluate -- --seeds 32 --verify
npm run evaluate -- --checkpoint checkpoint.json --conditions evaluation/conditions.example.json --seeds 32 --trace
```

The lab uses the actual simulation and produces paired per-seed results, per-start breakdowns, and optional traces in `evaluations/report.json`. Without a checkpoint it uses explicitly untrained scripted controls. `--verify` checks encounter regressions, forbids unseeded episode randomness, and repeats episodes to check determinism.

Read [the evaluation guide](docs/EVALUATION.md) before interpreting results. The [initial experiment](docs/experiments/2026-09-08.md) tested 2,304 distinct condition/scenario episodes and found no reason to replace normal terrain defaults. It also confirmed and corrected misleading evade accounting around falls.

## Design contracts

- Visible and headless play share movement, tagging, falling, fair respawn, terrain, and route accessibility.
- Policies sense **23 world-relative inputs** and emit **3 outputs**: signed horizontal drive, jump, and sprint. Camera position and display dimensions are presentation concerns.
- Compared candidates receive common seeded terrain, starts, and opponent panels. Breeding, held-out validation, champion retention, and display curation remain separate decisions.
- Tags and personal failures are the competitive outcomes. Pace, pursuit, and pressure shaping are capped; failed movement and respawn teleports must not become progress rewards.
- Moving platforms must remain safe across their complete swept motion; all generated surfaces remain solid regardless of sensing or route history.
- Runners obstruct and can stand on each other; a loaded Runner cannot jump. Chasers remain non-solid. World-space separation penalties encourage a compact group without rewarding contact or camping.
- The camera excludes clearly falling bodies and holds its framing when all relevant participants are falling.

Current checkpoints use `world-relative-senses-v3` and `signed-horizontal-controls-v2`. Older 25-input or four-output policies are incompatible. Current revision `solid-group-v12` adds solid Runner contacts, universal surfaces, moving-surface sweeps and bounded group-cohesion fitness without changing the controller schema; current-schema older checkpoints use the existing score-migration path.

## Documentation

- [Solid Runner contacts, universal landings and group-cohesion training](docs/SOLID_GROUP.md)
- [Artwork direction and exhibition operation](docs/ARTWORK.md)
- [Gameplay laboratory and experiment protocol](docs/EVALUATION.md)
- [Reproducible production-worker training experiments](docs/TRAINING_EXPERIMENTS.md)
- [Architecture and contributor workflow](docs/ARCHITECTURE.md)
- [Detailed simulation, training, and checkpoint reference](docs/SIMULATION.md)
- [Agent instructions](AGENTS.md) and [task-specific skills](skills/README.md)

## Validate

```sh
npx tsc -p tsconfig.check.json --noEmit
npm run build
npm run evaluate -- --seeds 8 --verify
git diff --check
```

Build output and generated lab reports are ignored. `npm run build` regenerates the Tailwind utility sheet locally and produces a production bundle with no required remote runtime assets. The bundled showcase checkpoint is copied into the build as a local static asset. Serve `dist/` from a local HTTP server for an offline installation rather than opening `index.html` directly from `file://`.
