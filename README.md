# NEAT Tag Agents

An evolving game of tag intended to become a generative artwork: three autonomous bodies pursue, evade, and exchange roles across an infinite procedural landscape. Separate Chaser and Runner NEAT populations train in background workers; retained champions inhabit the continuous visible world.

The aim is engaging interaction and readable movement over long viewing periods. High fitness or frequent tags alone do not establish an interesting painting.

## Run

Requires Node.js 22 or newer and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and select **Start Simulation**. Fresh policies need training. Use **Diagnostics → Runs & data** to import/export full evolutionary checkpoints and analysis reports. Training and visible playback can be paused independently.

For exhibition, choose **Exhibit** or press **G**. The arena fills the page, sounds and diagnostic overlays are suppressed, and controls fade. **F** toggles browser fullscreen where supported; **G** or **Escape** returns to the studio. See [artwork and installation guidance](docs/ARTWORK.md) for operation and current kiosk/offline limitations.

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
- Moving platforms must remain safe across their complete swept motion; sibling routes are mutually exclusive after commitment until their merge.
- The camera excludes clearly falling bodies and holds its framing when all relevant participants are falling.

Current checkpoints use `world-relative-senses-v3` and `signed-horizontal-controls-v2`. Older 25-input or four-output policies are incompatible. Current revision `swept-landings-v11` corrects landing collisions after the v10 evade-accounting fix without changing the controller schema; current-schema older checkpoints use the existing score-migration path.

## Documentation

- [Artwork direction and exhibition operation](docs/ARTWORK.md)
- [Gameplay laboratory and experiment protocol](docs/EVALUATION.md)
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

Build output and generated lab reports are ignored. A production build currently still uses external Tailwind CSS; see the installation guide before planning a network-independent display.
