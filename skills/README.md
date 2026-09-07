# Repository agent skills

These skills are project-local workflows for coding agents. Each skill is self-contained and uses the portable Agent Skills `SKILL.md` convention (YAML `name` + `description` frontmatter followed by instructions).

The skills are intentionally narrow so an agent can load only the workflow relevant to the current task:

- `neat-coevolution` — evolution, selection, opponent panels, retention, architecture.
- `procedural-terrain` — branching routes, moving platforms, overlap and reachability invariants.
- `training-diagnostics` — interpreting experiment JSON and choosing evidence-driven changes.
- `ui-telemetry` — keeping controls and telemetry compact, accurate, and actionable.
- `release-git` — checks, actual commits, and reproducible ZIP handoffs with Git history.

Format references used when creating these files:

- https://agentskills.io/
- https://github.com/anthropics/skills
- https://agents.md/
