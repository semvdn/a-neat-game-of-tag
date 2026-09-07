# NEAT Tag Agents — Shared Simulation, Compact Senses, Fair Evaluation

This build evolves two NEAT policies—**Chaser** and **Runner**—inside the same gameplay rules used by the visible champion arena. Training runs continuously in background workers while a retained fixed-benchmark **generalist champion** for each role is shown in the browser, so a transient co-evolutionary winner cannot automatically replace a stronger policy.

## Policy interface

The controller is deliberately compact and uses a **single signed horizontal axis**, which prevents left/right outputs from cancelling each other:

- **Policy outputs (3):** `horizontal_drive` (-1 left … +1 right), `jump`, `sprint`
- **Derived action telemetry:** `move_left` / `move_right` are diagnostic labels derived from the signed drive; they are not separate neural outputs
- **Policy inputs:** **23 world-relative state values**; presentation-camera position is intentionally excluded
- **Role-specific networks:** the Chaser and Runner use separate NEAT populations
- **Jump button hysteresis:** jump fires only on a high press and cannot fire again until the output is released below a lower release threshold, eliminating held-output auto-repeat
- **Controlled Jump:** when enabled manually, jump-output magnitude controls jump power/cost instead of requiring a separate action

### Compact 23-input world-relative sense vector

`learning/state.ts` writes directly into caller-owned buffers during training. The layout is:

| Inputs | Meaning |
| --- | --- |
| 0–4 | self horizontal/vertical velocity, energy, grounded state, **normalized remaining cooldown** |
| 5 | target/threat normalized remaining cooldown |
| 6–7 | left/right ledge distance on the current/reference platform |
| 8–10 | nearest platform ahead: dx, dy, width |
| 11–13 | second platform ahead: dx, dy, width |
| 14–16 | nearest platform behind: dx, dy, width |
| 17–20 | current target/threat: dx, dy, vx, vy |
| 21–22 | closest Runner teammate: dx, dy |

The policy state is intentionally **world-relative**. The former left/right camera-boundary channels have been removed because the camera is now presentation-only and must not influence physics or learned decisions. Other previously removed channels remain omitted because they are deterministic duplicates or costly overlapping geometry: role bit, duplicate ledge flags, teammate velocity, LiDAR rays, and a constant bias input.

Nearby platforms use **stable semantic slots** (`next`, `next2`, `previous`) rather than being sorted by Euclidean distance, avoiding sudden slot identity swaps as an agent moves.

Cooldown sensing is continuous rather than boolean. A value of `1` means the relevant body has just entered a protected/no-tag window and it falls smoothly to `0` as that window expires.

> **Compatibility:** this experiment requires fresh policies. Older 39-input, 25-input camera-relative, and four-output left/right checkpoints are intentionally rejected rather than silently remapped.

## Manual abilities only

The former automatic curriculum/unlock mode has been removed. Sprint and Controlled Jump each have only:

- **Off** — disabled;
- **On** — enabled.

When enabled, Chaser and Runner can still be toggled independently. Sprint keeps its per-role Advanced settings for optional maximum-speed and stamina-cost overrides. Sprint stamina now regenerates only while the Sprint output is released; holding Sprint high while stationary produces no boost but blocks recovery, so `sprint = 1 forever` is no longer a free neutral policy. Diagnostics count Sprint only when it is actually boosting horizontal motion. Changing an ability configuration invalidates a partially evaluated generation so a generation is never scored under mixed physics rules. Settings are persisted in browser local storage; legacy `auto` values migrate to `off`.

## Persistent fixed-horizon tag training

Every evaluation runs for the full **12-second simulated horizon**. A tag does not end the episode:

- the tagged body becomes Chaser;
- the previous Chaser becomes a cooldown-protected Runner;
- the same anti-chain-tag delay/cooldown rules as the visible simulation apply;
- play continues after role swaps.

Falls also do not end an episode. The shared fair-respawn routine restores the fallen body while preserving its role, and play continues.

### Sparse event fitness + capped gameplay pace

The competitive objective stays sparse, but movement shaping is designed to avoid both known trivial optima: camping and maximum-speed endless running.

