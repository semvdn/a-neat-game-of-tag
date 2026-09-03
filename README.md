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

At `25x` and `50x`, the persistent training worker performs headless evolutionary evaluation.

For each generation:

1. Every chaser genome is evaluated against rotating evader genomes.
2. Every genome receives the same number of evaluations (currently 3).
3. Episodes end on a tag or after 12 seconds of simulated time.
4. Fitness is averaged across the genome's matchups.
5. Each population is speciated independently.
6. Elites survive, parents are selected, crossover aligns genes by innovation number, then mutations create the next generation.
7. The worker sends the best chaser and evader genomes plus generation diagnostics to the UI.

At `1x`, `2x`, `5x` and `10x`, the app shows normal visual play using the latest champions. Switching between visual and turbo modes does **not** recreate the worker or discard the evolving populations.

## Fitness

Terminal performance is deliberately dominant, with modest dense shaping so locomotion can bootstrap before reliable tags emerge.

Both roles use the same terminal 0–200 outcome scale. Early tags strongly favor the chaser, late tags approach 100/100, and a full-episode survival is 0/200. Only small bounded closing/separation, progress and fall shaping is added. Jumping and unused stamina are not rewarded directly.

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

The roles now have intentionally **identical physiology**: 100 stamina, the same maximum speed, acceleration, jump power, recovery and fatigue curve. Strategic asymmetry comes only from the chase/survive objectives and how each evolved controller chooses to spend stamina.

The 39-input genome shape is preserved for checkpoint compatibility. The former constant bias input was redundant with NEAT node biases, so that slot now carries **target/threat energy reserve**. Own energy was already part of the state vector.

## Mirrored and randomized evaluation

Each generation now evaluates both leftward and rightward escape orientations. With the default three matchups per genome, seed parity guarantees that both orientations occur rather than relying on chance. Start spacing and translation are also randomized within a safe range.

The headless course is geometrically mirrored for leftward episodes, camera tracking is allowed into negative world coordinates, and progress shaping is measured relative to the episode's flow direction. This removes the old shortcut where `move right` could become a globally correct policy. Visual champion playback also randomizes its initial orientation and spacing on reset.


## Phase 1 adaptive procedural terrain

Training episodes are now generated from deterministic seeded **course graphs** rather than a simple linear list of random platforms.

The terrain system is split into shared modules so headless training and visible champion playback use the same rules:

- `level/generator.ts` — seeded backbone + branch/rejoin course generation;
- `level/reachability.ts` — conservative ballistic jump-envelope checks;
- `level/dynamics.ts` — moving-platform motion and crumble/respawn lifecycle;
- `level/curriculum.ts` — competence-driven terrain difficulty.

### Guaranteed reachability

Every graph edge is validated against a conservative jump envelope derived from the game's gravity, jump impulse and maximum horizontal speed. The generator uses only 68–90% of that conservative range as curriculum difficulty rises, and moving-platform amplitudes are included at their **worst relative phase**. This means generated jumps remain physically possible rather than merely possible at one lucky animation instant.

The primary backbone is always available. In Phase 1, crumbling platforms are restricted to optional branch/shortcut routes, so temporary disappearance cannot delete the only traversable path.

### Curriculum

Difficulty starts low and is adjusted after each generation from navigation competence and terrain-related fall rate. It increases in small steps only when navigation is reliable and can step backward if falls become dominant.

Feature unlocks currently occur around:

- `0.20` — branch/rejoin paths;
- `0.35` — horizontal and vertical moving platforms;
- `0.52` — contact-triggered crumbling branch platforms.

As difficulty rises, platform widths tighten, vertical variation grows, usable gaps approach more of the safe jump envelope, branches become more frequent, and moving/crumbling modifiers become more common.

### Dynamic platforms

Moving platforms use deterministic sinusoidal motion and carry grounded agents with them. Crumbling platforms enter a warning state on first contact, disappear after a seeded delay, remain absent briefly, then respawn and can be triggered again. Gone platforms are removed from collision and lidar calculations; the renderer leaves a faint dashed ghost to make the temporary route change legible.

The diagnostics overview now reports curriculum difficulty, navigation score, falls per agent episode, unlocked terrain systems, feature counts in the latest sampled course and the deterministic course seed.

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
- `workers/trainingWorker.ts` — population ownership, headless matches, fitness, curriculum and generation loop
- `components/PerformanceDiagnostics.tsx` — NEAT diagnostics and topology visualizer
- `App.tsx` — champion rendering, worker lifecycle, persistence and UI integration
- `level/` — seeded procedural course generation, reachability, dynamic platforms and adaptive curriculum
- `constants.ts` — NEAT and game parameters

The former PPO math/optimizer module (`learning/math.ts`) has been removed.


## Hall of Fame coevolution

Each evaluated genome plays the normal balanced current-population matchups and, once historical champions exist, an extra matchup against the opposite role's Hall of Fame. Each role keeps up to 12 champions: the four most recent champions plus a reservoir sample of older generations. This keeps old successful strategies in the selection pressure and reduces cyclic forgetting. The archive is worker-session state; importing a champion seeds a new archive baseline.


## Symmetric game balance

Chaser and runner now use identical physiology: 100 stamina, the same acceleration, maximum speed, jump strength, recovery and fatigue curve. Their only built-in difference is the objective (tag versus survive).

Evolutionary fitness is comparable across roles. Terminal outcomes share the same 0–200 scale: an early tag approaches 200 for the chaser and 0 for the runner; a late tag approaches 100/100; a full-episode survival is 0/200. Small bounded progress/separation/fall shaping helps bootstrap locomotion but cannot dominate the terminal result, and neither jumping nor unused energy is rewarded directly.

Diagnostics also report per-generation tag rate, runner survival rate and mean tag time from current-population matches only. Hall-of-Fame evaluations still affect selection but are excluded from these balance metrics.
