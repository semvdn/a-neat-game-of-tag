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

1. Every chaser genome is evaluated against rotating evader genomes in the existing **1 chaser vs 2 runners** game.
2. Every genome receives three current-population evaluations: **two normal-horizon matches plus one longer stretch probe**. Hall-of-Fame tests are scheduled less often at early horizon tiers and become every-generation tests as the populations mature.
3. Match duration follows an adaptive horizon curriculum. Beginner normal matches are only **8–12 seconds**, while the stretch probe is **18–22 seconds**; mature populations eventually reach **30–42 second** normal matches with **45–55 second** stretch probes. Duration is randomized and is not included in the 39-input state vector.
4. A tag no longer ends evaluation: the tagged runner becomes the new chaser, the old chaser becomes a runner with cooldown, and play continues exactly like visual mode. The chaser genome always controls whichever body is currently It; the evader genome controls both non-It bodies.
5. A fall ends only the current bout. The whole group restarts on another valid backbone section of the same procedural course, temporary crumble state is restored, and stamina is preserved.
6. Fitness is calculated from repeated events across the whole match, then averaged across the genome's matchups.
7. Each population is speciated independently. Elites survive, parents are selected, crossover aligns genes by innovation number, then mutations create the next generation.
8. The worker sends the best chaser and evader genomes plus generation diagnostics to the UI.

At `1x`, `2x`, `5x` and `10x`, the app shows normal visual play using the latest champions. Visual tags use the same role-swap semantics, and visual falls now reset the whole bout without refilling stamina, closely matching training. Switching between visual and turbo modes does **not** recreate the worker or discard the evolving populations.

## Adaptive-horizon fitness and bout failures

The old fixed 12-second first-tag objective has been removed, but long matches are no longer paid for on every evaluation from generation 1. Each genome receives two cheap normal matches and one stretch probe. The continuing-match score keeps selection pressure active throughout whatever horizon is currently scheduled:

- every successful tag gives the chaser side **1.0 competitive point**;
- evader survival credit is **continuous at 1.0 point per 10 seconds alive** (for example 5 seconds = 0.5 points), avoiding a hard 10-second reward cliff;
- an evader fall gives the chaser side **1.5 points**;
- a chaser fall gives the evader side **1.5 points**;
- simultaneous failures can award fall points to both sides, then the bout resets and the match continues.

The 1.5× fall weight makes deliberately leaving the terrain worse than accepting a tag. A fall also does **not** refill stamina, removing the old reset exploit. Because tags swap roles and continue, evolution is now directly exposed to the post-tag body/energy/position states seen during normal-speed playback.

At the end of a match, competitive points are normalized to a common 30-second reference before each role's share is mapped to the same roughly 25–220 fitness range. Normal and stretch evaluations therefore stay on the same selection scale rather than a longer probe being valuable merely because it ran longer. Small closest-distance and navigation shaping remains bounded and secondary to repeated tags, continuous survival credit and terrain failures. Jumping and unused stamina are never rewarded directly.

The most useful balance diagnostics are now **tags per 30 seconds**, whole-match chaser/runner win rate, mean uninterrupted evader survival streak, mean tag interval, and the share of bout-ending events caused by falls.

## Adaptive training horizon

Training time grows only when the populations demonstrate competence in the **two normal rounds**. The stretch round is deliberately excluded from horizon progression: it is a robustness test that catches short-horizon policies without forcing every evaluation to become expensive.

Current tiers are:

| Tier | Normal matches | Stretch probe | Hall of Fame |
| --- | --- | --- | --- |
| Beginner | 8–12 s | 18–22 s | every 3 generations |
| Developing | 12–18 s | 22–28 s | every 2 generations |
| Competent | 18–25 s | 28–35 s | every generation |
| Advanced | 24–32 s | 35–42 s | every generation |
| Mature | 30–42 s | 45–55 s | every generation |

The normal-round competence score uses navigation quality, fall-event share, tags per 30 seconds, mean survival streak relative to the normal horizon, and whole-match balance. Five sustained competent generations advance a tier. Three clearly struggling generations can step the horizon back. An EMA and hysteresis prevent one noisy coevolutionary generation from changing the horizon.

Terrain and time complexity are also staggered: a horizon tier change temporarily holds terrain difficulty, and a terrain-difficulty change temporarily holds horizon progression. This avoids simultaneously introducing longer matches and harder procedural terrain.