- **Chaser fitness:** `100 + 20 × (contactTags - chaserFalls) + cappedPursuitTraversal`
- **Runner fitness:** `100 + 20 × (-contactTags - runnerFalls) + cappedPaceReward`
- **Runner pace window:** 2 seconds
- **Default pace target:** 260 px of SAFE rightward progress per window, averaged across the two Runner slots
- **Default pace reward:** up to +15 per window; progress beyond the target earns **zero extra fitness**
- **Chaser pursuit shaping:** +2.5 for a first safe landing on terrain already occupied by a Runner, capped at +5 per 2-second window

SAFE rightward progress is still banked only while grounded or after a successful landing; failed airborne distance and respawn teleports never count. The key difference is that safe distance is no longer linearly rewarded forever. Each 2-second window converts progress into a `0..1` completion fraction and caps the reward at the target. A Runner therefore has an incentive to keep the game moving, but no fitness reason to run flat-out once it has satisfied the current pace window. It can reverse, dodge, wait for terrain, or choose a branch without sacrificing additional distance reward.

The Chaser's small terrain-following reward improves credit assignment for multi-platform pursuit without replacing the main objective. A +20 tag remains much more valuable than one traversal event, and the pursuit signal is hard-capped each window.

Falls remain self-penalties only: a Runner fall does not reward the Chaser, and a Chaser fall does not reward the Runner.

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

Every candidate in a role sees the same opponent identities and scenario seeds for that evaluation round. The strongest candidates are then separately re-tested on a held-out panel before the generation champion is selected. A second retention layer evaluates the best held-out candidates on the frozen benchmark and only replaces the visible/saved generalist champion when the challenger clears a real score margin. This retention layer never changes breeding fitness.



## Branch-and-reconnect terrain

The rolling procedural generator now begins introducing route-choice structures after roughly `x = 1800` and increases their probability farther from the origin. Each structure contains an upper branch, a lower branch, and a shared merge platform shortly afterward.

Both routes are deliberately reachable and reconnect quickly. This gives the Runner a route choice while allowing the Chaser to follow directly or attempt an interception, instead of permanently separating the players. Branch generation uses the same deterministic RNG in visual and headless simulation, preserves the platform array's x-order, and branch landings are tracked separately in diagnostics. Upper/lower branches are subtly differentiated visually so route choices are readable during champion play.


## Configurable and evolvable network architecture experiments

The Diagnostics suite includes an **Architecture** tab where architecture is split into three separate ideas: the **generation-1 starting architecture**, whether each structural dimension is allowed to **evolve**, and a **hard cap** that evolution cannot exceed. Changes remain staged until **Apply architecture & restart** is pressed, which intentionally starts fresh populations at generation 1.

The architecture picker now includes curated feed-forward and recurrent presets, while Custom still supports up to **6 starting hidden layers** with up to **64 nodes per starting layer**. The recurrent presets are deliberately conservative because a small number of one-step memory links can add much more behavioural capacity than the same number of ordinary feed-forward links.

| Preset | Generation-1 topology | Memory growth | Intended use |
| --- | --- | --- | --- |
| Minimal NEAT | direct 25→3 | none | fastest control baseline |
| Compact 12 | 25→12→3 | none | cheap nonlinear baseline |
| Deep 16→12 | 25→16→12→3 | none | primary feed-forward control for recurrence experiments |
| Wide 24→16 | wider 2-layer + hidden skips | none | capacity-without-memory stress test |
| Memory Lite | 12 hidden + 4 recurrent | evolves to 16 recurrent | cheapest useful recurrent experiment |
| **Memory Balanced** | 16→12 + 8 recurrent | evolves to 32 recurrent | **recommended general recurrent preset** |
| Memory Discovery | 16→12 + 0 recurrent | recurrence may emerge up to 32 | tests whether evolution chooses memory without being seeded |
| Fixed Memory Control | fixed 16→12 + exactly 12 recurrent | no structural growth | isolates the effect of recurrent state from topology growth |
| Deep Memory | 20→16→12 + 12 recurrent | evolves to 48 recurrent | later high-capacity temporal stress test; slower/harder |

The Architecture tab also provides whole-experiment recipes: **FF control**, **Balanced memory**, **Chaser memory specialist**, **Runner memory specialist**, and **Tactical asymmetric**. These recipes configure both roles together, including asymmetric Chaser/Runner memory experiments, but remain staged until **Apply architecture & restart** is pressed.

