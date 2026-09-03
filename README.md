# NEAT Tag Agents

This branch ports the original PPO tag agents to a population-based **NEAT (NeuroEvolution of Augmenting Topologies)** trainer while keeping the existing physics, rendering, lidar/state-vector code, sound and controls.

## What changed

The old actor/critic + Adam + trajectory/GAE training path has been removed. Training is now owned by a single Web Worker and evolves two independent populations:

- **Chaser population:** 48 genomes
- **Evader population:** 48 genomes
- **Inputs:** the existing 39-value state vector
- **Outputs:** 4 continuous control channels (`left_drive`, `right_drive`, `jump_power`, `sprint`)
- **Network type:** feed-forward NEAT graph (acyclic for this first implementation)
- **Structural evolution:** add-node and add-connection mutation
- **Genetic evolution:** innovation-number-aligned crossover, weight/bias mutation, elitism and speciation

The main React thread no longer learns. It only renders the current champion genomes. This avoids having a second trainer that can drift away from the worker population.

## Training cycle

The persistent training worker performs headless evolutionary evaluation continuously at the maximum throughput the browser/device can sustain. There is no user-set training-speed cap.

For each generation:

1. Every chaser genome is evaluated against rotating evader genomes.
2. Every genome receives the same number of evaluations (currently 3).
3. Episodes end on a tag or after 12 seconds of simulated time.
4. Fitness is averaged across the genome's matchups.
5. Each population is speciated independently.
6. Elites survive, parents are selected, crossover aligns genes by innovation number, then mutations create the next generation.
7. The worker sends the best chaser and evader genomes plus generation diagnostics to the UI.

The visible champion arena has its own independent `0.5x`–`10x` playback control. Changing visual playback speed does **not** recreate the worker or discard the evolving populations.

## Fitness

Terminal performance is deliberately dominant, with modest dense shaping so locomotion can bootstrap before reliable tags emerge.

**Chaser fitness** rewards:
- making a tag;
- tagging earlier;
- closing distance;
- progress in the episode's randomized escape direction;
- a small jump/locomotion signal.

It penalizes falls and excessive average separation.

**Evader fitness** rewards:
- survival time;
- surviving the full episode;
- maintaining separation;
- progress in the episode's randomized escape direction;
- a small jump/locomotion signal.

It penalizes falls.

The exact coefficients are in `workers/trainingWorker.ts` and are intentionally easy to tune.

## Continuous control + stamina

The NEAT outputs are no longer collapsed to a single discrete action. Each frame the phenotype emits:

- **left drive** and **right drive**, combined into a signed horizontal effort in `[-1, 1]`;
- **jump power** in `[0, 1]`, allowing small hops through maximum jumps;
- **sprint intensity** in `[0, 1]`, blending efficient cruise speed into peak speed.

Stamina is a physical constraint rather than a direct fitness reward:

- ordinary running has a modest nonlinear cost;
- full sprint is much more expensive (about 18 energy/second at full effort);
- jump cost scales quadratically from roughly 3 to 15 energy;
- recovery happens only while grounded and is strongest while resting;
- below 30% reserve, acceleration, top speed and jump power degrade smoothly;
- an exhausted agent can still move and can make a weaker affordable jump.

The roles have intentionally different physiology:

- **Evader:** ~5% better burst speed/acceleration/jump, 90% base stamina capacity and 90% recovery.
- **Chaser:** base burst ability, 110% stamina capacity and 115% recovery.

This makes the evader better at creating an initial gap while giving the chaser a plausible endurance strategy: force expensive sprints/jumps, conserve energy, then attack a fatigued runner.

The 39-input genome shape is preserved for checkpoint compatibility. The former constant bias input was redundant with NEAT node biases, so that slot now carries **target/threat energy reserve**. Own energy was already part of the state vector.

## Mirrored and randomized evaluation

Each generation now evaluates both leftward and rightward escape orientations. With the default three matchups per genome, seed parity guarantees that both orientations occur rather than relying on chance. Start spacing and translation are also randomized within a safe range.

The headless course is geometrically mirrored for leftward episodes, camera tracking is allowed into negative world coordinates, and progress shaping is measured relative to the episode's flow direction. This removes the old shortcut where `move right` could become a globally correct policy. Visual champion playback also randomizes its initial orientation and spacing on reset.

## NEAT implementation

`learning/neat.ts` contains the evolutionary core:

- node and connection genes;
- global innovation tracking;
- innovation-consistent node splits;
- genome cloning and phenotype compilation;
- feed-forward topological execution;
- compatibility distance;
- species assignment with an adaptive compatibility threshold;
- fitter-parent crossover;
- cycle-safe inheritance/mutation;
- weight, bias, add-node, add-connection and toggle mutations;
- tournament selection and elitism;
- generation metrics.

No third-party NEAT library is required.

## Diagnostics

The PPO diagnostics have been replaced by NEAT metrics:

- best / mean / minimum fitness per generation;
- species count;
- compatibility threshold;
- average node count;
- average enabled connection count;
- champion node/connection count;
- generation counter;
- chaser and evader action distributions;
- champion network graph visualizer.

Role-level Elo is retained only as a human-readable evaluation signal. It is **not** used for evolutionary selection.


## Decoupled champion view and maximum-throughput training

The visible canvas and the evolutionary worker now run on independent clocks.

