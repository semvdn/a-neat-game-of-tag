# NEAT and co-evolution setup

The learning problem is adversarial: a Chaser policy must learn pursuit while Runner policies learn navigation and evasion, and each population changes the task faced by the other. The project therefore combines a custom **NEAT** implementation with a co-evolutionary opponent league designed to keep comparisons fair and to reduce cycling against only the current opponent population.

The core implementation is in `learning/neat.ts`; policy sensing and control live in `learning/state.ts` and `learning/agent.ts`; population-level evaluation and retention live in `workers/trainingWorker.ts`.

## Two role-specific populations

Chaser and Runner are evolved as separate NEAT populations, each with 48 genomes. A genome stores node genes, connection genes and innovation numbers. The network can evolve both feed-forward structure and recurrent one-step memory.

Using separate populations removes a redundant "am I it?" state input and lets each role specialize. At a tag, the physical body changes role and is controlled by the corresponding role policy; the policy itself is not a single network trying to solve both objectives at once.

## Policy interface

Every policy receives the same compact **23-dimensional world-relative state**:

- self velocity, stamina, grounded state and cooldown;
- target/threat cooldown;
- distances to the current platform's left and right ledges;
- the next two platforms ahead and one behind, each represented by relative position and width;
- target/threat relative position and velocity;
- for Runners, the closest Runner teammate's relative position.

The network emits three controls:

- signed horizontal drive `[-1, 1]`;
- jump;
- sprint.

The state deliberately excludes camera position, viewport boundaries, biome identity and redundant derived features. Earlier raycasts and duplicate movement channels were removed because the semantic platform/ledge inputs already carry the relevant local geometry. This keeps evolution focused on the game state rather than presentation artifacts and reduces the topology search space.

## Starting architecture and memory

New runs use the `memory_evolve` preset for both roles. It begins with two feed-forward hidden layers of **16 → 12** nodes. Recurrent connections start at zero and are allowed to evolve when useful, with a cap of 32 recurrent genes.

This is a compromise between two failure modes:

- forcing recurrence from generation 1 increases the search space before evolution has demonstrated a need for memory;
- forbidding recurrence permanently prevents policies from developing temporal strategies that cannot be inferred from one instantaneous state.

The current architecture mutation rates are deliberately conservative: approximately 1.8% add-node, 0.5% add-layer, 4.5% add-connection and 1.5% add-recurrent-connection probability per mutation pass. Weight mutation remains much more common (80%).

## Innovation tracking and crossover

Structural mutations are assigned innovation numbers by `InnovationTracker`. When the same structural event reappears, the innovation history allows homologous genes to line up during crossover.

Crossover favors genes from the fitter parent where genomes disagree. Mutation can perturb weights, add nodes, split into new feed-forward layers, add ordinary or recurrent connections, toggle connections, and occasionally prune weak connections.

A small parsimony tie band prefers simpler genomes when fitness is effectively equal. This does not impose a general complexity penalty; it only prevents topology from growing for no measurable behavioral advantage.

## Speciation

Compatibility distance uses the standard NEAT ingredients—excess genes, disjoint genes and average weight difference—with coefficients `1.0 / 1.0 / 0.4`.

The runtime starts with a compatibility threshold of 0.8 and adapts it toward a target of eight species. Species protect structural innovations long enough to be tested instead of forcing every new topology to compete immediately with the dominant architecture.

Offspring allocation uses mean adjusted fitness per reproductive species, not raw species population size. Stagnation is tracked with a within-generation normalized performance EMA because raw co-evolutionary fitness is not stationary as opponent pools change. The best species and young species receive protection; old stagnant species can be removed.

Within a reproductive species, roughly the upper half survives into the parent pool. Selection uses small tournaments, crossover is used 75% of the time, and a small amount of inter-species mating is permitted. Eligible species preserve an elite clone before filling the rest of their offspring quota.

## Fair co-evolutionary evaluation

A naïve co-evolution loop can become noisy because genome A might face a strong opponent while genome B receives an easy one. This project therefore uses **common opponent panels**: genomes within a role are evaluated against the same deterministically selected opponent set and seeded scenarios.

Each genome normally receives six opponent matches:

- three against the current opposing population;
- three against the historical league.

Across generations the intended opponent pressure is approximately **50% current, 20% strong recent, 15% strongest historical and 15% behaviorally diverse historical**.

Historical opponents matter because pure current-population co-evolution can cycle: a new strategy beats today's opponent but forgets how to handle strategies that disappeared a few generations ago.

## Hall of Fame

Each role keeps a bounded Hall of Fame of 12 policies: four recent entries plus eight historical/diverse slots. Historical retention considers both fixed-benchmark strength and behavioral novelty; novelty receives the larger weight.

Behavioral descriptors summarize observable play such as tag involvement, falls, movement/action usage and role-specific traversal. These descriptors are used only to maintain a useful opponent archive—they do not become another evolutionary reward.

This distinction is important: diversity in the opponent bank should make evaluation harder and less cyclical without giving genomes direct fitness for looking different.

## Robust breeding fitness

The training worker aggregates a genome's episode scores as:

`selection fitness = 0.70 × mean + 0.30 × lower-quartile mean`

The lower-quartile component makes selection care about weak matchups instead of maximizing only average performance. A policy that is excellent in easy scenarios but collapses in a substantial minority of cases is therefore less likely to dominate reproduction.

## Validation is separate from breeding

After the common-panel evaluation, only the strongest few genomes are re-tested against held-out current opponents and historical policies. This **held-out validation never changes breeding fitness**. It is used to decide retained/generalist champions and the visible showcase, not to rewrite the evolutionary competition that produced the generation.

That separation solves a subtle leakage problem: if validation results were fed back into the same generation's fitness, the "held-out" set would no longer be held out.

The worker also freezes a cross-generation benchmark bank and keeps retained generalist champions separate from transient generation champions. This reduces the chance that a temporary rock-paper-scissors winner automatically replaces a policy that is more reliable across opponents.

## Key files

| Component | Responsibility |
| --- | --- |
| `learning/neat.ts` | genomes, phenotype networks, innovation tracking, compatibility, speciation, crossover and mutation |
| `learning/state.ts` | 23-dimensional policy observation vector |
| `learning/agent.ts` | policy execution and conversion of network outputs to controls |
| `workers/trainingWorker.ts` | co-evolution, common opponent panels, Hall of Fame, validation and champion retention |
| `learning/trainingEpisode.ts` | deterministic scored matches used by the population worker |
