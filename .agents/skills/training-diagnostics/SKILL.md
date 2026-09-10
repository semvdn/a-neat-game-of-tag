---
name: training-diagnostics
description: Use when analyzing exported A NEAT Game of Tag experiment/analysis JSON, diagnosing learned behavior, comparing experiment conditions, or deciding the next training-system change.
---

# Training diagnostics workflow

## Read trajectories, not just winners

Compare early, middle, and late generations. A useful behavior that appears briefly and disappears is different from behavior that was never discovered. Distinguish population-level performance from retained champion/showcase performance.

## Essential metrics

Prioritize:

- clean tags per episode;
- mean nearest reachable Runner distance and time within useful pursuit ranges;
- Chaser fall and camera-envelope escape rates;
- Runner pace completion and Runner fall rate;
- platform/branch landings for both roles when testing terrain traversal;
- fixed benchmark vs contemporary performance;
- retained champion generation and soft pursuit score;
- species count/stagnation when learning suddenly collapses.

Use action shares only to explain a behavioral pattern, not as the main success metric.

## Common failure interpretations

- **High survival + low pace/platforming:** Runner has found stationary or local-dodge behavior.
- **Good Runner pace + exploding chase distance:** Chaser pursuit selection is too weak or forgetting previously discovered pursuit.
- **High tags + high Runner falls / tags-after-fall:** apparent Chaser skill may be mostly platform failure exploitation.
- **Strong retained Chaser + weak population:** preservation/league dynamics may be failing even if the capability exists.
- **Low falls + low tags + low encounters:** agents may be avoiding interaction rather than mastering it.
- **High escape rate:** Chaser is losing the chase entirely; inspect whether terrain routes make recovery impossible or whether the threshold is being exploited.

## Experiment discipline

Change one conceptual mechanism at a time when possible. Keep physics and evaluation seeds comparable. Prefer smooth retention/evidence scores over brittle gates. Before adding new reward shaping, ask whether selection, opponent sampling, start-state diversity, or retention can solve the issue without changing the objective.

When producing a recommendation, state what evidence supports it and what metric in the next report would falsify it.
