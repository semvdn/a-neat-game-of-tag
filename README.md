# Tag Agents — Continuous NEAT Trainer

This build evolves two NEAT populations in a 1-chaser / 2-runner platform-tag game with stamina, procedural terrain, moving/crumbling platforms, Hall-of-Fame opponents, and a separate persistent champion view.

## Training architecture

The training worker no longer creates short standalone episodes or uses an adaptive match-horizon curriculum. Instead it owns a configurable pool of **persistent training arenas**. Each arena is a continuous 1v2 world:

- tags swap the `It` role and the arena keeps running;
- falls score a terrain failure and reset only that arena's bout;
- stamina is preserved across fall resets;
- moving/crumbling platform state keeps advancing;
- controller assignments end without resetting the arena;
- an arena independently regenerates its procedural course only after a long world lifetime or repeated bout resets.

The visible champion game is independent from all of these worker arenas.

## Controller scheduling

A controller assignment normally lasts **6–12 simulated seconds**. About **15%** of assignments are longer **15–20 second probes**. The network is never told when an assignment starts or ends.

Most assignments are current-population chaser vs current-population runner. Once Hall-of-Fame champions exist, roughly **20%** of assignments contain one historical opponent:

- ~10% current chaser vs historical runner;
- ~10% historical chaser vs current runner;
- ~80% current vs current.

The scheduler prioritizes under-exposed genomes and explicitly discourages repeated opponent pairings.

## Generation completion

NEAT remains generational. A genome is ready to reproduce after it has accumulated approximately:

- **24 seconds** of controller time;
- **3 or more assignments**;
- experience in **at least 2 arenas**;
- **at least 3 distinct opponents**.

Fitness samples are weighted by active controller time. Once every chaser and runner genome meets the quota, the current partial controller slots are finalized, NEAT breeds the next generation, and the new genomes are hot-swapped into the still-running worlds.

No training arena is reset merely because a generation changed.

## Fitness

Fitness is calculated per controller assignment and normalized to a 30-second reference. The competitive objectives remain symmetric:

- chaser: tags + runner terrain failures;
- runner: continuous survival + chaser terrain failures;
- a fall is weighted more heavily than a normal tag;
- closest-distance and navigation shaping remain small secondary terms;
- unused stamina and jumping are never directly rewarded.

## Persistent terrain curriculum

Only the terrain curriculum remains. Difficulty is driven by navigation quality and the fraction of controller assignments that contain a fall. Courses progressively unlock branches, moving platforms, and crumbling branch platforms while preserving a conservative reachable backbone.

## User controls

The champion view and background trainer are fully independent.

### Champion view

- 0.5x / 1x / 2x / 5x / 10x
- pause/resume
- reset visible champion game
- individual agent respawn on falls; the other agents and visible world continue uninterrupted

### Background training

- 10x / 25x / 50x / 100x / 200x throughput
- pause/resume
- persistent arena count: **2 / 4 / 6 / 8 / 12 / 16**

Changing arena count does not reset the populations. Increasing it adds new persistent worlds; decreasing it finalizes any partial controller samples in removed arenas and keeps evolution moving.

The worker is still one JavaScript worker, so its arenas are interleaved rather than mapped to separate CPU cores. Arena count primarily controls environment/state diversity; the speed setting controls the total simulated arena frames processed per worker tick.

## Hall of Fame

Each role retains up to 12 historical champions: four recent champions plus a reservoir sample of older generations. Hall-of-Fame opponents are sampled directly by the continuous controller scheduler rather than evaluated in a separate phase.

## Key files

- `workers/trainingWorker.ts` — persistent arenas, controller scheduler, exposure accounting, fitness and breeding
- `learning/neat.ts` — genomes, speciation, crossover and structural mutation
- `learning/movement.ts` — shared stamina/fatigue/continuous movement physics
- `level/generator.ts` — deterministic graph-based procedural courses
- `level/curriculum.ts` — adaptive terrain difficulty
- `level/dynamics.ts` — moving and crumbling platforms
- `components/PerformanceDiagnostics.tsx` — continuous-training diagnostics and controls
- `App.tsx` — independent champion view + training controls

## Defaults worth tuning

Continuous training constants live in `constants.ts`:

- `CONTINUOUS_TRAINING_DEFAULT_ARENAS = 8`
- `CONTINUOUS_ASSIGNMENT_MIN_MS = 6000`
- `CONTINUOUS_ASSIGNMENT_MAX_MS = 12000`
- `CONTINUOUS_LONG_ASSIGNMENT_CHANCE = 0.15`
- `CONTINUOUS_EXPOSURE_TARGET_MS = 24000`
- `CONTINUOUS_MIN_ASSIGNMENTS = 3`
- `CONTINUOUS_MIN_ARENAS_PER_GENOME = 2`
- `CONTINUOUS_MIN_OPPONENTS_PER_GENOME = 3`
- `CONTINUOUS_HOF_MATCHUP_CHANCE = 0.20`
