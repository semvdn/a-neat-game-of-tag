# Simulation and training reference

See [the repository guide](../README.md), [code architecture](ARCHITECTURE.md), and [gameplay lab](EVALUATION.md). Objective v10 counts only pressure exits without an intervening tag or registered fall as successful evades.

This build evolves two NEAT policies—**Chaser** and **Runner**—inside the same gameplay rules used by the visible champion arena. When training is running, background workers evolve the populations while a retained fixed-benchmark **generalist champion** for each role is shown in the browser, so a transient co-evolutionary winner cannot automatically replace a stronger policy. The repository bootstraps from the curated generation-7422 full checkpoint; kiosk exhibition pauses evolution by default so that pair remains stable.

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

> **Compatibility:** the current controller requires 23-input world-relative policies with three factorized outputs. Older 39-input, 25-input camera-relative, and four-output left/right checkpoints are intentionally rejected rather than silently remapped.

## Manual abilities only

The former automatic curriculum/unlock mode has been removed. Sprint and Controlled Jump each have only:

- **Off** — disabled;
- **On** — enabled.

When enabled, Chaser and Runner can still be toggled independently. Sprint keeps its per-role Advanced settings for optional maximum-speed and stamina-cost overrides. Sprint stamina now regenerates only while the Sprint output is released; holding Sprint high while stationary produces no boost but blocks recovery, so `sprint = 1 forever` is no longer a free neutral policy. Diagnostics count Sprint only when it is actually boosting horizontal motion. Changing an ability configuration invalidates a partially evaluated generation so a generation is never scored under mixed physics rules. Settings are persisted in browser local storage; legacy `auto` values migrate to `off`.

## Persistent maximum-horizon tag training

Evaluation runs for a **maximum 12-second simulated horizon**, ending early on a Chaser escape failure. A tag does not end the episode:

- the tagged body becomes Chaser;
- the previous Chaser becomes a cooldown-protected Runner;
- the same anti-chain-tag delay/cooldown rules as the visible simulation apply;
- play continues after role swaps.

Falls still do not end an episode. The shared fair-respawn routine restores the fallen body while preserving its role, and play continues. A **camera-envelope escape** is different: if the Chaser is so far from **every Runner** that even the nearest Chaser–Runner pair would require less than 50% of the invariant reference zoom, the Runners have escaped and that scored episode ends immediately. Runner–Runner separation by itself never counts as a Chaser failure.

### Sparse event fitness + capped gameplay pace

Revision v12 adds a world-distance separation penalty capped at 6 points per role per episode and qualifies the positive pace bonus by mean group cohesion during that window. Pace shortfall still uses actual safe progress. See [solid-group rules](SOLID_GROUP.md) for distance bands, contacts and landing semantics.

The competitive objective stays sparse, but movement shaping is designed to avoid both known trivial optima: camping and maximum-speed endless running.

- **Chaser fitness:** `100 + 20 × (contactTags - chaserFalls - nonDuplicatedEscapeFailures) + cappedPursuitTraversal + cappedProximityProgress - cappedGroupSeparation`
- **Runner fitness:** `100 + 20 × (-contactTags - runnerFalls) + cappedPaceReward - paceShortfallPenalty + cappedCleanPressureEscape - cappedGroupSeparation`
- **Runner pace window:** 2 seconds
- **Default pace target:** 260 px of SAFE rightward progress per window, averaged across the two Runner slots
- **Default pace reward:** up to +15 per window; progress beyond the target earns **zero extra fitness**
- **Chaser pursuit shaping:** +2.5 for a first safe landing on terrain already occupied by a Runner, capped at +5 per 2-second window

SAFE rightward progress is still banked only while grounded or after a successful landing; failed airborne distance and respawn teleports never count. The key difference is that safe distance is no longer linearly rewarded forever. Each 2-second window converts progress into a `0..1` completion fraction and caps the reward at the target. A Runner therefore has an incentive to keep the game moving, but no fitness reason to run flat-out once it has satisfied the current pace window. It can reverse, dodge, wait for terrain, or choose a branch without sacrificing additional distance reward.

The Chaser's small terrain-following reward improves credit assignment for multi-platform pursuit without replacing the main objective. A +20 tag remains much more valuable than one traversal event, and the pursuit signal is hard-capped each window.

Falls remain self-penalties only: a Runner fall does not reward the Chaser, and a Chaser fall does not reward the Runner. An escape is also a Chaser-only failure event worth the same `-20` as a Chaser fall; it does not award an artificial `+20` to the Runner. If a Chaser fall itself crosses the escape boundary on that same physics frame, the failure is logged as an escape but the `-20` is not charged twice.

