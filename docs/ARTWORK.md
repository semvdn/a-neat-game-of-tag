# An evolving painting

The work is a relationship between three bodies and a landscape: approach, pursuit, reversal, contact, release. Evolution should produce a changing vocabulary of those relationships, while the presentation makes them legible from across a room.

Interesting does not mean maximum tags. A stream of catches after falls is busy but shallow. Endless running is movement without interaction. Look for sustained pursuit, clean reversals, occasional escapes, traversable route choices, and quiet intervals between events. Keep these as separate observations rather than inventing one aesthetic fitness score that evolution can exploit.

## Exhibition operation

1. The app automatically loads the curated **generation 7422** full checkpoint shipped in `public/showcase/`. Its saved display diagnostics preserve the selected showcase pair—**Chaser g7410 + Runner g4381**—and that exact pair is restored for visible playback. In studio mode, select **Start Simulation** when you want visible playback and background evolution to begin.
2. Choose terrain, trails, preferred zoom, and playback speed in the studio. Start at 1×; watch a long continuous passage before adjusting it.
3. Use **Exhibit** or **G** to fill the page with the arena. Exhibition state is written to the URL as `?exhibit=1`, so reloading the page returns directly to the artwork. Senses, status panels, diagnostic windows, and gameplay sounds are suppressed. Studio overlay preferences are restored on exit.
4. A page opened with `?exhibit=1` auto-starts visible playback after the bundled checkpoint is installed. Background evolution is **paused by default**, keeping the curated g7410/g4381 display pair stable while the full evolutionary state remains the generation-7422 checkpoint. Add `&train=1` only when an installation is deliberately meant to continue evolving.
5. Press **F** in exhibition mode for browser fullscreen, when supported. Move the pointer to reveal the exit control; **G** or **Escape** returns to the studio. Browser fullscreen can also be exited with the browser's own controls.

Exhibition does not change policy inputs, terrain rules, visual speed, or the current world. The screen wake lock is requested in exhibition even when training is paused, where supported. Export independently trained checkpoints before an installation when they need to be archived; the bundled showcase is a repository asset, while browser checkpoint-library entries are convenience storage rather than archival copies.

## Offline and unattended operation

The production build has no required CDN, Gemini, or other remote runtime dependency. Tailwind utilities are compiled into the checked-in/generated local `styles.css`, Vite uses relative production asset paths, and the generation-7422 showcase checkpoint is copied into `dist/showcase/`. After dependencies have been installed and the project built, the artwork can therefore run without internet access. Serve `dist/` from a local HTTP server; browser module/worker security rules make `file://` an unsuitable deployment target.

The kiosk entry point is the local installation URL with `?exhibit=1`. Fatal React/render errors and uncaught main-page errors trigger a bounded automatic reload in exhibition mode, with at most three attempts in a rolling minute to avoid an infinite crash loop. A reload reconstructs the visual world from the bundled showcase checkpoint. If the background training worker fails while curated exhibition training is paused, the visible champion arena can continue independently. When `train=1` is active, a worker failure requests the same bounded page recovery.

The existing visual group-separation fail-safe remains a second, gameplay-level recovery path: a severely fragmented visible group is regrouped on a legal nearby platform without changing training fitness. Parallel training evaluators also retain their independent stalled-worker watchdog.

A browser wake lock cannot prevent operating-system hibernation, process termination, power loss, or an administrator closing the browser. Test fullscreen, sleep/wake recovery, frame rate, GPU/CPU thermals, and memory on the actual display computer for several hours before unattended exhibition use.

## Development direction

Treat the current gameplay, controller schema, terrain system, and curated showcase pair as **feature-frozen for the v1 exhibition candidate**. The priority is now release validation: long uninterrupted wall-clock runs, reload/sleep-wake recovery, memory and thermal behavior, and confirming that the curated pair remains engaging across many biome transitions without pathological stalls or repeated fail-safe intervention.

Curate presentation separately from evolutionary fitness. Tempo, trail persistence, color, negative space, and camera framing still benefit from human viewing, but changes should be conservative and should not alter policy inputs or physics this late in the release cycle. Inspect both a continuous 20–60 minute passage and several multi-hour soak runs on the intended display computer.

Future experiments—slower champion turnover, repertoires of complementary policy pairs, longer validation episodes, crumble mechanics, or controller/architecture changes—belong to post-v1 research branches rather than this release-hardening line.

## Hooded pixel-agent presentation

The visible agents use one shared hand-authored hooded sprite set, recolored blue, red, and yellow. The geometry is presentation-only: collision remains the unchanged `AGENT_WIDTH × AGENT_HEIGHT` body used by both visual play and training. Each idle/run/sprint/jump/fall/tag key frame has its own hood, face opening, cloak, trailing cloth, highlights, folds, feet, and eye placement rather than being generated by rotating or deforming a single base drawing.

The sprite's bottom edge is pinned to the physical body bottom so its tiny dark feet remain the first visible pixels to touch a platform. Movement state is selected from shared simulation fields (`isOnGround`, velocity, sprint intensity, cooldown/status), while the animation clock uses simulation game time. Sprint afterimages, fall streaks, and the square-particle tag burst are visual effects only and do not enter policy state or physics.

## Biome platform decorations

Platforms are visually dressed with small deterministic props after their biome material is drawn.
These props are renderer-only: they are not collision objects, are not present in policy sensing, and
never alter terrain generation. Placement uses platform id plus the captured biome region so the same
platform keeps the same dressing as it moves.

The prop vocabulary is biome-specific: Lowlands grass/shrubs/flowers; Desert cactus/tumbleweed/dry
grass; Snowy Mountains small pines/snowy rocks; Temperate Forest ferns/shrubs/mushrooms; City street
lamps/bins/bollards; Rural Village fence pieces/hay/shrubs; Swamp reeds/stumps/shrubs; Foundry vents
and metal crates; Spires stone markers/fragments; and Ruins broken masonry/grass/shrubs. Props are kept
small relative to the 40×60 agent, avoid platform edges, and moving platforms receive reduced dressing.

### Green-biome panorama contour fix

Organic green biomes (Lowlands, Temperate Forest, Rural Village, Swamp) deliberately omit the
continuous mid-distance panorama silhouette. The far panorama still provides depth, while the
mid/near procedural landmark layers provide vegetation and structures. This avoids a redundant
semi-transparent valley contour around the lower quarter of the viewport that could read as a
U-shaped color-overlay seam, especially under bright daytime lighting.

The mid panorama fades continuously back in through biome transitions where structural/desert/snow
skyline silhouettes are useful. Swamp mist/reeds and Rural fences are world-anchored local details;
they must not be redrawn as full-screen overlays per sampled biome slice.
