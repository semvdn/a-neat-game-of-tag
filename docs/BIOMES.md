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

The asset pass deliberately uses a hierarchy of large landmarks and smaller supporting forms rather than increasing object density. Lowlands mixes open oaks, hedges, poplars and low stone mounds; Desert uses sparse saguaros among broad mesas, arches, hoodoos and boulders; Snowy Mountains separates large peaks from pines and occasional chalets; Temperate Forest mixes broad canopy trees with low understorey/log forms; City varies tower width, roof mass and rooftop utilities; Rural Village alternates cottages, barns, hay/tree clusters and rare windmills; Swamp mixes cypress, willow, dead snags and low reed islands; Spires includes single needles, twin towers, gates and pinnacle clusters; Foundry uses furnace halls, tanks, gantries and sawtooth factories; Ruins uses broken arches, columns, collapsed walls and damaged towers.

Platform materials use similarly distinct shape languages while keeping the physical top edge consistent: turf/fieldstone, sandstone strata, snow-capped stone, moss/root seams, concrete expansion joints, timber boards, rot/moss, industrial plate/rivets, dressed stone and irregular masonry respectively.

### Asset scale and placement

Scenery descriptors store **one size scalar**, never independent random width and height. Each motif has a hand-tuned intrinsic aspect ratio and nominal height, so camera zoom, viewport shape and parallax depth can only scale it uniformly. This removes the previous stretching/squashing failure mode. The same uniform zoom scalar is applied to both axes and clamped only at extreme pair-framing zooms.

Within each background chunk, features occupy deterministic jittered slots rather than unconstrained random X positions. Natural biomes allow a little more baseline variation than City/Foundry/Spires/Ruins, while built silhouettes keep tighter foundations. Distant landmarks are rendered behind their ridge/foothill layer so their lower edges are naturally occluded rather than appearing pasted onto the horizon. Rare landmarks are weighted separately (for example Rural Village windmills and Snowy Mountain chalets), and asymmetric motifs may be deterministically mirrored to break repetition without inventing new geometry.

`biome_visual_sanity_check.png` is generated from recorded draw operations from the actual current background renderer and overlays the real current agent sprites at gameplay scale, specifically to check relative landmark size, grounding and readability. `biome_asset_catalog.png` isolates the seven deterministic midground variants beside the same agent reference using aspect-preserving preview fitting. `biome_platform_material_catalog.png` compares normal/branch/merge-moving platform materials. These images are documentation only and are not loaded by the game.

### Asset diversity pass

The procedural landmark layer now uses biome-specific feature-count ranges, weighted variant pools,
and per-biome scale ranges instead of one universal placement grammar. Open biomes can produce empty
landmark chunks, while dense biomes retain more layered scenery.

Rural Village is intentionally sparse: countryside motifs (orchards, hay, hedgerows) are weighted more
heavily than buildings, and its midground no longer guarantees a landmark every 600 world units. The
building vocabulary now includes multiple cottage/farmhouse forms, barn, stable, chapel, and a rare
windmill. Spires, Foundry, Ruins, City, Forest, Desert, Snow, Lowlands, and Swamp also gained genuinely
separate silhouette variants rather than modulo aliases of the same few shapes.


### Ambient background events

The background renderer can schedule rare, deterministic visual events from the world seed and real-time
slot. These events never enter `GameState`, collision, policy sensing, fitness, or terrain generation.
Daytime biomes can receive tiny flying bird groups; selected natural/ruined/city biomes can receive
small ground-animal silhouettes; Forest and Swamp can show firefly clusters around dusk/night; and
sufficiently dark skies can very rarely show a short pixel-art shooting star. Events are world/time
seeded so they animate coherently rather than changing randomly on every frame.
