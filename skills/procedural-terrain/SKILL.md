---
name: procedural-terrain
description: Use when editing platform generation, recursive branches, route commitment, merges, moving platforms, respawn on routes, or terrain-related camera/gameplay behavior.
---

# Procedural terrain workflow

## Core invariants

1. Static platforms must satisfy both non-overlap and the configured horizontal/vertical **safety clearance**.
2. Moving platforms must satisfy those same rules for their **full swept motion envelopes**, not merely their starting rectangles or sampled animation frames.
3. Every offered fork choice must be reachable from a stable incoming/staging platform under normal movement/jump physics.
4. The first branch landing is the commitment point. Once committed, sibling-route platforms are non-collidable and sibling-route agents are non-taggable until the matching merge.
5. An uncommitted trunk agent may enter only a first-level child, never skip directly to a nested descendant.
6. Nested forks inherit their parent route lock; child merges unlock only that child split, while the outer branch remains committed until its own merge.
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

Check static and swept overlap/clearance pairs, first-fork gap and upward/downward reachability, direct-route climb/gap limits, merge reachability, minimum fully-diverged route separation, nested route lock/unlock behavior, and rolling generation after old platforms are culled. Also animate moving platforms for many real frames and assert that no instantaneous rectangle collisions appear anywhere in their cycles.
