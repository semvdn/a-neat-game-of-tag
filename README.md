# NEAT Tag Agents — Shared Simulation, Compact Senses, Fair Evaluation

This build evolves two NEAT policies—**Chaser** and **Runner**—inside the same gameplay rules used by the visible champion arena. Training runs continuously in background workers while the latest completed champions are shown in the browser.

## Policy interface

The controller intentionally stays small, but its four outputs are now **factorized rather than mutually exclusive**:

- **Outputs (4):** `move_left`, `move_right`, `jump`, `sprint`
- **Simultaneous controls:** left/right drive and jump can be active on the same physics step; Sprint is independent and ignored when the manual Sprint ability is disabled
- **Policy inputs:** **25 compact state values**
- **Role-specific networks:** the chaser and runner use separate NEAT populations
- **Controlled Jump:** when enabled manually, jump-output magnitude controls jump power/cost instead of requiring a separate action

### Compact 25-input sense vector

`learning/state.ts` writes directly into caller-owned buffers during training. The layout is:

| Inputs | Meaning |
| --- | --- |
| 0–4 | self velocity, vertical velocity, energy, grounded state, **normalized remaining cooldown** |
| 5–7 | left/right policy-frame distance and **target/threat normalized remaining cooldown** |
| 8–9 | left/right ledge distance on the current/reference platform |
| 10–12 | nearest platform ahead: dx, dy, width |
| 13–15 | second platform ahead: dx, dy, width |
| 16–18 | nearest platform behind: dx, dy, width |
| 19–22 | current target/threat: dx, dy, vx, vy |
| 23–24 | closest runner teammate: dx, dy |

The old 39-input representation was deliberately simplified. Removed channels were either deterministic duplicates or costly overlapping geometry:

- role / `is It` bit — redundant because the networks are role-specific;
- closest-ledge and near-ledge flags — derivable from the retained left/right ledge distances;
- teammate velocity — lower-value duplicate dynamic information;
- eight LiDAR rays — overlapped with platform, ledge and frame information;
- constant bias input — NEAT nodes already have evolvable biases.

Nearby platforms now have **stable semantic slots** (`next`, `next2`, `previous`) rather than being sorted by Euclidean distance, avoiding sudden slot identity swaps as an agent moves.

Cooldown sensing is continuous rather than boolean. A value of `1` means the relevant body has just entered its role-specific protected/no-tag window and it falls smoothly to `0` as that window expires. This correctly exposes both the new Chaser's brief 600 ms no-tag delay and a protected Runner's 2 s cooldown. The target/threat cooldown occupies the former fall-depth channel, which was nearly constant during normal gameplay.

> **Compatibility:** old 39-input champions remain incompatible. In addition, checkpoints/policies from the former mutually-exclusive left/right/jump/wait controller are intentionally rejected because the same four output neurons now have factorized semantics. Start a fresh evolutionary run in this build.

## Manual abilities only

The former automatic curriculum/unlock mode has been removed. Sprint and Controlled Jump each have only:

- **Off** — disabled;
- **On** — enabled.

When enabled, Chaser and Runner can still be toggled independently. Sprint keeps its per-role Advanced settings for optional maximum-speed and stamina-cost overrides. Changing an ability configuration invalidates a partially evaluated generation so a generation is never scored under mixed physics rules. Settings are persisted in browser local storage; legacy `auto` values migrate to `off`.

## Persistent fixed-horizon tag training

Every evaluation runs for the full **12-second simulated horizon**. A tag does not end the episode:

- the tagged body becomes Chaser;
- the previous Chaser becomes a cooldown-protected Runner;
- the same anti-chain-tag delay/cooldown rules as the visible simulation apply;
- play continues after role swaps.

Falls also do not end an episode. The shared fair-respawn routine restores the fallen body while preserving its role, and play continues.

### Sparse event fitness + safe Runner progression

Training keeps the competitive objective sparse and adds one traversal incentive for the Runner.

- **Chaser fitness:** `100 + 20 × (contactTags - chaserFalls)`
- **Runner fitness:** `100 + 20 × (-contactTags - runnerFalls) + safeRightViewports × explorationStrength`
- default `explorationStrength = +50 fitness / safely banked 1200 px viewport` (manually adjustable from 0–100).

Tags are the only directly competitive event: every contact tag rewards the Chaser and penalizes the Runner. Falls are strictly self-penalties. A Runner fall lowers only Runner fitness, and a Chaser fall lowers only Chaser fitness; the opponent receives no fitness benefit from another agent's platforming failure.