## Visual-game parity and start diversity

`learning/simulationCore.ts` is the common gameplay implementation used by both visible play and headless evaluation for:

- movement and ability physics;
- role timers and cooldowns;
- tagging / role swaps;
- fair falling and respawn;
- horizontal camera following;
- rolling procedural platform retention/generation.

The visual simulation remains the authoritative setup. Training keeps the same logical **1200×800** arena, world-relative physics, procedural platforms, movement, tag rules and fair respawn.

Evaluation and validation combine these start classes with the close/normal/long pressure curriculum described below:

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
- Common historical-league panel: 3 matches when available (see the league-mixture section below)
- Held-out champion validation: top 4 candidates against 4 unused current-population opponents plus up to 2 Hall-of-Fame opponents

Every candidate in a role sees the same opponent identities and scenario seeds for that evaluation round. The strongest candidates are then separately re-tested on a held-out panel before the generation champion is selected. A second retention layer evaluates the best held-out candidates on the frozen benchmark and only replaces the visible/saved generalist champion when the challenger clears a real score margin. This retention layer never changes breeding fitness.



## Recursive route terrain and moving platforms

The procedural terrain generator builds **true route trees** rather than a one-platform upper/lower detour. Every branch begins from a stable staging ledge and two reachable commitment platforms. Landings record the chosen route for diagnostics; they never disable another surface. Nested forks inherit a **hard vertical corridor** from their parent route, so descendants cannot leak into sibling territory merely because a crowded placement would be convenient. If an inherited corridor does not have enough room for another clean split, recursion stops early even when the configured maximum depth is higher. This makes maximum depth a ceiling, not an instruction to generate cramped or impossible geometry.

Route geometry is intentionally asymmetric. Recursion is probabilistic, one side may continue while the other receives ordinary transit ledges, and route lengths are generated from bounded platform pitches rather than stretching a small number of ledges across a large recursive span. Consecutive route climbs are kept comfortably inside the normal jump envelope, first-fork and merge transitions stay conservative, and explicit merge checkpoints slide forward to the actual resolved route endpoints. Every generated surface is landable, including nested sibling routes and platforms outside the policy sensing slots or camera view. Physical distance governs pursuit and tagging; route labels no longer block interaction.

Ordinary trunk terrain uses a reflected random-walk profile instead of independent height noise. Most runs are gentle, with occasional climbs and descents, wider breathing room on flat sections and shorter reaches for uphill jumps. This produces recognizable runs and elevation changes without long rows of identical platforms or white-noise staircases.

Moving platforms use deterministic oscillation and share the same implementation in headless training and the continuous champion view. Trunk platforms may move horizontally or vertically; branch-route platforms move horizontally only and only on internal route ledges. Commitment platforms, route endpoints and merge checkpoints stay stationary so choosing and rejoining a path remains readable. A branch that follows a moving trunk platform first inserts a stationary staging ledge, preventing route choice from depending on an arbitrary motion phase.

Platform generation enforces both a **hard no-overlap invariant** and a real safety-clearance invariant. Platforms whose horizontal ranges coincide keep substantial vertical breathing room, while near-level neighbors retain a readable horizontal gap. A moving platform is checked against every other platform using its **complete swept oscillation envelope**, not just its starting rectangle or sampled frames. Unsafe motion is shortened, made one-sided, moved to the alternate axis where allowed, or removed entirely. The generator never accepts an overlap as a fallback.

The sidebar **Terrain variety** menu controls the distribution independently for training and display:

- Training: enable branching and/or moving terrain and set the percentage of episodes that contain each feature. Selected training episodes guarantee actual exposure to the chosen feature, while deterministic seed rolls keep comparisons fair across genomes.
- Continuous champion view: independently toggle each feature and set its per-segment spawn chance.
- Branch complexity: set 1–6 platforms per route, enable recursive sub-branching, and choose maximum depth 1–4.
- Moving-platform difficulty: set maximum oscillation speed from 0–180 px/s and choose whether moving platforms may occur inside branches.

The platform collection is no longer assumed to be spatially sorted; generation follows the forward trunk/outer merge while complete active branch trees are retained until the agents have cleared them. This prevents recursive sibling routes or moving platforms from corrupting rolling terrain generation.


## Configurable and evolvable network architecture

The Diagnostics suite includes an **Architecture** tab where architecture is split into three separate ideas: the **generation-1 starting architecture**, whether each structural dimension is allowed to **evolve**, and a **hard cap** that evolution cannot exceed. Changes remain staged until **Apply architecture & restart** is pressed, which intentionally starts fresh populations at generation 1.

