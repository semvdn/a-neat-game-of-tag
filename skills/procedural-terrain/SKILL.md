---
name: procedural-terrain
description: Use when editing platform generation, recursive branches, route commitment, merges, moving platforms, respawn on routes, or terrain-related camera/gameplay behavior.
---

# Procedural terrain workflow

## Core invariants

1. No static platform rectangles overlap.
2. Moving platforms must also have non-overlapping **full swept motion envelopes**, not merely non-overlapping start positions.
3. Every offered fork choice must be reachable from the incoming platform under normal movement/jump physics.
4. The first branch landing is the commitment point. Once committed, sibling-route platforms are non-collidable and sibling-route agents are non-taggable until the matching merge.
5. An uncommitted trunk agent may enter only a first-level child, never skip directly to a nested descendant.
6. Nested forks inherit their parent route lock; child merges unlock only that child split, while the outer branch remains committed until its own merge.
7. Branch corridors should visually separate after a reachable transition ramp and stay separated until the merge.
8. Moving branch platforms should not erase route identity; keep branch motion horizontal unless deliberately redesigning the route layout.
9. Sensing, pursuit distance, tag eligibility, and fair respawn must use the same route-accessibility semantics.
10. Terrain arrays must not be assumed globally sorted once recursive sibling routes/moving platforms exist.

## Generation strategy

Prefer deterministic placement search with bounded fallback over allowing overlap. If a requested moving range is unsafe, reduce the amplitude, make motion one-sided, switch axis where allowed, or leave the platform stationary. Never accept overlap as the fallback.

For branches, separate route geometry from route accessibility metadata. Geometry alone is not sufficient to enforce commitment because a strong policy may jump across visual gaps.

## Stress verification

For terrain changes, exercise high-density settings such as:

- branch spawn 100%;
- moving spawn 100%;
- maximum recursive depth;
- maximum platforms per route;
- maximum moving speed;
- several incoming platform heights and many deterministic seeds.

Check static and swept overlap pairs, first-fork upward/downward reachability, minimum fully-diverged route separation, nested route lock/unlock behavior, and rolling generation after old platforms are culled.