Runner exploration fitness is based on **per-body safe rightward progression**, not raw X displacement or a single team maximum. Each physical body keeps its own safe right frontier while it is controlled by the Runner policy. Grounded rightward running banks immediately; airborne travel is only banked when the body successfully lands. If it falls, the airborne distance earns zero and any respawn teleport is absorbed into the baseline without reward. Role-entry positions after a tag are also rebased without reward so Chaser movement can never be misattributed to the Runner. The banked progress from all bodies is divided by the two simultaneous Runner slots, preventing one highly exploratory body from fully hiding a stationary teammate. Raw left/right envelopes are still recorded diagnostically but do not affect fitness. At the default strength, one full safely traversed viewport is worth +50, deliberately strong enough to compete with the old stationary-jumping local optimum while falls/tags remain -20 each.

## Visual-game parity and start diversity

`learning/simulationCore.ts` is the common gameplay implementation used by both visible play and headless evaluation for:

- movement and ability physics;
- role timers and cooldowns;
- tagging / role swaps;
- fair falling and respawn;
- horizontal camera following;
- rolling procedural platform retention/generation.

The visual simulation remains the authoritative setup. Training keeps the same logical **1200×800** arena, camera walls, procedural platforms, movement, tag rules and fair respawn.

With the default three-opponent population panel, every candidate now receives three deliberately different start classes:

1. **Exact visual reset** — `x = 100 / 400 / 700`, body 1 initially It, with the same viewport-width starting platform and airborne reset height.
2. **Varied fresh reset** — the same opening arena with randomized initial It body, separation and horizontal arrangement.
3. **Real mid-game snapshot** — a deterministic 4.2–9.0 second scripted pre-roll through the **shared simulation core** advances the actual camera and rolling procedural world. Most mid-game snapshots then deliberately place the two Runners on valid later procedural platforms (often one near a forward edge), with the Chaser on a nearby platform behind them; a substantial subset launches a Runner into a real shared-physics jump arc. This directly trains later-platform traversal instead of merely generating later scenery off-screen.

Mid-game snapshots are independent of the genomes being evaluated, so candidates compared on a shared seed still receive exactly the same starting state. Snapshot generation first resolves any in-progress fall to a legitimate landing/fair respawn, then samples useful states including Runner-focused later-platform placements, partial stamina, real shared-physics jump arcs, and occasional immediate post-tag states produced by the normal `resolveTagSwap()` cooldown/role transition. Pre-roll tags/falls do **not** score; only events after the snapshot count toward the 12-second evaluation.

Hall-of-Fame matches use mid-game starts, and held-out champion validation mixes fresh and mid-game starts. This makes it much harder to become champion by memorizing only the opening geometry. Generated mid-game snapshots are cached per seed inside each evaluator worker so the extra state diversity does not require replaying the pre-roll for every candidate.

## Fair opponent evaluation

Fitness comparisons use **common opponent panels** rather than different random opponents per candidate:

- Chaser population: 48 genomes
- Runner population: 48 genomes
- Common current-population panel: 3 opponents per candidate
- Common Hall-of-Fame opponent: 1 when available
- Held-out champion validation: top 4 candidates against 4 unused current-population opponents plus up to 2 Hall-of-Fame opponents

Every candidate in a role sees the same opponent identities and scenario seeds for that evaluation round. The strongest candidates are then separately re-tested on a held-out panel before champion selection.


## Persistent long-term species management

NEAT species now persist as real evolutionary lineages instead of being rebuilt from scratch every generation. Each species keeps a stable ID, representative, creation generation, age, best-ever raw fitness, smoothed relative performance, and last-improvement generation.

Long-run behavior now includes:

