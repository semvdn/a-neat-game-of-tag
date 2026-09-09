# Visual and mechanical biomes

The infinite world now uses the same deterministic biome field for presentation and terrain-generation bias. A biome is derived from world X + world seed; the policy is **not** given a biome ID. Instead, agents experience the geometry and platform motion that the biome produces.

Macro-regions are 12,000 world pixels with a 2,000-pixel `smoothstep` transition. Lowlands remains the first region and the remaining nine biomes are deterministically shuffled per world seed. Mechanical profile values are interpolated through the same transition, so terrain changes gradually rather than at a hard boundary.

## Active terrain identities

The values below are multipliers on the already-tuned base generator. They bias candidate geometry; existing reachability, branch-corridor, spacing, moving-sweep and overlap validators remain authoritative.

| Biome | Width | Vertical | Gap | Branch | Movers | Mover speed | Route persistence | Intended play character |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Lowlands | 1.16 | 0.78 | 0.94 | 1.18 | 0.68 | 0.90 | 1.18 | Broad, readable rolling routes with long commitments |
| Spires | 0.88 | 1.42 | 1.02 | 1.18 | 1.05 | 1.00 | 0.94 | Narrower, strongly vertical routes |
| Foundry | 1.00 | 1.04 | 1.00 | 0.88 | 2.05 | 1.18 | 1.00 | Machinery-heavy routes with frequent/faster movers |
| Ruins | 0.92 | 1.14 | 1.04 | 1.12 | 0.72 | 0.90 | 0.90 | Broken, less regular static routes; future crumble focus |
| Desert | 1.10 | 0.82 | 1.10 | 0.78 | 0.48 | 0.90 | 1.18 | Broad, flatter, more separated routes with fewer forks/movers |
| Snowy Mountains | 0.86 | 1.52 | 0.96 | 1.30 | 1.05 | 0.90 | 0.88 | Most vertical terrain, narrow landings, frequent route choices |
| Temperate Forest | 1.03 | 1.03 | 0.94 | 1.38 | 0.72 | 0.86 | 1.06 | Dense branching with compact, coherent routes |
| City | 1.00 | 1.22 | 0.98 | 1.02 | 1.70 | 1.14 | 1.00 | Vertical urban platforming with frequent moving structures |
| Rural Village | 1.18 | 0.74 | 0.90 | 1.10 | 0.46 | 0.80 | 1.26 | Widest/flattest, calmest routes with strong continuity |
| Swamp | 0.94 | 0.72 | 0.92 | 1.34 | 1.08 | 0.70 | 0.90 | Low, compact, densely branching routes with slow movers |

`crumbleWeightMultiplier` is retained in the profile schema as the design target for a later crumble-platform implementation. It is intentionally **not active yet**: crumble state/mechanics are not currently part of the simulation's observable platform state, so enabling it now would violate the rule against hidden biome physics.

## How the generator uses a profile

Trunk generation applies width, gap and vertical-variation multipliers before the existing global reachability clamps. Route persistence biases how often the trunk stays near-level and how long branch routes remain coherent. Branch weight affects top-level fork probability and nested-fork tendency. Moving-platform weight/speed scale the existing mover system. Multi-platform branch structures capture one profile at their root so a transition boundary cannot change geometry halfway through a single fork structure.

Biomes therefore change the **proposal distribution**, never the safety rules. The existing no-overlap/swept-envelope clearance system can reject or reposition a biome-biased proposal exactly as before.

## Training exposure

Visible continuous play uses biome offset 0 so artwork and terrain mechanics remain geographically aligned. Training uses a deterministic seed-derived `biomeWorldOffsetX`; this stratifies episode terrain across all ten mechanical biomes while leaving the policy's world coordinates near the normal episode origin. No biome ID is added to the 23-input policy state.

Midgame episode caches include the biome offset in their cache key so geometry from one biome cannot be reused as another biome's training scenario.

## Visual design

Each biome retains a distinct pixel-art silhouette and material language. Scenery remains presentation-only and uses a separate RNG namespace from terrain generation. Background descriptors are cached under the existing 96-chunk LRU limit.

The final art pass deliberately uses larger, less repetitive landmarks rather than increasing object density: desert cacti are sparse among broader mesas/arches/boulders; snowy peaks are large and separated; forest crowns form broad masses; city structures use believable height variation; rural cottages/barns dominate over occasional windmills; and swamp vegetation mixes cypress/deadwood with low reeds, water glints and fog.

`biome_visual_sanity_check.png` is generated from recorded draw operations from the actual renderer. The sheet includes representative active terrain-profile proportions and the real agent sprites so platform/scenery scale and agent contrast can be checked together. It is documentation only and is not loaded by the game.
