# Code and decision boundaries

| Layer | Owner | Responsibility |
| --- | --- | --- |
| World rules | `learning/simulationCore.ts`, terrain/respawn helpers | Movement, contacts, falling, respawn, route access, rolling world |
| Sensing | `learning/state.ts` | Authoritative 23 world-relative inputs |
| Control | `learning/agent.ts`, `learning/neat.ts` | Three outputs, independent recurrent contexts, genome evolution |
| Episode accounting | `learning/trainingEpisode.ts`, `learning/encounters.ts` | Seeded starts, outcomes, capped shaping, diagnostic traces |
| Baseline configuration | `learning/pursuitConfig.ts` | Normal pursuit settings shared with the laboratory |
| Population decisions | `workers/trainingWorker.ts` | Common opponent panels, league, validation, retention, checkpoint boundaries |
| Parallel evaluation | `workers/episodeWorker.ts` | Batched calls to the same episode runner |
| Visible world | `App.tsx` | Continuous shared-physics stepping and champion installation |
| Presentation | `components/GameCanvas.tsx`, `components/drawing.ts` | Observational camera and drawing |
| Exhibition lifecycle | `hooks/useExhibitionMode.ts` | Presentation mode, fullscreen shortcut, fading exit controls |
| Offline evaluation | `evaluation/`, `scripts/lab.mjs`, `scripts/*training.mjs`, `scripts/train-experiment.mjs` | Fixed-policy comparisons, actual worker evolution and reproducibility checks |

The episode runner accepts the two controller operations it actually needs: action decoding and state reset. This lets diagnostic fixtures use the real simulation without inheriting genome construction or faking an entire agent class. Production controllers retain their existing API and policy schema.

Held-out validation ranks candidates for retained-champion selection without modifying breeding fitness. The common-panel winner produced by `NeatPopulation.evolve()` remains the generation benchmark/archive champion. The old artificial fitness promotion and permanently disabled alternative retention gates have been removed. Historical flag names remain as descriptive export metadata for analysis compatibility, not selectable runtime paths.

`EncounterTracker` owns pressure hysteresis. Enter within the configured near threshold; exit beyond the far threshold. A tag or any registered fall interrupts the encounter without an evade. New pressure after recovery can start a new encounter. Episode code applies the existing window and episode reward caps once, removing duplicated distance/route accounting.

Successful-evade telemetry now means a pressure exit with no intervening tag or registered fall by either role. `clean-encounters-v10` marks the changed objective in checkpoints and analysis exports. Older current-schema checkpoints still load through the existing objective-migration path, which refreshes score-dependent validation; their historical reward values should not be compared as if semantics were identical. Physics and the 23/3 controller schema did not change.

## Working on the project

Landing detection sweeps the feet to the platform top and checks horizontal overlap at impact. It chooses the earliest physical surface independently of platform array order. Grazing edge contacts finish at impact; ordinary landings preserve horizontal travel. Revision `solid-group-v12` also sweeps moving surfaces relative to the body, makes every route physically landable, and refreshes checkpoint validation through the existing objective-migration path. Upward passage through platforms remains one-way. `bodyContacts.ts` resolves solid Runner pairs after terrain steps; `groupCohesion.ts` defines world-distance bands used by bounded episode fitness. See [solid-group rules](SOLID_GROUP.md).

Read `AGENTS.md` and the relevant `skills/` entry. Trace both visible and headless paths for gameplay changes. Keep reproduction fitness, held-out validation, retained champions, and presentation curation separate. Move code when it isolates a real responsibility; avoid broad rewrites of the worker while changing learning behavior.

Validation commands:

```sh
npx tsc -p tsconfig.check.json --noEmit
npm run build
npm run evaluate -- --seeds 8 --verify
git diff --check
```

The build can succeed while external CSS is unavailable at runtime. Check the browser as well. For simulation/terrain edits, add focused invariant checks beyond the episode lab. Commit intended changes explicitly; preserve unrelated working-tree files.

## Deterministic biome field

The infinite world has a deterministic, stateless biome field driven by world X and `GameState.worldSeed`. Visual RNG is namespaced away from terrain/training RNG, and the 23-input policy interface contains no biome identity.

Macro-regions are 12,000 world pixels with 5,000-pixel boundary-centered transitions. The field origin is shifted by half a transition so world X=0 begins in the stable Lowlands core rather than on a biome seam. Each handoff spans 2,500 px on either side of the region boundary using quintic easing, leaving a long stable biome core while making palette, scenery density, motif choice and terrain mechanics continuous. Lowlands remains the gentle starting region; the other nine biomes are deterministically shuffled per world seed. Backgrounds use banded pixel skies plus far/mid/near parallax layers generated from small descriptor chunks under a 96-chunk LRU cap. Moving platforms capture a visual-biome stamp when first exposed to the visible world so their material does not change as they oscillate.

Mechanical biome profiles are now active in the terrain proposal layer. Width, gap, verticality, route persistence, branch likelihood/nesting, and moving-platform frequency/speed are blended through the same transition field. The existing overlap, swept-clearance, route-corridor and jump-reachability rules remain authoritative, so biome code cannot bypass terrain safety. A multi-platform branch captures the profile at its root and keeps it for the full structure.

Training uses a deterministic seed-derived biome-world offset to distribute episodes across all ten mechanical biomes without exposing biome identity to the policy. Visible continuous play leaves the offset at zero so visual and mechanical geography are aligned. Cached training terrain keys include this offset.

The crumble multiplier remains dormant until a real crumble mechanic and observable crumble state are implemented.


## Day/night presentation clock

The visible arena has a presentation-only world clock in `world/dayNight.ts`. It does not alter physics, policy inputs, fitness or terrain generation. `InfoPanel` exposes two persisted modes:

- **Real time** follows the browser/device local clock.
- **Custom cycle** maps a user-selected 1–1,440 real-minute period onto a full 24-hour world day. Switching into custom mode or changing its period re-anchors at the currently visible hour so the sky never jumps.

`GameCanvas` refreshes lighting while the champion simulation is paused, so real-time mode still advances. Background sky bands, sun/moon/stars, parallax scenery, ambient details and platform materials receive the same smooth lighting state. Agent sprites and tag effects are deliberately not darkened, preserving gameplay readability at night.
