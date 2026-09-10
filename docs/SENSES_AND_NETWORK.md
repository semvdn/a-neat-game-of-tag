# Agent senses and neural-network architecture

The agents do not see pixels and they do not receive the camera view. Each policy acts from a compact **23-value world-relative state vector** designed to expose the information needed for platforming, pursuit and evasion without making the controller depend on presentation details.

The observation builder lives in `learning/state.ts`. The NEAT phenotype and topology rules live in `learning/neat.ts`, while `learning/agent.ts` converts network outputs into movement controls.

## Why semantic senses?

The main design problem is to give evolution enough information to solve the game without making the search space unnecessarily large.

Earlier versions used a larger state vector with LiDAR-style rays, camera-relative values and several derived features. Much of that information was redundant. Nearby platform geometry was already represented by ledge distances and platform positions, while camera bounds described rendering rather than game state.

The current representation therefore uses **semantic world-space observations**. Instead of asking the network to infer that a platform is ahead from several ray intersections, the simulation directly supplies the next useful platforms and their geometry. This reduces input dimensionality, keeps observations stable when the camera zooms or the browser resizes, and gives NEAT a smaller topology-search problem.

## The 23 inputs

Positions are normalized against a fixed **1200 × 800 world reference**, not the current browser viewport. That makes the policy invariant to presentation size.

| Index | Observation |
| ---: | --- |
| 0 | Horizontal velocity |
| 1 | Vertical velocity |
| 2 | Energy / stamina |
| 3 | Grounded state |
| 4 | Own tag cooldown |
| 5 | Target/threat tag cooldown |
| 6 | Distance to left ledge |
| 7 | Distance to right ledge |
| 8 | Next platform horizontal offset |
| 9 | Next platform vertical offset |
| 10 | Next platform width |
| 11 | Second-ahead platform horizontal offset |
| 12 | Second-ahead platform vertical offset |
| 13 | Second-ahead platform width |
| 14 | Previous platform horizontal offset |
| 15 | Previous platform vertical offset |
| 16 | Previous platform width |
| 17 | Target/threat horizontal offset |
| 18 | Target/threat vertical offset |
| 19 | Target/threat horizontal velocity |
| 20 | Target/threat vertical velocity |
| 21 | Closest Runner teammate horizontal offset |
| 22 | Closest Runner teammate vertical offset |

### Role-dependent target selection

The vector layout is shared by both populations, but the opponent channels resolve differently by role.

For a **Chaser**, the target is the nearest Runner. For a **Runner**, the threat is the active Chaser. Runner-only teammate channels point to the closest other Runner.

Because Chaser and Runner are evolved as separate populations, the vector does not need an `isChaser` input. The identity of the network already defines the role.

## Stable platform slots

The three platform slots are selected by **forward/backward world ordering**, not raw Euclidean distance:

- nearest usable platform ahead;
- second usable platform ahead;
- nearest usable platform behind.

This solves a subtle instability. If platforms are sorted only by distance, two nearby surfaces can swap input slots when the agent moves by only a few pixels. The physical world changes smoothly, but the meaning of an input suddenly changes. Semantic ahead/behind slots keep the channels much more stable.

Only platforms the agent can actually use on its current route are considered, so the network is not encouraged to plan around a visually nearby branch that is not physically accessible from its path.

## What the policy does not sense

Several plausible observations are deliberately absent:

- camera position and viewport edges — presentation must not affect the policy;
- biome identity — terrain geometry should drive behaviour rather than a biome label;
- LiDAR/raycast channels — ledges and semantic platforms already encode the important nearby geometry;
- closest-ledge and ledge-warning flags — deterministic duplicates of the two ledge-distance channels;
- role bit — redundant because the roles use separate populations;
- constant bias input — every non-input NEAT node already has an evolvable bias;
- teammate velocity — removed as lower-value extra dynamics while teammate position was retained.

The objective is not to expose every measurable variable. It is to provide a compact state from which useful behaviour can evolve.

# Neural-network architecture

Each policy is a NEAT genome containing node genes and connection genes. Whenever a topology changes, the genome is compiled into a runtime `NeatNetwork`.

## Starting topology

New runs use the `memory_evolve` architecture for both Chaser and Runner populations. Generation 1 starts with:

```text
23 inputs
   ↓
16 hidden nodes
   ↓
12 hidden nodes
   ↓
3 outputs
```

The initial feed-forward connection density is **60%**. Direct input-to-output skip connections are also enabled, so useful simple reactions do not have to pass through both hidden layers.

