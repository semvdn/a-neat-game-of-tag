---
name: neat-coevolution
description: Use when changing NEAT evolution, opponent sampling, species management, champion retention, network architecture, fitness aggregation, or role co-evolution in this A NEAT Game of Tag repository.
---

# NEAT co-evolution workflow

## Start by locating the decision boundary

Identify whether the requested change affects raw episode fitness, robust population aggregation, species reproduction, Hall-of-Fame opponent selection, fixed-benchmark validation, retained generalist selection, or showcase selection. These are deliberately separate layers; do not mix them casually.

Primary files are `learning/neat.ts`, `workers/trainingWorker.ts`, `learning/trainingEpisode.ts`, and `types.ts`.

## Preserve these design constraints

- Chaser and Runner are separate populations but are evaluated on common seeded panels.
- Population breeding should respond to robust current/league performance, not the frozen benchmark alone.
- Retained champions may use stronger held-out evidence than breeding selection.
- Elite seeds must be re-evaluated normally and must not receive artificial inherited fitness.
- Avoid a hard pass/fail gate when a smooth score can preserve partial progress.
- Keep event rewards dominant over shaping.
- Check for delayed-tag, stationary-survival, endless-right-running, respawn, branch-shadowing, and fall/escape double-count exploits.

## When changing architecture

The authoritative policy interface is 23 inputs and 3 outputs. Recurrent links are one-step memory state, not feed-forward cycles. If architecture or schema compatibility changes, update checkpoint validation, analysis schema metadata, topology UI labels, README, and any fixed benchmark assumptions.

## Verification

Compare at least these signals before deciding a change helped:

- clean tags/episode and mean chase distance;
- Chaser fall and escape rates;
- Runner pace completion and fall rate;
- Runner/Chaser platform and branch traversal when terrain variety matters;
- fixed benchmark versus contemporary performance;
- whether a strong retained champion persists or appears briefly and disappears;
- species count/stagnation and topology growth for search-health regressions.

Do not optimize one final-generation scalar in isolation. Co-evolution can hide regressions behind a temporarily weak opponent population.
