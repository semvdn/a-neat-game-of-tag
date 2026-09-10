# World and platform generation

The world generator has one job beyond creating variety: it must keep producing an **infinite, readable and physically valid platform world** while the agents move through it. The visible arena and headless training use the same terrain and collision code, so a behavior learned during training is evaluated against the same movement rules shown in the demo.

The main implementation lives in `learning/simulationCore.ts`, with terrain-mode configuration in `learning/terrainConfig.ts` and biome profiles in `world/biomes.ts`.

## Rolling infinite world

The level is not generated all at once. `maintainPlatformsForCameraInPlace()` keeps a rolling window of platforms around the camera **and around the agents themselves**. It generates new terrain ahead of the rightmost relevant body, can extend terrain behind a lagging body, and discards distant platforms only when they are no longer needed.

Two details prevent the rolling world from breaking gameplay:

- the platform currently supporting an agent is protected from removal;
- if any part of a branch structure is still relevant, the complete root branch tree is retained until the group has passed it.

This solves a common endless-level problem: camera-based culling must never delete the terrain underneath an off-screen or lagging agent.

## Trunk generation

Ordinary terrain is generated as a constrained random walk. For each new trunk platform the generator proposes:

1. a vertical change: mostly near-level travel, with occasional climbs and descents;
2. a horizontal gap;
3. a landing width;
4. optionally, a moving-platform motion envelope.

The proposal is then corrected by global constraints. Large upward jumps shorten the permitted gap, difficult elevation changes receive somewhat wider landing targets, and the vertical walk reflects away from the top and bottom of the playable band rather than accumulating against an edge.

The important design choice is that **randomness proposes terrain; it does not get the final say**. Safety and reachability rules remain authoritative after the random choice.

## Branches and route commitment

Branch structures create explicit route choices. A branch starts from a stable entry platform, splits into upper and lower routes, and later rejoins at a merge platform. Routes can recursively contain sub-branches up to the configured depth.

Each route is built inside a vertical corridor. Platform placement first searches within the intended slot and lane, then narrows a platform if a dense recursive structure needs more room, and only as a final fallback moves the platform farther horizontally. This preserves the visual meaning of "upper" and "lower" routes instead of solving collisions by moving a platform into the other lane.

Nested branches inherit route paths such as `g12U/g18L`. These paths are useful for terrain structure, sensing and diagnostics, but **they are not collision permissions**. Every generated platform is physically solid and landable. Geometry determines access.

Recursive forks can leave one sibling route farther ahead than the other. The generator therefore adds stationary **alignment ledges** to the lagging route in ordinary jump-sized steps before the parent route continues. Without this correction, a route returning from a nested fork could inherit the other sibling's horizontal lead as one oversized catch-up jump.

The shared merge is then constrained from both approaches. Its height is limited so that rejoining does not secretly create the hardest upward jump in the branch, and its horizontal position is capped by a conservative jump envelope derived from the actual gravity, jump impulse and base movement speed. Both sibling endpoints must be able to bridge the final gap; the farther sibling is not allowed to determine a merge that the lagging sibling cannot reach.

This branch system is solving two competing problems: giving the agents meaningful route decisions while ensuring procedural recursion cannot accidentally create impossible or visually ambiguous terrain.

## Moving platforms

Moving platforms are generated from the same stationary candidates and receive bounded oscillation along X or Y. Branch-route movers are restricted to horizontal motion so the route keeps a stable upper/lower identity.

Before motion is accepted, the generator computes the platform's **full swept envelope**—the region it can occupy over its complete oscillation. If that envelope conflicts with another platform, it progressively tries a smaller or one-sided motion range. If no safe motion exists, the candidate remains stationary.

At runtime `stepMovingPlatformsInPlace()` updates the platform before policy decisions. Grounded agents are carried with their support, and vertically moving platforms snap an existing rider back to the known top surface to avoid floating-point drift through the one-way collision boundary.

The design principle is that a moving platform must be safe for its **entire trajectory**, not merely at its spawn position.

## Clearance and landing invariants

Platform generation uses a stronger invariant than rectangle non-overlap. If horizontal ranges overlap, platforms need enough vertical breathing room; platforms on a similar vertical band need a visible horizontal gap. Moving platforms are checked using their full sweep envelopes.

Landing detection is swept through the frame rather than testing only the body's final position. The physics finds when descending feet cross a platform top, checks horizontal overlap at that impact time, and chooses the earliest physical surface independently of array order. Upward movement can still pass through the one-way platforms.

Runners are additionally solid with respect to one another: they can obstruct sideways movement and stand on each other. Chasers remain non-solid to bodies. Standing on another Runner is intentionally not treated as a terrain checkpoint or safe-progress landing.

Together these rules prevent several procedural-simulation failure modes: tunnelling through thin surfaces, falling through vertically moving platforms, array-order-dependent landings, overlapping generated platforms, and route labels accidentally disabling real geometry.

## Biomes as proposal distributions

The world contains ten mechanical/visual biomes: Lowlands, Spires, Foundry, Ruins, Desert, Snowy Mountains, Temperate Forest, City, Rural Village and Swamp.

Biome identity is a deterministic function of world X and the world seed. Macro-regions are 12,000 world pixels long, with a 5,000-pixel transition centered on each boundary. A quintic smootherstep blends both visual palettes and mechanical terrain parameters through the transition.

A biome changes the **distribution of proposals**, not the safety rules. Profiles can bias:

- platform width;
- vertical variation;
- gap size;
- branch frequency;
- moving-platform frequency and speed;
- route persistence.

For example, Snowy Mountains biases toward narrower, more vertical and more frequently branching terrain, while Rural Village biases toward wider, flatter and more persistent routes. The same global clearance and reachability checks still validate the resulting candidates.

Training derives a deterministic biome-world offset from the episode seed so episodes are distributed across the complete biome cycle without adding biome identity to the policy inputs. Visible continuous play uses offset zero so visual and mechanical geography stay aligned.

## Determinism

Terrain generation is seed-driven and kept separate from presentation randomness. That is essential for evolutionary comparison: two candidate policies can be evaluated on the same terrain and start conditions instead of receiving different difficulty by chance.

The renderer adds scenery, lighting and ambient events on top of the mechanical world, but those systems do not enter `GameState`, policy sensing, collision or fitness. The distinction keeps the demo visually rich without allowing presentation state to become a hidden training variable.

## Key files

| Component | Responsibility |
| --- | --- |
| `learning/simulationCore.ts` | platform generation, branches, moving platforms, landing physics, rolling terrain |
| `learning/terrainConfig.ts` | training vs. continuous terrain frequencies and curriculum exposure |
| `learning/terrainRoutes.ts` | route metadata; all generated surfaces remain physically usable |
| `world/biomes.ts` | deterministic biome field and mechanical profile blending |
| `learning/bodyContacts.ts` | solid Runner-to-Runner contacts |
| `learning/respawn.ts` | fair world-space respawn after falls |