The important point is that **16 → 12 is only the starting topology**. NEAT is allowed to change it as evolution proceeds.

## What NEAT can change

Under the current `memory_evolve` preset, evolution may:

- perturb or replace connection weights;
- mutate node biases;
- add feed-forward connections;
- add hidden nodes;
- create additional feed-forward depth by splitting connections into new layers;
- disable or re-enable connections;
- prune weak connections;
- evolve recurrent connections.

The search is bounded at **4 hidden feed-forward layers**, **96 hidden nodes** and **32 recurrent connection genes**. These limits prevent unbounded topology growth during long runs while still leaving substantial structural freedom.

A small parsimony tie-break prefers the simpler genome only when fitness is effectively tied. Complexity is therefore permitted when it improves behaviour, but is not rewarded for its own sake.

## Feed-forward evaluation

Enabled non-recurrent connections form an acyclic graph. The phenotype compiles that graph into topological order once when the genome changes and then uses dense numeric arrays during simulation.

For every non-input node, the network sums the current-step weighted inputs plus that node's evolvable bias and applies:

```text
activation(x) = 2 / (1 + exp(-4.9x)) - 1
```

Internal and output activations therefore lie approximately in `[-1, 1]`.

The compiled-array representation is a performance choice. Policy activation runs millions of times during training, so avoiding per-step graph traversal through temporary maps and objects reduces allocation and garbage-collection overhead.

## Recurrent connections: optional one-step memory

Recurrent genes are stored separately from the feed-forward DAG. A recurrent edge reads the **previous activation step** of its source node instead of the value currently being calculated.

Each physical agent receives its own recurrent context, so two bodies controlled by the same genome cannot leak hidden state into one another.

`memory_evolve` begins with **zero recurrent links** and allows evolution to add them up to the 32-link cap.

This deliberately avoids two opposite assumptions. Forcing recurrence from generation 1 makes every candidate more complex before memory has proved useful. Forbidding it permanently prevents evolution from discovering temporal strategies that are difficult to infer from a single instantaneous state. Here, memory is available, but selection must justify it.

## The three outputs

The network exposes three factorized outputs:

| Output | Runtime role |
| --- | --- |
| 0 | horizontal drive |
| 1 | jump signal / intensity |
| 2 | sprint intensity |

Factorized controls allow an agent to move horizontally, jump and sprint simultaneously. A single discrete action output would force choices such as “move right *or* jump”, which is poorly matched to platform movement.

The jump signal behaves like a button with hysteresis: it must cross a high threshold to trigger and then drop below a lower release threshold before another jump is armed. This prevents a permanently high output from turning into automatic repeated jumping.

Sprint scales acceleration and maximum speed while consuming stamina. Holding sprint also blocks stamina regeneration, which gives the controller a reason to learn when to release it.

### Horizontal control

The NEAT phenotype uses a symmetric activation in approximately `[-1, 1]`. The **`signed-horizontal-controls-v3`** decoder feeds the first output directly into horizontal drive:

```text
horizontalDrive = clamp(output0, -1, 1)
```

A zero neural activation is therefore genuinely neutral, with symmetric ranges for leftward and rightward control. Current genomes and checkpoints carry this schema explicitly; incompatible controller schemas are rejected rather than translated at load time.

Jump and sprint clamp negative activations to zero and positive activations to at most one.

## Why this architecture fits the problem

The controller must solve two coupled problems: **continuous platform movement** and **adversarial pursuit/evasion**.

A tiny fixed network is easy to optimize but may lack enough capacity for route choice and opponent dynamics. A large hand-designed recurrent network provides capacity but greatly expands the search space and assumes in advance which complexity is needed.

The current design takes a middle path:

- 23 semantic observations expose the important game structure directly;
- the 16→12 starting network supplies useful nonlinear capacity from generation 1;
- direct skip connections preserve simple reflex-like solutions;
- NEAT can expand, rewire or simplify the topology;
- recurrence is available but must earn its place through selection.

The weights, connectivity, hidden structure and memory pathways can therefore all become part of the evolved behaviour rather than being fixed architectural assumptions.

## Key implementation files

| File | Responsibility |
| --- | --- |
| `learning/state.ts` | constructs and labels the 23-dimensional observation vector |
| `learning/agent.ts` | runs the phenotype and decodes the three outputs into controls |
| `learning/neat.ts` | genome representation, architecture presets, phenotype compilation, recurrence and structural mutation |
| `learning/simulationCore.ts` | applies movement controls to the shared game physics |
| `workers/trainingWorker.ts` | evolves the Chaser and Runner populations and selects retained policies |