- genomes are assigned to the **closest compatible persistent representative**, reducing assignment-order churn;
- each surviving species representative is updated to a **medoid genome** (the member most central to the species), making species identity more stable than using an arbitrary member;
- stagnation is measured from a smoothed **within-generation relative score**, rather than raw historical fitness, because coevolutionary fitness changes as opponent populations change;
- species are only considered stagnant after **20 generations without meaningful relative improvement**;
- species younger than **5 generations** are protected so new structural innovations have time to establish themselves;
- the currently strongest **2 species** (including the global champion's lineage) are protected from stagnation extinction;
- stagnant, unprotected species are removed from reproduction, freeing population capacity for improving/new lineages;
- every reproducing species receives at least one offspring slot before the remaining population is allocated by explicitly shared mean fitness;
- mating parents are drawn from the top **50% within each species**, reducing drift from weak members while preserving intra-species diversity;
- species elites are preserved for substantial species and for protected young lineages;
- offspring quotas use deterministic largest-remainder allocation rather than repeatedly roulette-selecting a species for every child, preventing small rounding effects from accidentally erasing a lineage.

The diagnostics panel now reports active species, reproducing species, stagnant species, extinctions in the latest generation, oldest lineage age, mean lineage age, and separate species-count/longevity history charts.

## Training performance optimizations

The browser still trains as fast as available CPU resources permit; there is no user-set training multiplier.

Important hot-path changes in this build:

- `LearningAgent.chooseActionInto()` uses `NeatNetwork.activateFast()` and a reusable decision object instead of allocating a decision/output copy every policy step;
- episode policy inputs are written into reusable `Float64Array(25)` buffers instead of allocating a new state array every decision;
- per-agent action indices/strengths, decisions, pre-physics body snapshots and physics result buffers are reused for the entire episode;
- headless training uses `stepAgentPhysicsInPlace()`, which executes the same equations as the immutable visual wrapper but mutates existing AgentState/vector objects instead of rebuilding them every body/tick;
- target, teammate and platform sensing uses direct scans instead of filter/map/sort allocation chains;
- headless rolling platform maintenance compacts/generates the existing platform array in place, avoiding a new retained array/result object every physics tick while preserving the existing x-order;
- parallel episode workers receive each distinct genome **once per evaluation epoch**, cache the constructed controllers, and evaluate later tasks by compact controller key;
- episode requests are batched, reducing worker-message and structured-clone overhead;
- one logical CPU is reserved for the browser/UI and the evaluator pool is capped at 12 workers.

These changes are intentionally CPU-focused. The NEAT networks are small, topology-dependent graphs, so reducing JavaScript allocation and worker serialization is expected to help more than moving this workload to a laptop GPU.

## Diagnostics fixes

Diagnostics now match the persistent fixed-horizon game:

- **Runner clean survival** means an evaluation episode contained **neither a contact tag nor a Runner fall**;
- Chaser/Runner fall rates mean the fraction of fixed-horizon population matches containing at least one fall by that role;
- diagnostic role Elo now measures the tag contest only: at least one contact tag = Chaser win, a tag-free fixed horizon = Runner win; personal falls and exploration are excluded because they are not zero-sum events;
- Runner wins are no longer inferred from aggregate fall counts;
- Chaser and Runner fall totals are tracked separately;
- dead/incomplete benchmark-session state was removed;
- the visible arena now advances from real `requestAnimationFrame` elapsed time with a fixed 16.67 ms physics step, so **1× has the same simulation speed on 60, 120 and 144 Hz displays**.

Role Elo is diagnostic only and does not influence NEAT selection.

## Senses overlay

Press **S** or use the sidebar toggle to show the current 25 policy inputs. The overlay displays self state, target/threat, teammate position, semantic platform slots, ledges, frame boundaries and normalized cooldowns. It no longer draws LiDAR rays because LiDAR is no longer part of the policy input.

## Important files

- `learning/state.ts` — compact allocation-efficient 25-D policy state
- `learning/agent.ts` — four-output factorized NEAT controller wrapper and compatibility checks
- `learning/trainingEpisode.ts` — fixed-horizon persistent evaluation with reusable buffers
- `learning/simulationCore.ts` — gameplay shared by visual and headless simulation
- `learning/neat.ts` — NEAT evolution/network implementation
- `learning/elo.ts` — corrected role-level diagnostic Elo and leaderboard accounting
- `workers/trainingWorker.ts` — population evaluation, common panels, Hall of Fame, validation and telemetry
- `workers/episodeWorker.ts` — epoch-cached, batched parallel evaluator
- `components/GameCanvas.tsx` — champion arena and compact senses overlay
- `components/InfoPanel.tsx` — manual abilities and agent status
- `components/PerformanceDiagnostics.tsx` — training/evolution/game-balance diagnostics
- `App.tsx` — visible champion simulation and background-training orchestration

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

## Full evolutionary checkpoints

The persistence controls now save **full NEAT evolutionary checkpoints**, not only the two visible champions. A checkpoint contains:

- all 48 Chaser and 48 Runner genomes in the current generation;
- innovation-number and split-node tracker state, so future structural mutations continue with correct historical markings;
- persistent species ids, representatives, ages, best/EMA performance and stagnation history;
- current champion genomes and generation metrics;
- recent + behaviorally diverse Hall-of-Fame entries, including their descriptors and fixed-benchmark strength;
- the frozen cross-generation benchmark reference bank and suite revision;
- role Elo, cumulative tag/fall/jump/action telemetry, recent tag/survival intervals and last balance metric;
- the current manual Sprint/Controlled Jump configuration and Runner exploration strength;
- the accumulated per-generation analysis log;
- UI diagnostic histories when saved/exported through the app.

Checkpoints are captured at **completed-generation boundaries**. If Save/Export is pressed while evaluator workers are halfway through the next generation, the latest complete boundary is written rather than serializing an inconsistent subset of completed worker batches. Restoring resumes that full population at the beginning of its next evaluation. Champion-only JSON created by this factorized-control build can seed fresh populations/species/Hall-of-Fame state. Pre-factorized left/right/jump/wait policies and v1 full checkpoints are intentionally rejected because their four outputs have different semantics.

The full checkpoint JSON can become much larger than a champion-only file; **Export checkpoint** is therefore the most robust long-term archive path. Browser-local Save still uses local storage and can hit the browser's quota on very large, highly complex populations.

## Fixed cross-generation benchmark

Each completed generation is now evaluated on a run-local benchmark suite that is completely outside evolutionary selection:

- 3 frozen Chaser references and 3 frozen Runner references are captured from the population at the beginning of the run/import;
- each champion faces every opposite-role reference on the same permanent seeds;
- each reference is tested once from the exact visual reset, once from a varied fresh reset, and once from a real shared-simulation mid-game snapshot;
- this produces 9 fixed matches per role (18 total) after each generation;
- benchmark matches do **not** change genome fitness, champion selection, Elo, Hall-of-Fame matchup telemetry, or population balance counters.

The diagnostics panel stores the benchmark score by generation, so unlike coevolutionary training fitness it is directly comparable from one generation to the next. The suite revision is reset when a new run/model import establishes a new frozen reference bank, and is also advanced when Sprint/Controlled Jump physics settings or the Runner exploration fitness strength change because scores across different capability/reward configurations are not strictly comparable.

## Behaviorally diverse Hall of Fame

The Hall of Fame remains bounded to 12 champions per role, but historical retention is no longer uniform reservoir sampling:

- the 4 most recent champions are always retained;
- the remaining 8 slots are reserved for behaviorally diverse historical champions;
- every champion receives a behavioral descriptor from the fixed benchmark: tag involvement, own-fall rate, right-drive activation, jump activation, sprint activation, idle rate, and (for Runners) normalized safe rightward progression;
- champions that occupy nearly the same behavioral niche compete directly, with the stronger fixed-benchmark representative retained;
- once the historical archive is full, replacement balances behavioral novelty (75%) with fixed-benchmark strength (25%).

This keeps the opponent league from filling with many generations of effectively the same strategy while still preserving recent coevolutionary pressure.


## Analysis recording and deterministic behavior probes

The Diagnostics → Models tab includes **Export analysis JSON**. This is intentionally smaller and more analysis-oriented than a full evolutionary checkpoint. It contains:

- a retained per-generation record (up to 5000 generations) with population fitness/species metrics, balance, fixed benchmark, Hall-of-Fame state, role Elo, action shares and Runner frontier metrics;
- the exploration reward configuration used for each generation, so later retuning is visible in the history;
- safe rightward progression plus raw left/right Runner envelopes in logical viewports per episode;
- the current run totals/configuration;
- three deterministic current-champion probe episodes (exact visual, varied fresh and true mid-game), sampled every 250 ms.

Each probe sample records camera X, left/right Runner envelope, safe banked progression, tags/falls, generated platform range, and every body's x/y position, velocity, role, status, cooldown, stamina, primary action label, independent left/right/jump/sprint control strengths, grounded state and platform id. Uploading this analysis JSON in a later conversation makes it possible to diagnose camping, oscillation, directional collapse, repeated fall loops, weak pursuit, action saturation and whether exploration is actually producing deeper level traversal.


## Training sleep / stall resilience

Background evolution now has two safeguards for long unattended runs:

- While active training is running, the app requests the browser Screen Wake Lock API so the display does not automatically sleep when supported. The lock is reacquired when the document becomes visible again.
- Parallel evaluator batches have a watchdog. If one evaluator stops returning work for 15 seconds, only that evaluator is recreated and its exact in-flight tasks are retried; the population and current generation are preserved. The visible UI also nudges the trainer after 5 seconds without telemetry and immediately after a visibility/sleep transition.

The training header shows `awake` while the screen wake lock is active. A `↻N` badge and the diagnostics panel show how many stalled evaluator batches were automatically recovered. Recovery data is also included in the analysis JSON export.

Browsers cannot keep JavaScript running if the operating system fully suspends/hibernates the computer or the browser process is explicitly discarded, but the trainer will recover outstanding evaluator work when execution resumes.
