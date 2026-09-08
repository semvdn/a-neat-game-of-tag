# Solid-group experiment

## Decision

Adopt solid Runner contacts, universal platform landings, a small world-distance separation penalty, and cohesion-qualified pace reward. The small penalty alone did not reliably bring the Runners together. Qualifying the existing positive pace bonus did, across all three initialization seeds. This is an intentional tradeoff toward compact interaction and slower traversal, matching the requested artwork direction; it is not a universal competitive-performance improvement.

## Design and method

Nine full production-worker runs tested three conditions with seeds 101, 202 and 303, 24 generations each: **216 generations and 121,824 population/league episodes**, excluding additional validation/retention work. Preliminary eight-generation runs and short verification replays are not counted here.

- `cohesion-off`: solid bodies and universal surfaces, with original pace reward and no proximity penalty.
- Historical `baseline`: the same physics plus a maximum six-point separation penalty per role per episode.
- `cohesion-pace`: additionally multiply the existing positive pace bonus by mean cohesion over the same two-second window. This became the production default; the old baseline is now available as `cohesion-penalty` in the harness.

All use the existing Memory Discovery networks and 48 genomes per role. The final comparison evaluates retained checkpoints at generations 8, 16 and 24 against the same nine final opponent pairs, six start classes and three unused scenario seeds: **8,748 evaluation episodes**. Opponents include policies seen during training; only scenario seeds are held out. See [numerical evidence and provenance](2026-09-08-solid-results.json). The separate [penalty-only comparison](2026-09-08-solid-penalty.json) uses a different opponent bank; do not compare its absolute values directly with this table.

The common-panel evaluation uses the final contact-edge guard. Training preceded that last guard, which prevents corrected contacts from retaining a ghost grounded state at an unreached ledge. Worker bundle hashes record the exact experimental source. A four-generation replay with the guard retained the same champions/archive as its experimental counterpart, with a small numerical difference in Chaser species fitness; this is not claimed as full pre/post-fix population identity. Final production replay separately checks the selected reward implementation against the guarded experimental implementation.

## Final retained Runner results

Means across three initialization seeds. Counts are per episode and cover both Runner slots. Each Runner policy faces the same Chaser bank, rather than only its own co-evolved Chaser. Distances are Euclidean world pixels.

| Condition | Runner separation | Group diameter | Pace completion | Platform landings | Runner falls | Clean catches conceded |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No cohesion | 555 | 1,044 | 80.2% | 7.97 | 3.99 | 0.093 |
| Penalty only | 587 | 1,074 | 90.6% | 8.74 | 2.40 | 0.152 |
| Cohesion-qualified pace | **264** | **519** | 43.3% | 1.79 | 1.79 | 0.728 |

Against penalty-only, the selected condition reduces mean Runner separation by 55% and group diameter by 52%. Runner falls decrease 26% on average; time within 200 px of a Chaser increases from 16.7% to 32.1%. However, traversal decreases substantially. These are closer, slower encounters, not equally fast policies with a free cohesion improvement.

| Seed | Penalty-only separation | Selected separation | Selected pace | Selected landings |
| --- | ---: | ---: | ---: | ---: |
| 101 | 597 | 257 | 58.5% | 3.43 |
| 202 | 651 | 230 | 32.1% | 0.92 |
| 303 | 513 | 305 | 39.3% | 1.02 |

The direction of the separation change is consistent across seeds. Mobility varies considerably; seed 202 needs particular scrutiny for long periods of local behavior. Seed 303's falls increase despite the aggregate reduction. Earlier checkpoints remain in the numerical evidence: the selected mean Runner separation moves from 397 px at generation 8 to 371 at 16 and 264 at 24.

Chaser tests are separate: selected Chasers average 0.399 clean tags and 0.078 own falls per episode, versus 0.331 and 0.251 for penalty-only. Their mean nearest-Runner distance is worse (570 versus 448 px), so improved compactness in Runner tests must not be presented as a universal Chaser pursuit gain.

## Verification and limitations

Focused checks cover lower-Runner jump blocking, upper-Runner jumping, non-solid Chasers, role swaps invalidating support, head impacts, moving stacks, symmetric contacts, contact-edge grounding, 600 sustained-contact frames and 3,000 randomized frames without penetration. Landing checks include 720 descending crossings, moving surfaces, nested sibling routes and off-screen surfaces, with visible/mutable physics parity. The episode lab checks deterministic replay and reward bounds. TypeScript and production build are required before committing.

No policy inputs, outputs or camera-dependent rewards were added. Old compatible checkpoints refresh validation under `solid-group-v12`; existing policies still need further training. The experiment supports a compactness improvement under these tests, not a guarantee that every agent always stays visible or that all remaining falls are collision bugs. Twenty-four generations and three seeds do not establish long-run convergence or unattended exhibition quality.

For current reproduction commands and exact physical/reward rules, see [solid-group documentation](../SOLID_GROUP.md). Experimental policies were not installed over the user's saved champions.