The architecture picker now includes curated feed-forward and recurrent presets, while Custom still supports up to **6 starting hidden layers** with up to **64 nodes per starting layer**. The recurrent presets are deliberately conservative because a small number of one-step memory links can add much more behavioural capacity than the same number of ordinary feed-forward links.

| Preset | Generation-1 topology | Memory growth | Intended use |
| --- | --- | --- | --- |
| Minimal NEAT | direct 23→3 | none | fastest control baseline |
| Compact 12 | 23→12→3 | none | cheap nonlinear baseline |
| Deep 16→12 | 23→16→12→3 | none | primary feed-forward control for recurrence experiments |
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

Diagnostics now match the persistent maximum-horizon game (normally 12 seconds, with early termination on escape):

- **Runner clean survival** means an evaluation episode contained **neither a contact tag nor a Runner fall**;
- Chaser/Runner fall rates mean the fraction of population matches containing at least one fall by that role; Chaser escape rate separately records matches terminated by excessive chase separation;
- diagnostic role Elo still measures the tag contest only: at least one contact tag = Chaser win, a tag-free episode (including an escape-terminated episode) = Runner win; personal falls and exploration are excluded because they are not zero-sum events;
- Runner wins are no longer inferred from aggregate fall counts;
- Chaser and Runner fall totals are tracked separately;
- dead/incomplete benchmark-session state was removed;
- the visible arena now advances from real `requestAnimationFrame` elapsed time with a fixed 16.67 ms physics step, so **1× has the same simulation speed on 60, 120 and 144 Hz displays**.

Role Elo is diagnostic only and does not influence NEAT selection.

## Senses overlay

Press **S** or use the sidebar toggle to show the current 23 policy inputs. The overlay displays self state, target/threat, teammate position, semantic platform slots, ledges and normalized cooldowns. The presentation camera is intentionally absent from policy sensing. It no longer draws LiDAR rays because LiDAR is no longer part of the policy input.

## Streamlined telemetry UI

The normal sidebar intentionally shows only live role/action/stamina/Elo information for the visible agents. The old expandable 23-input bars and per-frame visual reward breakdown were removed: policy inputs are better inspected with the Senses overlay, while training quality belongs in the Diagnostics suite. The Diagnostics Overview is also deliberately compact, focusing on generation/throughput, best fitness, species count, clean tags, Runner pace, chase distance, role failure rates, retained champions and a few trend charts. Detailed topology, architecture, action distributions and run/checkpoint data remain in their own tabs, and full analysis telemetry is still preserved in exported JSON.


## Coding-agent guidance

The repository now includes both `AGENTS.md` (the cross-agent autodiscovery convention) and the requested `agent.md` copy. Project-local Agent Skills live under `skills/*/SKILL.md`. They capture the recurring workflows for NEAT co-evolution, procedural terrain, training diagnostics, UI telemetry, and release/Git packaging. Agents should read the relevant skill before making substantial changes and must make a real Git commit before packaging a handoff ZIP.

## Important files

- `learning/state.ts` — compact allocation-efficient 23-D world-relative policy state
- `learning/agent.ts` — three-output signed-horizontal NEAT controller wrapper and compatibility checks
- `learning/trainingEpisode.ts` — maximum-horizon persistent evaluation with reusable buffers and terminal escape handling
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

Checkpoints are captured at **completed-generation boundaries**. If Save/Export is pressed while evaluator workers are halfway through the next generation, the latest complete boundary is written rather than serializing an inconsistent subset of completed worker batches. Restoring resumes that full population at the beginning of its next evaluation. Champion-only JSON created by the factorized-control builds can seed fresh populations/species/Hall-of-Fame state. The current controller uses three policy outputs (`signed horizontal drive`, `jump`, `sprint`) and the 23-input world-relative state schema. Older four-output or 25-input camera-relative checkpoints are rejected rather than silently remapped; current-schema checkpoints remain fully restorable.

The full checkpoint JSON can become much larger than a champion-only file; **Export checkpoint** is therefore the most robust long-term archive path. Browser-local Save uses an IndexedDB checkpoint library rather than `localStorage`, but it can still hit browser/site-storage quotas on very large, highly complex populations.

## Bundled showcase checkpoint

