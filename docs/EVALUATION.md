# Gameplay laboratory

The command-line lab runs `learning/trainingEpisode.ts` directly. It bundles the actual TypeScript sources for Node using the esbuild already installed with Vite; it does not maintain another simulator or depend on a browser worker shim.

```sh
npm install
npm run evaluate -- --seeds 32 --verify
npm run evaluate -- --checkpoint path/to/checkpoint.json --conditions evaluation/conditions.example.json --seeds 32 --trace --out evaluations/champions.json
```

`--help` lists options. Reports and temporary bundles live in ignored `evaluations/` and `.evaluation-cache/` directories. Preserve a report elsewhere when it is experiment evidence worth committing.

## What is compared

Each condition receives the same pair identities and the same seeds across visual, varied, close, normal, long, and midgame starts. Default controls are explicitly **untrained scripted fixtures**: traversal/pursuit, camping, and running without jumping. Their purpose is to expose mechanics and reward exploits, not to stand in for learned champions.

A full exported checkpoint replaces fixtures with its saved champion pair. The lab checks the 23-input state and three-output action schema and carries over saved physics, terrain, abilities, and fitness settings. Supply exported full checkpoints (or their inner `evolutionCheckpoint` object), not analysis exports or old policy files. Configuration overrides apply to the saved baseline. The lab evaluates policies; it does not run the worker's evolutionary selection, league, or retention loop.

The first condition is the comparison baseline. A conditions JSON is an array of unique named objects with optional `terrainConfig`, `pursuitDesign`, `upgrades`, and `fitness` overrides. See `conditions.example.json`, `types.ts`, and `pursuitConfig.ts`. Change one mechanism per condition. Physics overrides in a lab report do not change normal app settings.

## Reading the report

The JSON includes source revision and dirty status, effective baseline settings, condition overrides, individual episode rows, overall means, per-start means, and paired differences from the first condition. Pair/start/seed identify each row. Archive the exact source commit with reports: a dirty marker cannot reconstruct a patch.

Metrics include clean tags (all tags minus tags attributed to recent Runner falls), successful evades, both roles' falls, escape incidence, pace completion, reachable chase distance, fraction of elapsed time within 200 px, platform landings, and branch landings. These are episode averages; Runner falls cover both Runner slots. Escape episodes can end early, so compare duration as well as event counts. The distance metric retains the simulation's zero fallback when no reachable distance samples exist; consult traces and escape/route signals before interpreting zero as a perfect chase.

Paired differences include a **standard error across seed clusters**: each seed's starts and policy pairs are averaged before uncertainty is estimated. This is not a confidence interval, does not measure training-seed variability, and is null with a single seed. Small effects and one lucky policy pairing are insufficient grounds to change defaults.

`--trace` records body positions, roles, actions, cooldowns, energy, support IDs, and accumulated events at 250 ms intervals. Compare rows with the same seed and start to diagnose whether a tag followed pursuit or a respawn. Traces are sampled diagnostics, not pixel-perfect visual replays.

`--verify` checks encounter and landing regressions (including 720 downward crossings and visible/training parity), disallows `Math.random()` during headless evaluation, and runs every episode twice with deep equality checks, including traces when requested. It exercises cached midgame starts and recurrent-state reset when evaluating recurrent checkpoints.

## Experiment protocol

1. Save trained checkpoints from several independent runs and from early, middle, and late generations. Keep the ordinary training baseline as a control.
2. Compare one change at a time on identical checkpoint pairs and seeds. Inspect per-start failures and traces rather than only overall means.
3. For changes to rewards or selection, retrain from multiple fresh populations in the app. Fixed-policy evaluation can show how scoring changed; it cannot show what evolution will learn.
4. Validate against unused opponents and seeds. Track retained performance, species health, and topology growth through analysis exports.
5. Watch continuous exhibition playback. Reject gains based on fall loops, camping, unreachable sibling pursuit, or a repetitive single trick.

See [the initial experiment report](experiments/2026-09-08.md) for measured results and limitations.
