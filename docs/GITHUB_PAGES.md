# GitHub Pages showcase

The repository has two browser targets that share the same simulation, terrain and rendering code:

- **Full studio** — the research/training application built with `npm run build`.
- **Pages showcase** — a lightweight presentation build produced by `npm run build:demo`.

The Pages build intentionally does not import the training worker, experiment controls, checkpoint library or the 21 MB full evolution checkpoint. `npm run demo:extract` derives a compact showcase asset from the bundled full checkpoint. The current asset contains the curated Chaser g7410 + Runner g4381 genomes and the visible terrain/pursuit settings needed by the arena.

## First-time GitHub setup

1. Create the GitHub repository and push this repository to its `main` branch, including `.github/workflows/pages.yml`.
2. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the deployment source.
3. Push to `main` or run **Deploy GitHub Pages demo** manually from the Actions tab.
4. GitHub builds `dist-demo/` and publishes it through the `github-pages` environment.
5. Configure the README links once with:

   ```sh
   npm run configure:github -- OWNER/REPOSITORY
   git add README.md
   git commit -m "Configure GitHub project links"
   git push
   ```

The public URL is normally `https://OWNER.github.io/REPOSITORY/`. The deployment workflow also exposes the exact Pages URL on the deployment job.

## Work on the demo locally

```sh
npm install
npm run demo:dev
```

This runs the lightweight showcase on port 3001. The showcase starts automatically and exposes only presentation controls: pause/play, reset, visual speed, camera zoom, trails, senses, lighting mode and fullscreen.

To produce exactly what Pages receives:

```sh
npm run build:demo
npm run preview:demo
```

`dist-demo/` is ignored by Git and should never be edited directly.

## Refresh the curated pair

Replace `public/showcase/neat_tag_checkpoint_gen7422.json` with the desired full checkpoint, then run:

```sh
npm run demo:extract
```

Review `demo/public/showcase/showcase_pair_gen7422.json` and commit both the source checkpoint and derived showcase asset. The extraction script prefers the pair stored in `uiDiagnostics.chaserChampionGenome` / `uiDiagnostics.evaderChampionGenome`, preserving the pair that was actually displayed when the checkpoint was exported.

If a future checkpoint changes controller schemas, update the demo only after the normal full-app compatibility checks pass.
