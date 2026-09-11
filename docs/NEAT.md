# NEAT and co-evolution setup

The learning problem is adversarial: a Chaser policy must learn pursuit while Runner policies learn navigation and evasion, and each population changes the task faced by the other. The project therefore combines a custom **NEAT** implementation with a co-evolutionary opponent league designed to keep comparisons fair and reduce cycling against only the current opponent population.

The core implementation is in `learning/neat.ts`; population-level evaluation and retention live in `workers/trainingWorker.ts`. The observation vector, starting neural architecture, recurrent memory and action decoder are described separately in [Agent senses and neural-network architecture](SENSES_AND_NETWORK.md).

## Two role-specific populations

Chaser and Runner are evolved as separate NEAT populations, each with 48 genomes. A genome stores node genes, connection genes and innovation numbers. Feed-forward topology and optional recurrent one-step memory can both evolve.

Using separate populations lets each role specialize and removes the need for a redundant role input. At a tag, the physical body changes role and is controlled by the corresponding role policy; one network is not being asked to optimize both objectives at once.

## Innovation tracking and crossover

Structural mutations are assigned innovation numbers by `InnovationTracker`. When the same structural event reappears, this history lets homologous genes line up during crossover.

Crossover favors genes from the fitter parent where genomes disagree. Mutation can perturb weights, add nodes, create new feed-forward layers, add ordinary or recurrent connections, toggle connections, and occasionally prune weak connections.

A small parsimony tie band prefers simpler genomes when fitness is effectively equal. This is not a general complexity penalty: additional structure is kept when it produces a measurable behavioral advantage.

## Speciation

Compatibility distance uses the standard NEAT ingredients—excess genes, disjoint genes and average weight difference—with coefficients `1.0 / 1.0 / 0.4`.

The runtime adapts its compatibility threshold toward a target of eight species. Speciation protects new structural innovations long enough to be tested instead of forcing every new topology to compete immediately with the dominant architecture.

Offspring allocation uses mean adjusted fitness per reproductive species, not raw species population size. Stagnation is tracked with a within-generation normalized performance EMA because raw co-evolutionary fitness is not stationary as opponent pools change. Strong and young species receive protection while old stagnant species can be removed.

Within a reproductive species, roughly the upper half survives into the parent pool. Selection uses small tournaments, crossover is used 75% of the time, and a small amount of inter-species mating is permitted. Eligible species preserve an elite clone before filling the remainder of their offspring quota.

## Fair co-evolutionary evaluation

A naïve co-evolution loop is noisy because genome A might face a strong opponent while genome B receives an easy one. The project therefore uses **common opponent panels**: genomes within a role are evaluated against the same deterministically selected opponent set and seeded scenarios.

Each genome normally receives six opponent matches:

- three against the current opposing population;
- three against the historical league.

For Chasers, both panels are deliberately **midgame-heavy**: two of the three current-population starts and two of the three historical starts begin from real generated midgame states. This keeps platform traversal under direct breeding pressure after flat-ground pursuit has become easy. Runner evaluation keeps the broader opening/varied/midgame curriculum.

Across generations the intended opponent pressure is approximately **50% current, 20% strong recent, 15% strongest historical and 15% behaviorally diverse historical**.

Historical opponents matter because pure current-population co-evolution can cycle: a new strategy beats today's opponent but forgets how to handle strategies that disappeared several generations earlier.

## Hall of Fame

Each role keeps a bounded Hall of Fame of 12 policies: four recent entries plus eight historical/diverse slots. Historical retention considers both fixed-benchmark strength and behavioral novelty, with novelty given the larger weight.

Behavioral descriptors summarize observable play such as tag involvement, falls, movement/action usage and role-specific traversal. These descriptors are used only to maintain a useful opponent archive; they are not another evolutionary reward.

That distinction matters. Diversity in the opponent bank should make evaluation harder and less cyclical without directly rewarding genomes merely for behaving differently.

## Robust breeding fitness

The training worker aggregates a genome's episode scores as:

```text
selection fitness = 0.70 × mean + 0.30 × lower-quartile mean
```

The lower-quartile component makes selection care about weak matchups instead of maximizing average performance alone. A policy that is excellent in easy scenarios but collapses in a substantial minority of cases is therefore less likely to dominate reproduction.

## Validation is separate from breeding

After common-panel evaluation, only the strongest few genomes are re-tested against held-out current opponents and historical policies. **Held-out validation does not change breeding fitness.** It is used to decide retained/generalist champions, not to rewrite the evolutionary competition that produced the generation.

This separation prevents leakage: if validation results fed back into the same generation's fitness, the held-out set would no longer be held out. Retained Chaser selection additionally uses a midgame-heavy cross-play panel. Its score combines a minority fixed-benchmark anchor with current cross-play fitness, pursuit quality and an explicit traversal score. Once a retained Chaser has demonstrated basic midgame platforming, a flat-ground specialist that fails the traversal gate cannot replace it.

The cross-generation benchmark remains frozen so long-run measurements have a stable reference, but it is no longer allowed to dominate Chaser retention. This avoids an old failure mode in which a policy could overfit weak early benchmark Runners, collect easy opening or post-fall tags, and retain the champion title after losing practical parkour ability. Post-fall tags are excluded from competitive episode fitness for the same reason.

Retained display champions and generation champions are not externally re-injected into breeding. Normal NEAT within-species elitism remains intact, so strong genomes can persist without duplicating elitism in the worker. This avoids making a transient Chaser fitness exploit artificially sticky across generations.

The live champion arena follows the retained role-wise champions. A separately curated showcase pair may draw from the Hall of Fame for demo/export purposes, but it cannot replace what the champion arena displays. Showcase pair evaluation uses a fixed scenario panel so unchanged historical candidates do not oscillate in and out merely because the generation number changed the test seeds.

## Key files

| Component | Responsibility |
| --- | --- |
| `learning/neat.ts` | genomes, innovation tracking, compatibility, speciation, crossover and mutation |
| `learning/state.ts` | policy observations; detailed in `SENSES_AND_NETWORK.md` |
| `learning/agent.ts` | policy execution and output decoding; detailed in `SENSES_AND_NETWORK.md` |
| `workers/trainingWorker.ts` | co-evolution, common opponent panels, Hall of Fame, validation and champion retention |
| `learning/trainingEpisode.ts` | deterministic scored matches used by the population worker |

### Elitism and traversal retention

NEAT's normal within-species elitism is the only breeding elitism. The training worker no longer injects an additional generation champion into the next population, because that duplicated elitism made transient Chaser strategies unusually sticky.

Chaser breeding fitness now contains a conditional traversal requirement in addition to tags, falls, pursuit landings and proximity. Retained Champion validation uses a stricter traversal gate than breeding fitness, and the held-out candidate pool explicitly includes strong traversal performers as well as the top raw-fitness genomes.
