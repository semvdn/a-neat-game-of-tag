# Post-v1 research directions

The original visual-biome, sprite-animation, topology-plot and exhibition-quality goals have been implemented in the current codebase and are no longer open tasks. Remaining ideas are deliberately deferred research directions rather than v1 completion blockers.

- Explore whether selected physical trade-offs can evolve without creating degenerate strategies, for example sprint speed versus energy cost or total energy versus recovery rate.
- Consider crumbling platforms and other platform mechanics only after defining an observable state representation and regression coverage; hidden biome physics should not be introduced.
- Test whether transformer/recurrent alternatives add meaningful behavior relative to NEAT rather than increasing complexity for its own sake.
- Once the installation behavior is stable over long runs, investigate an optional ultra-slow online adaptation mode driven only by the single visible simulation. Keep this separate from the validated NEAT training/evaluation path until it has its own reproducible protocol.
- Continue curatorial experiments with complementary champion repertoires, turnover cadence, and long-form viewing, without folding aesthetic preference directly into breeding fitness.