`public/showcase/neat_tag_checkpoint_gen7422.json` is the repository's curated default showcase. It is a normal full checkpoint and passes the same `world-relative-senses-v3` / `signed-horizontal-controls-v2` validation as user imports. The full evolutionary state is at **generation 7422**, while its saved UI diagnostics preserve the exact display selection present at export: **Chaser `chaser_hof_g7410` + Runner `evader_hof_g4381`**. At startup the main thread installs that saved display pair into the visible arena (falling back to retained checkpoint champions only if display diagnostics are absent), then restores the full population, Hall of Fame, innovation tracker, benchmark state, and training configuration into the worker. Normal studio training can therefore resume from generation 7422 without changing what the curated artwork initially displays.

For unattended display, `?exhibit=1` starts visual playback automatically after this local checkpoint loads and keeps background evolution paused. `?exhibit=1&train=1` explicitly opts back into evolution. A missing/incompatible bundled checkpoint is surfaced as an error instead of silently pretending the fresh random policies are the curated artwork.

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

### Configurable terrain curriculum and light elite seeding

For training episodes selected to contain branching terrain, route exposure begins around `x = 650` and is front-loaded so policies reliably encounter a split instead of receiving a nominal "branch episode" with no branch. A second early opportunity and a later spacing guard keep route decisions recurring. Episodes selected for moving terrain likewise receive at least one actual moving platform. The user-facing episode percentages determine how often each curriculum feature is active; neither feature adds a direct fitness reward.

At evolution boundaries, up to two **distinct-generation retained/recent elites per role** may replace tail offspring. Their fitness is reset to zero, they re-enter normal speciation and evaluation, and they receive no artificial score. This provides a small genetic memory without freezing the population.

### Camera is observational only

Agents are never clamped to the left or right viewport edge, and fair respawn is performed entirely in world coordinates. Rolling platform retention expands to include the leftmost and rightmost active agents, so a lagging Chaser keeps traversable terrain even when temporarily off-screen. The presentation camera dynamically frames the active chase group and ignores bodies once they have clearly fallen more than the normal traversal band below their last grounded support, so a missed platform cannot drag the camera downward. If every body is falling, the presentation holds its previous framing until somebody respawns. The user's zoom setting is treated as the preferred maximum zoom, but automatic framing never shrinks below **50% of the invariant reference view**. If the Chaser exceeds that readable envelope relative to **every Runner**, training applies one Chaser failure event and terminates the episode. In the continuous champion view the world is not reset: only the Chaser is teleported to a legal platform roughly 220–360 px behind the trailing Runner, placed on the Runner's active route, and given the normal brief tag re-arm delay. Runner–Runner separation alone does not trigger the Chaser failure. Horizontal/vertical safety clamps still keep an active Chaser–Runner pair inside the padded frame up to that boundary.

The two camera-boundary inputs remain removed from the policy state, keeping the state vector at **23 inputs**. Checkpoints carry `stateSchema: world-relative-senses-v3`; older 25-input checkpoints are rejected rather than silently remapped.

## Analysis recording and deterministic behavior probes

The Diagnostics → **Runs & data** tab includes **Export analysis JSON**. This is intentionally smaller and more analysis-oriented than a full evolutionary checkpoint. It contains:

- a retained per-generation record (up to 2000 generations) with population fitness/species metrics, balance, fixed benchmark, Hall-of-Fame state, role Elo, action shares, pace/pursuit shaping, landings, chase-interaction metrics and Chaser escape rate;
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

### Exhibition runtime recovery

The visible showcase is intentionally less dependent on the training worker than the studio. Fatal React/render errors and uncaught page errors in `?exhibit=1` request a bounded reload (maximum three attempts per rolling minute). Reloading reconstructs the curated visible agents from the bundled checkpoint. If the training worker itself fails while kiosk training is paused, the visual simulation remains usable; if exhibition was explicitly launched with `train=1`, worker failure requests the same bounded page recovery.

## Visual separation fail-safe

The persistent champion/visual arena has a presentation-only separation watchdog that is not used by
headless training. If the maximum center-to-center distance between any two visual agents remains above
1,800 world pixels for 5 simulated seconds, the showcase is considered fragmented.

The fail-safe computes the midpoint of the widest pair, selects a sufficiently wide nearby platform
(preferring static platforms), and regroups every agent there in their existing left-to-right order.
Roles, Elo, energy, and timers are preserved; velocity/acceleration and recurrent visual-policy state
are reset, trails are restarted, and short tag protection prevents the teleport itself from creating a
free tag. If no suitable platform exists at timeout, the watchdog remains armed and retries on later
visual ticks. This is strictly a visual recovery mechanism and does not alter training fitness or
training episode termination.
