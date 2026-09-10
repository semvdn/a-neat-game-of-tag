# A NEAT Game of Tag

*Evolving pursuit and evasion with NeuroEvolution of Augmenting Topologies*

[![Validate project](https://github.com/semvdn/a-neat-game-of-tag/actions/workflows/ci.yml/badge.svg)](https://github.com/semvdn/a-neat-game-of-tag/actions/workflows/ci.yml)

This project is an exploration of how pursuit and evasion behaviour can emerge through NeuroEvolution of Augmenting Topologies (NEAT).

Autonomous Chaser and Runner policies co-evolve to play tag across an infinite procedural platform world. The project combines a shared real-time/headless simulation, custom NEAT evolution, multi-agent evaluation, procedural terrain, diagnostic tooling, and a lightweight browser demo.

[**▶ Open the live GitHub Pages demo**](https://semvdn.github.io/a-neat-game-of-tag/)

[![A NEAT Game of Tag gameplay](docs/media/gameplay.gif)](https://semvdn.github.io/a-neat-game-of-tag/)

## Clone and run locally

Requires **Node.js 22 or newer**, npm, and a modern desktop browser. An `.nvmrc` is included, so nvm users can run `nvm use` before installing dependencies.

```sh
git clone https://github.com/semvdn/a-neat-game-of-tag.git
cd a-neat-game-of-tag
npm install
npm run dev
```

Open the local URL printed by Vite. The app comes with a pre-evolved **generation 7422 checkpoint**, loaded automatically as the default showcase and evolutionary resume point.

## Documentation

The public documentation is intentionally limited to the core mechanisms that define the project:

- [**World and platform generation**](docs/WORLD.md) — the infinite rolling world, branches, moving platforms, biome biases and terrain-safety invariants.
- [**Agent senses and neural-network architecture**](docs/SENSES_AND_NETWORK.md) — the 23 world-relative observations, semantic platform sensing, 16→12 starting network, recurrent memory and action decoding.
- [**NEAT and co-evolution setup**](docs/NEAT.md) — topology evolution, speciation, opponent leagues and champion validation.
- [**Reward function and shaping**](docs/REWARD_SHAPING.md) — competitive events, safe-progress shaping, pursuit/escape signals and anti-exploit constraints.

Implementation guidance for coding agents are in [AGENTS.md](AGENTS.md) and `.agents/skills/`.

## License

Released under the [MIT License](LICENSE).

## AI use

Generative AI, primarily OpenAI's GPT 5.6 Sol, was used extensively as a development tool throughout this project.
