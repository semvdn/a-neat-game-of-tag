# Coding-agent instructions for NEAT Tag Agents

## Project goal

This repository evolves Chaser and Runner NEAT policies for an infinite platforming game of tag. The visible champion arena and headless training must stay behaviorally aligned. The main objective is interesting, robust pursuit and evasion across procedural terrain without reward exploits, camera-dependent policy behavior, or brittle one-off champion selection.

Read `README.md` before substantial changes. For recurring task-specific workflows, read the relevant file under `skills/*/SKILL.md` before editing.

## Non-negotiable invariants

1. **Training/visual parity.** Gameplay physics, tagging, falling, respawn, route accessibility, moving platforms, and escape semantics should live in shared code (`learning/simulationCore.ts`, `learning/trainingEpisode.ts`, terrain helpers) whenever possible. Do not quietly create a training-only or visual-only rule.
2. **Camera is presentation-only.** Policy state is 23 world-relative inputs and 3 outputs. Do not add camera position/zoom back into policy sensing. If the state or output schema changes, update compatibility/version checks, diagnostics labels, README, checkpoints, and analysis exports together.
3. **Deterministic evaluation.** Candidate genomes compared in the same panel must receive the same seeded starts/terrain/opponents. Avoid `Math.random()` inside headless evaluation paths unless it is explicitly replaced by the seeded RNG there.
4. **Terrain must be fair and readable.** Platforms must satisfy both non-overlap and safety-clearance rules across the full swept motion envelope of every moving platform. Fork choices must be reachable from stable commitment ledges, nested geometry must remain inside hard inherited vertical corridors, recursion must stop when a corridor cannot safely support another split, branch routes must remain mutually exclusive after commitment, and explicit merges must restore accessibility correctly.
5. **Competitive events dominate fitness.** Tags, falls, and Chaser escape failures are the core outcomes. Shaping must remain capped and substantially smaller. Avoid reward stacking, proxy exploits, or adding a positive reward to the opponent for a personal fall unless intentionally redesigned and tested.
6. **Route-aware pursuit.** Tagging, pursuit distance, sensing, and respawn must respect route accessibility. Never reward a Chaser for being physically close to a Runner on an inaccessible sibling route.
7. **Telemetry should answer decisions, not expose every field.** Keep the default UI compact. Preserve detailed data in analysis exports or specialist diagnostics instead of adding every metric to the main panel.
8. **Do not follow falling agents with the presentation camera.** The camera should frame active chase participants and hold stable when all relevant bodies are falling.

## Repository map

- `App.tsx` — visible champion simulation, UI state, worker orchestration.
- `learning/simulationCore.ts` — shared gameplay rules and rolling terrain behavior.
- `learning/trainingEpisode.ts` — scored headless episode execution.
- `learning/terrainRoutes.ts` / `learning/terrainConfig.ts` — route locking and terrain configuration.
- `learning/state.ts` — authoritative 23-input policy state schema.
- `learning/agent.ts` — policy wrapper and action decoding.
- `learning/neat.ts` — NEAT networks, mutation, speciation, architecture configuration.
- `workers/trainingWorker.ts` — population evaluation, opponent league, Hall of Fame, retention, telemetry/export.
- `workers/episodeWorker.ts` — batched parallel episode evaluation.
- `components/GameCanvas.tsx` / `components/drawing.ts` — presentation camera and senses rendering.
- `components/InfoPanel.tsx` — compact live controls/status.
- `components/PerformanceDiagnostics.tsx` — diagnostics, architecture tools, checkpoint/run management.

## Change workflow

1. Inspect `git status`, recent `git log`, and the exact source files before making claims or edits.
2. Make the smallest coherent change that satisfies the request. Reuse shared simulation helpers rather than duplicating rules.
3. For behavior changes, trace both the visual path and the headless-training path. Update diagnostics/export semantics when the meaning of a metric changes.
4. Run at least:
   - `tsc -p tsconfig.check.json --noEmit`
   - `git diff --check`
5. If dependencies are installed, also run `npm run build`. Do not claim the production build passed if dependencies/network prevented it.
6. For terrain or simulation changes, add/run a focused deterministic stress check. Temporary test scripts are fine, but remove scratch files before shipping unless they are intentionally useful repo tests.
7. Review `git diff` for stale terminology/schema numbers and accidental generated files.
8. **Create a real Git commit.** A commit-message text file is not a substitute for `git commit`.

## Git and packaging contract

Every delivered ZIP must contain the updated repository history.

- Commit all intended source/docs changes before packaging.
- Keep `.git` in the archive.
- Exclude `node_modules`, `dist`, caches, and temporary scratch output.
- After creating the ZIP, extract it to a clean temporary directory and verify:
  - `git log -1 --oneline` shows the new commit as `HEAD`;
  - `git status --porcelain` is empty;
  - `git fsck --no-reflogs` succeeds;
  - the ZIP integrity test succeeds.
- Report the actual commit hash and subject in the handoff.

## Telemetry/UI discipline

The default UI should emphasize only metrics that change a training decision: generation/throughput, best fitness, species health, clean tag quality, Runner pace, chase distance, and failure rates. Detailed action distributions, topology, architecture, checkpoint operations, and raw analysis belong in dedicated tabs/exports. Do not reintroduce per-frame reward breakdowns or all 23 input bars into the sidebar; the senses overlay and topology view cover those debugging needs more appropriately.

## Skill index

- `skills/neat-coevolution/SKILL.md` — NEAT/co-evolution changes and selection/retention safeguards.
- `skills/procedural-terrain/SKILL.md` — branches, moving platforms, overlap/reachability/route invariants.
- `skills/training-diagnostics/SKILL.md` — experiment-report analysis and deciding what to change next.
- `skills/ui-telemetry/SKILL.md` — compact telemetry and UI-control sanity checks.
- `skills/release-git/SKILL.md` — validation, real commits, and ZIP handoff verification.

## Instruction/skill format references

This repo uses `AGENTS.md` because it is the cross-agent repository-instruction convention documented at https://agents.md/. Skills follow the portable Agent Skills pattern: one folder per skill with a `SKILL.md` containing YAML `name` and `description` frontmatter, based on https://agentskills.io/ and the public examples at https://github.com/anthropics/skills.