For each Chaser/Runner role the user can independently configure:

- starting hidden-layer count and every starting layer width;
- whether **hidden-layer count may evolve**, its maximum depth (up to 8), and add-layer mutation rate;
- whether **hidden-node count may evolve**, its total hidden-node cap (up to 384), and add-node mutation rate;
- starting recurrent-memory connection count;
- whether **recurrent connection count may evolve**, its hard cap (up to 512), and add-recurrent mutation rate;
- initial feed-forward connection density, input→output skips, hidden-layer skips, weight scale, and ordinary add-connection mutation rate.

Layer and node evolution are distinct. A **new-layer mutation** splits a feed-forward edge at a new intermediate depth, increasing network depth by one (subject to both layer and node caps). A **new-node mutation** adds capacity inside an already-existing hidden depth without making the network deeper. This makes experiments such as “fixed 2-layer depth but evolvable width” or “evolvable depth but capped at 4 layers” possible.

Recurrent links are genuine one-step memory connections rather than feed-forward cycles. They may connect hidden/output state back to hidden/output state, including self-connections. Each physical game agent receives an **independent recurrent state context**, even though multiple bodies share the same role policy genome, and recurrent state is reset cleanly between evaluation episodes and when a body changes roles. Feed-forward topology therefore remains a DAG while recurrence reads the previous simulation step.

All structural caps are enforced inside mutation itself. Disabled recurrent genes still count toward the recurrent gene cap, preventing long runs from accumulating unlimited historical recurrent genes. Starting recurrent topology is deterministic across the population just like starting feed-forward topology, so architecture comparisons do not accidentally compare different random wiring diagrams.

Generation metrics now record average/champion hidden-node count, hidden-layer count and recurrent-connection count. The network visualization places evolved hidden nodes by feed-forward depth and draws recurrent memory links as dashed fuchsia arcs. Full checkpoints and analysis exports preserve the complete architecture/evolution configuration.

To prevent structural drift from turning every long run into a cap-sized network, reproduction now uses **near-tie parsimony**: when genomes fall inside a narrow performance band, parent selection prefers fewer recurrent links, then fewer hidden nodes, then fewer enabled connections. Raw fitness remains primary and species allocation is unchanged. Mutation also has a small weak-connection pruning path and automatically removes hidden nodes that become disconnected, so complexity can move downward as well as upward.

A useful experiment sequence is **Deep 16→12 (feed-forward control) → Memory Lite → Memory Balanced**. Memory Discovery is useful after that if you want to ask whether recurrence is selected by evolution rather than supplied at generation 1. Fixed Memory Control is the cleanest way to separate “memory helps” from “structural growth helps”. Deep Memory should be treated as a later stress test rather than a default because it increases both evaluation cost and the search space.

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

Press **S** or use the sidebar toggle to show the current 23 policy inputs. The overlay displays self state, target/threat, teammate position, semantic platform slots, ledges and normalized cooldowns. The presentation camera is intentionally absent from policy sensing. It no longer draws LiDAR rays because LiDAR is no longer part of the policy input.

## Important files

- `learning/state.ts` — compact allocation-efficient 23-D world-relative policy state
- `learning/agent.ts` — three-output signed-horizontal NEAT controller wrapper and compatibility checks
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
- retained generalist champion genomes/validation metadata plus current generation metrics;
- recent + behaviorally diverse Hall-of-Fame entries, including their descriptors and fixed-benchmark strength;
- the frozen cross-generation benchmark reference bank and suite revision;
- role Elo, cumulative tag/fall/jump/action telemetry, recent tag/survival intervals and last balance metric;
- the current manual Sprint/Controlled Jump configuration and Runner exploration strength;
- the accumulated per-generation analysis log;
- UI diagnostic histories when saved/exported through the app.

Checkpoints are captured at **completed-generation boundaries**. If Save/Export is pressed while evaluator workers are halfway through the next generation, the latest complete boundary is written rather than serializing an inconsistent subset of completed worker batches. Restoring resumes that full population at the beginning of its next evaluation. Champion-only JSON created by the factorized-control builds can seed fresh populations/species/Hall-of-Fame state. This temporary experiment build uses three policy outputs (`signed horizontal drive`, `jump`, `sprint`) and the new 23-input world-relative state schema. Older four-output or 25-input camera-relative checkpoints are rejected rather than silently remapped; start a fresh run for this experiment. Checkpoints created by this build remain fully restorable.

