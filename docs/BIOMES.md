# Visual biomes

Biomes are currently presentation-only. `TERRAIN_BIOME_PROFILES` stays neutral and is the only table read by the terrain hook. The values below are recorded separately in `PLANNED_TERRAIN_BIOME_PROFILES` as future design targets; enabling them will be a later, explicit mechanical change with biome-balanced training/evaluation.

| Biome | Visual identity | Planned terrain identity (inactive) |
| --- | --- | --- |
| Desert | Dusk/amber banded sky, pixel sun, mesas, eroded rock, sparse cacti, sandstone platforms and wind-streak accents | Wider/flatter routes, somewhat larger gaps, fewer moving platforms and branches, moderately fragile terrain, strong route persistence |
| Snowy Mountains | Cold blue sky, pixel moon, layered sharp peaks with snow caps, firs/cabins, snow-capped platforms and sparse flakes | Narrower platforms, highest vertical variation, strong branching, modest movers, slightly tighter gaps, lower route persistence |
| Temperate Forest | Deep green layered canopy, broadleaf trunks/crowns, leaf motes, moss/grass platform edges | Near-baseline geometry with substantially more route branching, slightly tighter gaps, fewer movers, good route continuity |
| City | Violet night skyline, windows, roof furniture/antennae, concrete/steel platforms with lane-like marks | More verticality, elevated moving-platform frequency/speed, moderate branching, mostly stable terrain |
| Rural Village | Rolling dark hills, cottages, roofs, windmills/fences, timber/stone platform treatment | Widest/flattest and most forgiving routes, low mover frequency/speed, moderate branching, strong route persistence |
| Swamp | Low fog bands, cypress/deadwood, hanging growth, reeds and water glints, moss-drip platforms | Low verticality but dense branching, compact gaps, slower/more common movers, somewhat more crumble, weaker route persistence |

The original Lowlands, Spires, Foundry, and Ruins remain in the same system. The deterministic 10-region cycle always starts with Lowlands and shuffles the remaining nine biomes from the world seed.

## Visual sanity check

`biome_visual_sanity_check.png` is generated from recorded draw operations emitted by the actual procedural renderer. It is used to check:

- agent contrast against every palette;
- separation between playable platforms and non-collidable background silhouettes;
- landmark readability at normal gameplay scale;
- excessive clutter in the central play band;
- pixel-art consistency across sky, scenery and platform materials.

The sheet is documentation only and is not loaded by the game.
