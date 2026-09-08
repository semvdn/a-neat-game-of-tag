# Reproducible evolutionary experiments

The current `solid-group-v12` source also supports `cohesion-penalty` (disable pace qualification) and `cohesion-off` (disable both proximity incentives), preserving solid Runner bodies and universal surfaces. See [the solid-group experiment](SOLID_GROUP.md). These conditions do not apply to the historical revision below.

Read the [measured selection, pace, and architecture results](experiments/2026-09-08-training.md) before changing defaults.

`evaluate` measures fixed policies. `experiment:train` actually evolves both populations using the production training worker, including its opponent league, speciation, held-out validation, retention, and archive. It does not implement a second evolutionary loop.

```sh
npm run experiment:train -- --seed 101 --generations 24 --verify --out evaluations/my-run
```

The Node host uses the worker's existing single-worker CPU fallback, seeds initialization and reproduction, and observes complete checkpoint boundaries. Browser evaluator workers are not simulated. It saves analysis history and checkpoints every four generations and at the requested final generation. `--verify` asserts that held-out validation never alters any genome's breeding fitness in the current implementation.

Reports include the source revision, explicit experimental source transformations, and the compiled worker's SHA-256. Bundles and checkpoints remain in the output directory, which must not already contain checkpoints. Wall-clock telemetry and timestamps are not reproducible measurements. Compare genomes and behavioral outcomes instead. Exact replay assumes the same JavaScript runtime.

## Reproduce the pre-change comparison

Use the pinned source revision so `baseline` means the original setup rather than whatever is currently checked out:

```sh
npm run experiment:train -- --ref 163f7ad --condition baseline --seed 101 --generations 24 --out evaluations/repeat/baseline-101
npm run experiment:train -- --ref 163f7ad --condition separate-validation --seed 101 --generations 24 --out evaluations/repeat/separate-validation-101
```

Repeat with seeds 202 and 303. Available experimental conditions are:

| Condition | Difference from the pinned source |
| --- | --- |
| `baseline` | No training changes |
| `separate-validation` | Remove the held-out winner's artificial breeding-fitness promotion |
| `pace3` | Runner pace reward 3 instead of 15 per two-second window |
| `compact` | Complete Compact 12 architecture preset for both roles |
| `separate-pace8` | Separate validation plus intermediate pace reward 8 |
| `compact-chaser` | Separate validation plus Compact 12 only for the Chaser |

These are laboratory transformations, not additional runtime flags or UI modes. A transformation fails when its expected source no longer matches. Use the pinned revision to replay a historical condition; use `baseline` without `--ref` to test current source. `--verify` targets the corrected current validation function and is not supported on the old source.

The architecture experiments change the complete existing preset, including mutation settings and recurrence permission. They are practical preset comparisons, not a causal isolation of hidden-node count. Different architectures consume different numbers of initialization random draws, so a shared seed does not imply identical initial Runner genomes after changing the Chaser architecture.

## Compare retained policies

```sh
npm run experiment:compare -- --root evaluations/repeat --conditions baseline,separate-validation --seeds 101,202,303 --generations 8,16,24 --out evaluations/comparison.json
```

Directory names must be `condition-seed`. Every candidate faces the same frozen bank of final retained opponents from all included runs, with six start classes and three unused scenario seeds by default. Earlier retained champions face that same bank so early/middle/late results are comparable. Comparison uses normal physics/terrain with abilities off; the bundled experiments all use these same physical settings.

The panel contains evolved opponents, some previously encountered in training. Only the scenario seeds are held out; do not call this an entirely held-out opponent test. The report names and hashes the panel and retains per-start summaries. Changing the included runs changes the bank, so absolute numbers from separate reports are not directly comparable.

For Chasers, more clean tags is favorable. For Runners, the same `cleanTags` metric counts catches conceded. Runner own-fall counts cover both Runner slots. Read catches, falls, pace, route traversal, chase distance, and escape incidence together. More contacts caused by stationary Runners are not automatically better gameplay.

Three initialization seeds and a few dozen generations can screen changes, not establish long-run convergence. Report individual seeds, trajectories, and tradeoffs; avoid ranking everything by an invented aesthetic score. Reward experiments require retraining, and presets should survive longer training and live observation before replacing a default.