The full checkpoint JSON can become much larger than a champion-only file; **Export checkpoint** is therefore the most robust long-term archive path. Browser-local Save still uses local storage and can hit the browser's quota on very large, highly complex populations.

## Fixed cross-generation benchmark

Each completed generation is evaluated on a run-local frozen benchmark suite. It remains outside **population breeding selection**, but it now also serves a separate generalist-retention role:

- 3 frozen Chaser references and 3 frozen Runner references are captured from the population at the beginning of the run/import;
- each champion faces every opposite-role reference on the same permanent seeds;
- each reference is tested once from the exact visual reset, once from a varied fresh reset, and once from a real shared-simulation mid-game snapshot;
- this produces 9 fixed matches per role (18 total) after each generation;
- benchmark matches do **not** change genome breeding fitness, Elo, Hall-of-Fame matchup telemetry, or population balance counters;
- the best held-out candidates are scored 75% on the frozen suite and 25% on cross-play against the retained opposing champion plus the strongest Hall-of-Fame opponents;
- cross-play validation is diagnostic-only and never changes breeding fitness, Elo, or lifetime training counters;
- a challenger must beat the incumbent generalist score by a configured margin before the visible/checkpoint champion is replaced;
- Runner retention adds an explicit pace term and low-pace penalty so stationary survival policies cannot displace broadly mobile Runners.

The diagnostics panel stores both the generation benchmark and the retained generalist generation/score, so unlike coevolutionary training fitness the validation signal is directly comparable from one generation to the next. The suite revision is reset when a new run/model import establishes a new frozen reference bank, and is also advanced when Sprint/Controlled Jump physics settings or pace/pursuit shaping values change because scores across different capability/reward configurations are not strictly comparable.

## Behaviorally diverse Hall of Fame

The Hall of Fame remains bounded to 12 champions per role, but historical retention is no longer uniform reservoir sampling:

- the 4 most recent champions are always retained;
- the remaining 8 slots are reserved for behaviorally diverse historical champions;
- every champion receives a behavioral descriptor from the fixed benchmark: tag involvement, own-fall rate, right-drive activation, jump activation, sprint activation, idle rate, and (for Runners) pace completion / (for Chasers) normalized pursuit traversal;
- champions that occupy nearly the same behavioral niche compete directly, with the stronger fixed-benchmark representative retained;
- once the historical archive is full, replacement balances behavioral novelty (75%) with fixed-benchmark strength (25%).

This keeps the opponent league from filling with many generations of effectively the same strategy while still preserving recent coevolutionary pressure.



## Hybrid camera-decoupled pursuit training

Normal training now uses the validated **B camera-decoupled pursuit baseline** permanently: Memory Discovery networks, Chaser base/sprint `5.7 / 7.9` with `28/s` sprint drain, Runner `5.0 / 7.5` with `24/s`, 900 ms post-fall Runner protection, pressure starts, non-repeatable Chaser proximity progress, and the capped Runner pressure-escape signal. The presentation camera remains observational only and never changes world physics.

Population opponents use a league mixture without forcing the retained display champion into every historical panel. Each genome gets three common current-generation matches and three historical-league matches. The historical slots are scheduled so the long-run total mix is approximately **50% current, 20% strong recent, 15% strongest historical, and 15% behaviorally diverse historical**. This preserves current co-evolution pressure while repeatedly revisiting older skills.

### Soft multi-distance Chaser retention

The strict pass/fail contemporary gate from the earlier C experiment is no longer the normal retention rule. Chaser generalist retention combines **70% frozen benchmark score + 30% smooth pursuit score**. The pursuit score is measured across close, normal, long and midgame starts and grades four components rather than demanding a binary pass:

- 30% clean-tag capability;
- 35% closing distance in normal/long starts;
- 20% sustained time within 200 px;
- 15% close encounters.

The component targets saturate progressively, so partial pursuit improvements remain selectable while clean tags still matter. Runner retention remains benchmark-heavy rather than inheriting the Chaser-specific pursuit rule.

### Earlier recurring branches and light elite seeding