- **View:** `0.5x`, `1x`, `2x`, `5x`, `10x`, with its own pause, single-frame step, and **Reset view** control.
- **Train:** always runs at maximum available worker throughput, with its own pause. The UI reports the measured simulated-time multiplier (`× realtime`) and completed episodes per second instead of exposing a requested speed setting.
- The worker no longer sends sampled training game states to replace the canvas. The visible game is always one continuous champion arena.
- After each completed generation, newly reported chaser and evader champions are hot-swapped into the running arena without resetting positions, velocity, stamina, roles, cooldowns, platforms, or game time.
- **Reset view** resets only the visible arena and its local match history; populations, Hall of Fame, generation, and worker state continue untouched.
- Worker counters/Elo remain worker-owned, so playing or resetting the champion view cannot distort training diagnostics.

## Persistence

Export/save now stores the current **chaser and evader champion genomes** and their generation metadata.

When champions are imported, the worker reconstructs a fresh population around each champion and mutates the non-elite copies. Full population/species state is not yet serialized, so an export is a champion checkpoint rather than an exact pause/resume snapshot.

Old PPO actor/critic JSON is intentionally rejected because its tensors cannot be mapped meaningfully onto NEAT genome topology.

## Main tuning constants

See `constants.ts`:

```ts
NEAT_POPULATION_SIZE = 48
NEAT_OPPONENTS_PER_GENOME = 3
NEAT_EPISODE_MAX_MS = 12000
NEAT_COMPATIBILITY_THRESHOLD = 0.8
NEAT_TARGET_SPECIES = 8
NEAT_CROSSOVER_RATE = 0.75
NEAT_WEIGHT_MUTATION_RATE = 0.8
NEAT_ADD_NODE_RATE = 0.03
NEAT_ADD_CONNECTION_RATE = 0.08
```

Additional compatibility and mutation parameters live in `DEFAULT_NEAT_CONFIG` in `learning/neat.ts`.

## Run locally

Prerequisite: Node.js.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

The original AI Studio/Vite Gemini environment plumbing is left in place, although the tag-agent trainer itself does not depend on Gemini.

## File map

- `learning/neat.ts` — genome, phenotype, mutation, crossover, speciation and population evolution
- `learning/agent.ts` — lightweight runtime wrapper around one NEAT genome
- `workers/trainingWorker.ts` — population ownership, headless matches, fitness and generation loop
- `components/PerformanceDiagnostics.tsx` — NEAT diagnostics and topology visualizer
- `App.tsx` — champion rendering, worker lifecycle, persistence and UI integration
- `constants.ts` — NEAT and game parameters

The former PPO math/optimizer module (`learning/math.ts`) has been removed.


## Hall of Fame coevolution

Each evaluated genome plays the normal balanced current-population matchups and, once historical champions exist, an extra matchup against the opposite role's Hall of Fame. Each role keeps up to 12 champions: the four most recent champions plus a reservoir sample of older generations. This keeps old successful strategies in the selection pressure and reduces cyclic forgetting. The archive is worker-session state; importing a champion seeds a new archive baseline.


## Symmetric game balance

Chaser and runner now use identical physiology: 100 stamina, the same acceleration, maximum speed, jump strength, recovery and fatigue curve. Their only built-in difference is the objective (tag versus survive).

Evolutionary fitness is comparable across roles. Terminal outcomes share the same 0–200 scale: an early tag approaches 200 for the chaser and 0 for the runner; a late tag approaches 100/100; a full-episode survival is 0/200. Small bounded progress/separation/fall shaping helps bootstrap locomotion but cannot dominate the terminal result, and neither jumping nor unused energy is rewarded directly.

Diagnostics also report per-generation tag rate, runner survival rate and mean tag time from current-population matches only. Hall-of-Fame evaluations still affect selection but are excluded from these balance metrics.

### Fixed world geometry
The champion arena uses fixed world geometry independent of the responsive canvas. Agents remain 40×60 world units, platform heights remain 20 world units, generated platform widths remain within their fixed configured range, and the initial course is based on the 1200×800 policy reference. The visual camera may uniformly scale those world units, but X/Y always share one scale so geometry never deforms. Background NEAT evaluation likewise stays on the fixed 1200×800 training world.

## Agent senses overlay

The champion arena includes an **Agent Senses** overlay (sidebar toggle or `S` key). It is generated from the same `getAgentStateVector()` observation pass that feeds the NEAT policy, so the visualization follows the current 39-input schema rather than a duplicated approximation.

The overlay shows, per agent: normalized self velocity/energy/status, camera-left/right and fall-boundary distances, current/nearest-platform ledge distances and alert, the three nearest platform slots (`dx`, `dy`, width), target/threat dynamics plus opponent stamina, evader teammate dynamics, and all eight lidar rays with normalized distances and exact hit points. Lidar collides with platforms and the left/right camera walls only; other agents are perceived through the separate target/threat and teammate channels.

### Camera zoom and framing
The Champion Arena header includes a visual-only **− / percentage / +** camera control from 50% to 200% in 25% steps. The presentation camera is now separate from the fixed 1200×800 policy/sensor frame. It fills the entire canvas at every aspect ratio and zoom level, while the active platform band is kept at roughly 72% of canvas height so standing agents, full jumps, and the platform remain visible even at maximum zoom. Horizontal presentation tracking remains aligned with the policy camera. No red side-contact flash is drawn.

Canvas sizing is owned by `GameCanvas` itself via `ResizeObserver`, avoiding transient black seams during browser/panel resize. Visual zoom never changes physics, platform/agent world dimensions, raycasts, observation inputs, or worker training. Click the percentage to return to 100%.

### UI density
The application shell is rendered at a built-in 75% presentation scale with a compensated layout viewport, matching the previous appearance at 75% browser zoom while filling the browser at normal 100% zoom.
