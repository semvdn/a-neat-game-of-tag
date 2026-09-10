# Reward function and shaping

The fitness design is intentionally centered on **competitive events** and uses shaping only where sparse tag/fall outcomes were not sufficient to learn useful platforming and pursuit. Every shaping term is bounded, event-aware or based on safe world progress so it cannot easily overpower the actual game objective.

The scored episode logic lives in `learning/trainingEpisode.ts`, with configuration in `learning/trainingFitnessConfig.ts`, pursuit shaping in `learning/pursuitConfig.ts`, encounter hysteresis in `learning/encounters.ts`, and group-distance shaping in `learning/groupCohesion.ts`.

## Core competitive objective

Both roles start from a neutral baseline of 100. Competitive events are worth 20 points.

For the Chaser:

`fitness = 100 + 20 × (tags − own falls − escape failures) + pursuit shaping + proximity shaping − cohesion penalty`

For the Runner controller:

`fitness = 100 + 20 × (−tags − Runner falls) + pace shaping − pace shortfall + pressure-escape shaping − cohesion penalty`

A tag is therefore directly good for the Chaser and bad for the Runner. A fall penalizes **only the controller responsible for the role that fell**; it does not reward the opponent.

That last rule is deliberate. Earlier competitive reward designs can accidentally teach one population to "win" because the opponent fails at platforming. Here, the opponent receives no positive fitness when somebody else falls.

If the Chaser becomes so separated from every Runner that the chase has effectively broken down, the episode records a Chaser escape-failure event and terminates. If that same frame already contains a Chaser fall, the extra event penalty is not charged again.

## Why shaping is needed

Tag is a sparse outcome in a difficult procedural movement task. With only `+tag / -tag / -fall`, early populations can spend most of their time falling, standing still or moving without ever reaching a meaningful chase. The shaping terms provide intermediate gradients for behaviors that are necessary to produce tags and escapes.

The design constraint is that shaping must not become an easier substitute objective. Every positive shaping signal is therefore capped, and most are defined in ways that explicitly reject teleport, fall or stationary exploits.

## Runner pace: reward safe traversal, not raw distance

Runner movement is measured as **safe rightward frontier expansion per body**. Grounded forward movement can bank progress continuously; airborne forward travel is only banked when it ends in a successful platform landing. If a Runner falls, any forward displacement created by respawn is rebased without reward.

This solves the most obvious distance-reward exploit: jumping or falling into empty space must not earn fitness merely because X increased.

Pace is settled in 2-second windows. The default target is 260 world pixels per Runner per window. Completion is:

`completion = min(1, average safe progress / 260)`

A full window is worth up to 15 points. Going farther than the target does not produce additional reward, so evolution is encouraged to keep moving rather than sprint indefinitely for distance points.

A missing pace target also receives a shortfall penalty equal to two-thirds of the unearned full-window reward. At zero completion with default settings this is 10 points.

The shortfall term exists because a bonus-only system leaves "stand still and avoid falling" as a surprisingly competitive local optimum. Pace is therefore a requirement, not merely an optional bonus.

## Chaser pursuit: reward following the Runner's route

The Chaser receives a small reward when it first lands on a platform that a Runner has already occupied. The default value is 2.5 points per qualifying platform, capped at 5 points per 2-second pace window.

Each platform can pay this reward only once to the Chaser during the episode. This makes the signal about **successful route following**, not repeated jumping on one safe platform.

The term solves a credit-assignment gap between "I am navigating the same level as the Runner" and the much later tag event. Its cap ensures that repeated route-following cannot numerically replace catching the Runner.

## Chaser proximity progress: reward closing, not camping nearby

Within a pursuit segment, the Chaser remembers its distance to the nearest Runner at the segment start and the best distance achieved since. With the normal design it earns 1 point for each new 50-pixel improvement, capped at 6 points per segment.

Only new best progress is paid. Oscillating toward and away from the same Runner therefore cannot repeatedly farm the same distance reduction. A role change or Chaser fall resets the segment.

This shaping term addresses another sparse-reward failure mode: a Chaser may learn correct navigation and closing behavior long before it becomes precise enough to make contact.

## Pressure escapes: reward actual evasive interactions

`EncounterTracker` defines close pressure with hysteresis. An encounter begins when Chaser–Runner distance reaches 180 px or less and counts as escaped only after distance reaches at least 380 px.

A successful pressure escape gives the Runner 3 points, with both a per-window cap of 6 and a normal episode cap of 6.

Tags and **any registered fall** reset the encounter without awarding an evade. This is crucial: falling away from the Chaser must not be scored as successful evasive behavior.

The separate enter and exit thresholds also prevent rapid boundary jitter from generating many fake encounter/escape events.

## Group cohesion: discourage breaking the game without rewarding clustering

The project uses soft world-space distance bands rather than a positive "stay together" reward.

For the two Runners, separation is comfortable up to 300 px and reaches maximum excess at 700 px. Chaser-to-Runner distance is comfortable up to 600 px and reaches maximum excess at 1,000 px. Excess is linearly interpolated between those bounds.

The Runner cost uses the worse of teammate separation and Chaser separation. The Chaser cost uses only its farthest Runner distance. Each role's accumulated cohesion penalty is capped at 6 points per episode—well below one 20-point tag or fall event.

There is **no reward for touching, stacking or standing still**. Cohesion only removes fitness when the group becomes excessively fragmented.

Runner pace reward is additionally discounted by the mean cohesion excess in the same pace window. This prevents a Runner from maximizing traversal shaping simply by abandoning the chase and racing far away.

## Terms intentionally kept out of fitness

Several useful diagnostics are recorded without becoming reward signals: raw left/right world envelopes, action shares, jump counts, close-distance time, branch landings, tag timing and tags occurring soon after Runner falls.

Keeping telemetry separate from fitness is a deliberate defense against reward over-design. A metric can help diagnose behavior without giving evolution another quantity to exploit.

Biome identity, camera position and visual effects are also excluded from fitness. Terrain difficulty is handled through common seeded evaluation and curriculum exposure rather than hidden presentation-dependent rewards.

## Population-level aggregation

Episode fitness is not used as a single random draw. Each genome is evaluated against common current and historical opponent panels, and its breeding score combines 70% mean episode fitness with 30% lower-quartile mean fitness.

This makes the reward function work together with the co-evolution design: shaping helps solve the sparse within-episode problem, while robust aggregation reduces selection for policies that exploit only a narrow subset of opponents or starts.

Held-out champion validation remains separate and never changes breeding fitness.

## Key files

| Component | Responsibility |
| --- | --- |
| `learning/trainingEpisode.ts` | competitive event score and all applied shaping terms |
| `learning/trainingFitnessConfig.ts` | pace, pursuit and cohesion parameters |
| `learning/pursuitConfig.ts` | normal pursuit/pressure baseline |
| `learning/encounters.ts` | close-pressure enter/exit hysteresis |
| `learning/groupCohesion.ts` | bounded world-space separation cost |
| `workers/trainingWorker.ts` | opponent panels and robust population-level fitness aggregation |