This substantially reduces early-generation simulation cost. At Beginner, the three current-population rounds average roughly **40 simulated seconds per genome** (10 + 10 + 20) instead of roughly **105 seconds** under the previous always-long 28–42 second setup. Hall-of-Fame evaluation is also skipped on two out of three Beginner generations.

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

Training matches are generated from deterministic seeded **course graphs** rather than a simple linear list of random platforms.

The terrain system is split into shared modules so headless training and visible champion playback use the same rules:

- `level/generator.ts` — seeded backbone + branch/rejoin course generation;
- `level/reachability.ts` — conservative ballistic jump-envelope checks;
- `level/dynamics.ts` — moving-platform motion and crumble/respawn lifecycle;
- `level/curriculum.ts` — competence-driven terrain difficulty.

### Guaranteed reachability

Every graph edge is validated against a conservative jump envelope derived from the game's gravity, jump impulse and maximum horizontal speed. The generator uses only 68–90% of that conservative range as curriculum difficulty rises, and moving-platform amplitudes are included at their **worst relative phase**. This means generated jumps remain physically possible rather than merely possible at one lucky animation instant.

The primary backbone is always available. In Phase 1, crumbling platforms are restricted to optional branch/shortcut routes, so temporary disappearance cannot delete the only traversable path.

### Curriculum

Difficulty starts low and is adjusted after each generation from navigation competence and the fraction of **bout-ending events** caused by terrain failure rather than tags. It increases in small steps only when navigation is reliable and that fall-event share stays below roughly 12%, and it steps backward if falls rise above roughly 32% or navigation collapses.

Feature unlocks currently occur around:

- `0.20` — branch/rejoin paths;
- `0.35` — horizontal and vertical moving platforms;
- `0.52` — contact-triggered crumbling branch platforms.

As difficulty rises, platform widths tighten, vertical variation grows, usable gaps approach more of the safe jump envelope, branches become more frequent, and moving/crumbling modifiers become more common.

### Dynamic platforms

Moving platforms use deterministic sinusoidal motion and carry grounded agents with them. Crumbling platforms enter a warning state on first contact, disappear after a seeded delay, remain absent briefly, then respawn and can be triggered again. Gone platforms are removed from collision and lidar calculations; the renderer leaves a faint dashed ghost to make the temporary route change legible.

The diagnostics overview now reports curriculum difficulty, navigation score, fall-event share, unlocked terrain systems, feature counts in the latest sampled course and the deterministic course seed.

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
NEAT_SURVIVAL_SCORE_WINDOW_MS = 10000
// adaptive duration windows live in level/horizonCurriculum.ts
NEAT_TAG_POINT_WEIGHT = 1.0
NEAT_FALL_POINT_WEIGHT = 1.5
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
- `level/` — seeded procedural course generation, reachability, dynamic platforms, terrain curriculum and adaptive horizon curriculum
- `constants.ts` — NEAT and game parameters

The former PPO math/optimizer module (`learning/math.ts`) has been removed.


## Hall of Fame coevolution

Each evaluated genome plays the balanced current-population matchups. Once historical champions exist, Hall-of-Fame evaluation is scheduled by horizon maturity: every third Beginner generation, every second Developing generation, then every generation from Competent onward. On an active HoF generation each role receives one extra **normal-horizon** matchup against the opposite archive; the stretch duration is not repeated for historical tests. Each role keeps up to 12 champions: the four most recent champions plus a reservoir sample of older generations. This keeps old successful strategies in the selection pressure while avoiding unnecessary early compute. The archive is worker-session state; importing a champion seeds a new archive baseline.


## Symmetric game balance

Chaser and runner use identical physiology: 100 stamina, the same acceleration, maximum speed, jump strength, recovery and fatigue curve. Their only built-in difference is the objective (tag versus survive). The game remains 1v2: one chaser-controller genome controls the current It body and one runner-controller genome simultaneously controls both evader bodies.

Evolutionary fitness is comparable across roles and is based on the whole continuing match rather than a single terminal event. Repeated tags favor the chaser, continuous survival time favors the runner team, and falls are weighted 1.5× more heavily than tags for the opposing side. This makes terrain navigation mandatory without turning navigation itself into the primary reward objective.

Diagnostics report tags per 30 seconds, average tags per match, chaser/runner whole-match win rate, no-tag match rate, mean tag interval, mean uninterrupted runner survival streak and fall-event share from current-population matches only. Hall-of-Fame evaluations still affect selection but are excluded from these balance metrics.
