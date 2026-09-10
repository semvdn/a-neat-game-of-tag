---
name: ui-telemetry
description: Use when editing the sidebar, diagnostics, charts, telemetry labels, status panels, controls, or analysis-facing UI in this A NEAT Game of Tag repository.
---

# UI and telemetry workflow

## Default principle

The main UI is for operating the simulation and noticing meaningful training changes. It should not mirror every field in the diagnostics state.

Keep the default telemetry focused on:

- generation and training throughput;
- Chaser/Runner best fitness and species health;
- clean tag quality;
- Runner pace;
- mean chase distance;
- Chaser fall/escape and Runner fall rates;
- retained champion identity when useful.

Detailed topology, action distributions, architecture settings, checkpoint controls, and full historical data belong in dedicated tabs or exported JSON.

## Live sidebar

For each visible agent, role, current action, stamina, and optional Elo are enough. Do not add all 23 policy inputs or per-frame reward terms to the sidebar. Use the senses overlay to inspect policy inputs and the topology tab to inspect node meaning.

Avoid expensive UI-only telemetry calculations in the render/physics loop if the displayed information has been removed.

## Sanity checks

- Labels must come from authoritative schemas/constants where possible.
- 23 inputs and 3 outputs must remain consistent across topology, docs, checkpoint compatibility, and UI copy.
- A displayed percentage must have a denominator that matches what is visibly represented.
- Disabled controls must look disabled and must not silently queue an impossible action.
- Training-distribution changes must not mix fitness values from different settings in one generation.
- Use Chaser/Runner terminology consistently; `evader` may remain an internal compatibility name but should not leak into normal UI copy.
- Prefer concise hints/tooltips to permanent explanatory paragraphs.
- Preserve accessibility labels/pressed/disabled states.

## Data preservation

Simplifying the UI does not require deleting analysis fields. Prefer hiding/removing visual clutter while retaining detailed checkpoint/analysis export data unless the data itself is obsolete or expensive to compute and has no remaining consumer.
