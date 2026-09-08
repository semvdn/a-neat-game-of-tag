---
name: procedural-terrain
description: Use when editing platform generation, recursive branches, route commitment, merges, moving platforms, respawn on routes, or terrain-related camera/gameplay behavior.
---

# Procedural terrain workflow

## Core invariants

1. Static platforms must satisfy both non-overlap and the configured horizontal/vertical **safety clearance**.
2. Moving platforms must satisfy those same rules for their **full swept motion envelopes**, not merely their starting rectangles or sampled animation frames.
3. Every offered fork choice must be reachable from a stable incoming/staging platform under normal movement/jump physics.
4. Every generated platform is physically landable, including sibling routes and unsensed platforms. Route metadata must never turn geometry intangible.
5. Branch geometry should offer readable first-level choices; a physically possible jump to a nested route remains legal.
6. Landings update descriptive route metadata, and merges restore the parent route label. Labels do not restrict collision or tagging.
7. Vertical branch corridors are hard inherited territory, not placement hints. A nested child must remain inside its parent route corridor; stop recursion early if there is not enough vertical budget for a clean child fork.
8. Commitment platforms, route endpoints and merges should be stationary and visually legible. Use moving platforms on internal route ledges, and keep branch motion horizontal unless deliberately redesigning route identity.
9. Sensing, pursuit distance, tag eligibility, and fair respawn must use the same route-accessibility semantics.
10. Terrain arrays must not be assumed globally sorted once recursive sibling routes/moving platforms exist.

## Generation strategy

Prefer deterministic placement search with bounded fallback over allowing overlap or violating clearance. If a requested moving range is unsafe, reduce the amplitude, make motion one-sided, switch axis where allowed, or leave the platform stationary. Never accept overlap as the fallback.

Treat route geometry as a readability and reachability problem, not just a collision problem. Use bounded platform pitches, conservative first-fork and merge transitions, hard child corridors, and probabilistic/asymmetric recursion so maximum depth does not produce a full binary lattice every time.

Separate route geometry from route accessibility metadata. Geometry alone is not sufficient to enforce commitment because a strong policy may jump across visual gaps.

## Stress verification

For terrain changes, exercise high-density settings such as:

- branch spawn 100%;
- moving spawn 100%;
- maximum recursive depth;
- maximum platforms per route;
- maximum moving speed;
- several incoming platform heights and many deterministic seeds.

Check static and swept overlap/clearance pairs, first-fork gap and upward/downward reachability, direct-route climb/gap limits, merge reachability, minimum fully-diverged route separation, route metadata updates and universal landings, and rolling generation after old platforms are culled. Also animate moving platforms for many real frames and assert that no instantaneous rectangle collisions appear anywhere in their cycles.
