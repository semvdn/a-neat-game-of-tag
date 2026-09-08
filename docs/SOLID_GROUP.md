# Solid Runners and compact pursuit

Revision `solid-group-v12` implements the artwork's group-interaction rules. Both the visible arena and scored episodes use the same terrain step and `resolveRunnerContacts` pass. Scripted midgame starts use that pass too.

## Physical rules

- Runners, including those in tag cooldown, obstruct each other sideways and can land on each other. Swept relative-body contacts prevent crossing between frames.
- A Runner with another Runner standing on its head cannot jump. A blocked jump consumes no stamina and does not consume the jump latch. The upper Runner can jump away; the lower one can move out from under it.
- A Chaser is non-solid. Tagging still swaps roles; losing solid support makes a rider airborne immediately.
- Standing on a body does not establish a terrain checkpoint or bank safe-progress/terrain-landing reward. Actual platform landings remain necessary.
- Platforms remain one-way from below. Every generated surface can catch descending feet, including off-screen platforms, platforms absent from the three policy slots, nested branches and sibling routes. Route labels describe the last landing; they no longer disable collision, tags, sensing or respawn.
- Landing tests use relative platform/body motion and horizontal overlap at the time of impact. The earliest top wins independently of array order. This covers rising moving platforms as well as fast descents onto lower ledges.

Route geometry still obeys clearance, reachability and inherited corridor constraints. The explicit request for universal landings supersedes the former route-lock rule; contributor instructions and the terrain skill now reflect this.

## Learning incentive

`learning/groupCohesion.ts` defines one small, bounded separation penalty. It has a comfortable band, so touching, stacking and standing still earn no extra reward:

| Pair | No cost within | Maximum excess at |
| --- | ---: | ---: |
| Runner–Runner | 300 px | 700 px |
| Chaser–each Runner | 600 px | 1,000 px |

Distance is Euclidean world distance. Excess rises linearly from 0 to 1 between the bounds. The Runner role receives the maximum of teammate separation and farthest Chaser–Runner excess. The Chaser receives only its farthest-Runner excess. Each role's time-integrated penalty is capped at **6 points per episode**, below one 20-point tag/fall. Early termination cannot inflate the cost by dividing by a shorter elapsed duration.

The positive pace bonus is also multiplied by `1 - meanRunnerExcess` over the same two-second window. Safe progress while near the group earns the full existing bonus; progress while widely separated earns less. The shortfall penalty still uses actual safe progress, so standing still cannot satisfy the movement requirement. This redirects the existing pace incentive instead of adding another positive reward. No bonus is awarded for touching or stacking, and no new UI or architecture setting is needed.

The intent is nearby pursuit with room to evade, not a physical tether. Learning does not guarantee that every body always stays on screen. Existing policies need further evolution under the new rules; the camera remains presentation-only and does not chase falling bodies. The controller layout stays 23 world-relative inputs and 3 outputs.

## Evaluation and compatibility

`npm run evaluate -- --seeds 4 --verify` exercises stack jumping, Chaser pass-through, side contacts, role swaps, order independence, 600 sustained-contact frames, 3,000 randomized frames, descending landings, moving surfaces, unseen surfaces and visual/mutable parity. Episode replay also checks seeded determinism. The lab reports Runner separation and full-group diameter alongside catches, falls, pace and traversal.

Analysis history includes `meanRunnerSeparationPx` and `meanGroupDiameterPx`; episode probes expose `groupCohesion` with distances and actual role penalties. Detailed information stays out of the default sidebar. The objective revision refreshes validation for older compatible checkpoints through the existing migration path; old score histories should not be treated as equivalent.

To isolate the learning incentive while retaining identical new physics:

```sh
npm run experiment:train -- --condition baseline --seed 101 --generations 24 --verify --out evaluations/solid-final/baseline-101
npm run experiment:train -- --condition cohesion-penalty --seed 101 --generations 24 --verify --out evaluations/solid-final/cohesion-penalty-101
npm run experiment:compare -- --root evaluations/solid-final --conditions baseline,cohesion-penalty --seeds 101,202,303 --generations 8,16,24 --out evaluations/solid-final-comparison.json
```

Repeat both training commands for seeds 202 and 303 before comparing. `cohesion-penalty` disables pace qualification while retaining the six-point penalty; `cohesion-off` disables both proximity incentives. `cohesion-pace` is an alias for the current baseline, retained for experiment naming. These are isolated laboratory transformations, not UI modes. Fresh output directories are required. All candidates face the same frozen opponent bank and unused scenario seeds; compare individual seeds and traversal as well as separation.

See [the measured results and limitations](experiments/2026-09-08-solid-group.md). In that report, the earlier name `baseline` means penalty-only and `cohesion-pace` means the selected new default.
