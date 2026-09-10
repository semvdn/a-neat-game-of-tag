# NEAT Tag Agents

An evolving game of tag intended to become a generative artwork: three autonomous bodies pursue, evade, and exchange roles across an infinite procedural landscape. Separate Chaser and Runner NEAT populations train in background workers; retained champions inhabit the continuous visible world.

[**▶ Open the live GitHub Pages demo**](https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/)

[![Tag Agents gameplay](docs/media/gameplay.gif)](https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/)

The public demo is deliberately lightweight: it ships the curated **Chaser g7410 + Runner g4381** pair and the visual simulation, but not the training worker, population checkpoint, experiment controls, or checkpoint-management UI. The full research application remains available in this repository.

The aim remains engaging interaction and readable movement over long viewing periods. High fitness or frequent tags alone do not establish an interesting painting.

> Publishing this repository for the first time? Run `npm run configure:github -- OWNER/REPOSITORY` once after creating the GitHub repo to replace the two placeholder links above with the real repository and Pages URLs.

## Clone and run the full app locally

Requires **Node.js 22 or newer**, npm, and a modern desktop browser.

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm install
npm run dev
```

Open the local URL printed by Vite. The full studio ships with the curated **generation 7422 full evolution checkpoint**, loaded automatically as the default showcase and evolutionary resume point. It preserves the exact display pair selected when exported—**Chaser g7410 + Runner g4381**—rather than substituting the older retained generalists stored elsewhere in the checkpoint.

Select **Start Simulation** to begin visible playback and background evolution. Visible playback and training can be paused independently. Use **Diagnostics → Runs & data** to import/export other full evolutionary checkpoints and analysis reports.

For a local installation/kiosk, choose **Exhibit** or open `?exhibit=1`. That mode auto-loads the bundled showcase and starts visible playback with background evolution paused. Add `&train=1` only when you intentionally want evolution to continue during an installation. **F** toggles browser fullscreen where supported; **G** or **Escape** returns to the studio. See [artwork and installation guidance](docs/ARTWORK.md).

## Run the lightweight web demo locally

```sh
npm install
npm run demo:dev
```

The demo starts on port 3001 and auto-runs the curated pair. Its controls are intentionally limited to presentation settings: playback speed, zoom, trails, senses, day/night mode, reset, pause and fullscreen.

Build the exact static site used by GitHub Pages with:

```sh
npm run build:demo
npm run preview:demo
```

Deployment is already wired in [.github/workflows/pages.yml](.github/workflows/pages.yml). After selecting **GitHub Actions** as the Pages source in repository settings, every push to `main` rebuilds and deploys `dist-demo/`. See the [GitHub Pages setup guide](docs/GITHUB_PAGES.md).

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

- [GitHub Pages showcase and deployment](docs/GITHUB_PAGES.md)
- [Solid Runner contacts, universal landings and group-cohesion training](docs/SOLID_GROUP.md)
- [Artwork direction and exhibition operation](docs/ARTWORK.md)
- [Gameplay laboratory and experiment protocol](docs/EVALUATION.md)
- [Reproducible production-worker training experiments](docs/TRAINING_EXPERIMENTS.md)
- [Architecture and contributor workflow](docs/ARCHITECTURE.md)
- [Detailed simulation, training, and checkpoint reference](docs/SIMULATION.md)
- [Agent instructions](AGENTS.md) and [task-specific skills](skills/README.md)

## Validate

```sh
npm run lint
npm run build
npm run build:demo
npm run evaluate -- --seeds 8 --verify
git diff --check
```

Build output and generated lab reports are ignored. Both production targets regenerate the Tailwind utility sheet locally and require no remote runtime assets. The full build carries the restorable evolution checkpoint; the Pages build carries only the compact showcase pair. Serve either build from HTTP rather than opening its `index.html` directly from `file://`.