Branching terrain begins around `x = 650`, with guaranteed exposure windows around the first `x ≈ 850–1150` opportunity and a second around `x ≈ 1450–1850`. Farther right, a spacing guard prevents very long stretches without another branch. This changes terrain exposure rather than granting a direct branch-choice reward.

At evolution boundaries, up to two **distinct-generation retained/recent elites per role** may replace tail offspring. Their fitness is reset to zero, they re-enter normal speciation and evaluation, and they receive no artificial score. This provides a small genetic memory without freezing the population.

The Architecture diagnostics **Run experiment** tool now performs one fresh **D · Hybrid soft-pursuit league** validation run using exactly this integrated setup. The original run is restored automatically after export or **Cancel & restore**. The default target remains **275 generations**, configurable from 50–1500, and the report includes soft-pursuit components plus elite-seeding provenance.

### Camera is observational only

Agents are never clamped to the left or right viewport edge, and fair respawn is performed entirely in world coordinates. Rolling platform retention expands to include the leftmost and rightmost active agents, so a lagging Chaser keeps traversable terrain even when temporarily off-screen. The presentation camera follows the active Chaser + nearest Runner pair with smoothing.

The two camera-boundary inputs remain removed from the policy state, keeping the state vector at **23 inputs**. Checkpoints carry `stateSchema: world-relative-senses-v3`; older 25-input checkpoints are rejected rather than silently remapped.

## Analysis recording and deterministic behavior probes

The Diagnostics → Models tab includes **Export analysis JSON**. This is intentionally smaller and more analysis-oriented than a full evolutionary checkpoint. It contains:

- a retained per-generation record (up to 2000 generations) with population fitness/species metrics, balance, fixed benchmark, Hall-of-Fame state, role Elo, action shares, pace/pursuit shaping, landings and chase-interaction metrics;
- the exploration reward configuration used for each generation, so later retuning is visible in the history;
- Runner pace completion/reward, safe rightward progression, raw left/right envelopes, platform/branch landings and Chaser pursuit traversal;
- the current run totals/configuration;
- three deterministic current-champion probe episodes (exact visual, varied fresh and true mid-game), sampled every 250 ms.

Each probe sample records camera X, Runner safe/raw progression, accumulated pace/pursuit shaping, close encounters/evades, tags/falls, generated platform range, and every body's x/y position, velocity, role, status, cooldown, stamina, jump-latch readiness, signed horizontal-drive/jump/sprint controls, grounded state, platform id and branch/merge structure type. Uploading this analysis JSON in a later conversation makes it possible to diagnose camping, oscillation, directional collapse, repeated fall loops, weak pursuit, action saturation and whether exploration is actually producing deeper level traversal. It also records close encounters, successful evades, nearest-Runner distance, time spent within 100/200/400 px, new-platform and branch landings, and tags occurring within two seconds of a Runner fall/respawn so genuine pursuit can be separated from catches caused mainly by platform mistakes.


## Training sleep / stall resilience

Background evolution now has two safeguards for long unattended runs:

- While active training is running, the app requests the browser Screen Wake Lock API so the display does not automatically sleep when supported. The lock is reacquired when the document becomes visible again.
- Parallel evaluator batches have a watchdog. If one evaluator stops returning work for 15 seconds, only that evaluator is recreated and its exact in-flight tasks are retried; the population and current generation are preserved. The visible UI also nudges the trainer after 5 seconds without telemetry and immediately after a visibility/sleep transition.

The training header shows `awake` while the screen wake lock is active. A `↻N` badge and the diagnostics panel show how many stalled evaluator batches were automatically recovered. Recovery data is also included in the analysis JSON export.

Browsers cannot keep JavaScript running if the operating system fully suspends/hibernates the computer or the browser process is explicitly discarded, but the trainer will recover outstanding evaluator work when execution resumes.


### Memory-safe long runs and experiment export

The pursuit experiment runner avoids large transient browser allocations: generation-boundary restart checkpoints no longer duplicate the full analysis history, explicit model checkpoints retain only the latest 500 diagnostic generations, and the temporary two-condition report stores compact trajectory points every 5 generations while keeping final metrics and probes at full detail. The final experiment report is serialized inside the training worker and handed to the UI as a single JSON string, avoiding a second structured-cloned report object plus another renderer-side stringify copy. This is intended to prevent V8/renderer out-of-memory crashes even when the operating system still has substantial free RAM.
