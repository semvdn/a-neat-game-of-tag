
// Game world
export const GRAVITY = 0.5;
export const FALL_BOUNDARY = 2000; // Y-coord to trigger respawn

// Agent properties
export const AGENT_WIDTH = 40;
export const AGENT_HEIGHT = 60;
export const AGENT_COLORS = ['#2367c9', '#d83b32', '#e8bd31']; // blue, red, yellow

// Physics properties (Base Abilities)
export const AGENT_ACCELERATION = 0.5;
export const FRICTION = 0.9; // closer to 1 is less friction
export const MAX_SPEED = 5;
export const JUMP_STRENGTH = -13;

// Optional manual abilities. The policy has three factorized outputs: signed horizontal drive, jump, sprint.
// Horizontal drive is decoded from sigmoid [0,1] to signed [-1,+1]. Sprint is ignored when disabled.
export const SPRINT_MAX_SPEED = 7.25;
export const SPRINT_ACCELERATION_MULTIPLIER = 1.35;
export const SPRINT_ENERGY_COST_PER_SEC = 28;
// Controlled jump uses the independent jump output strength to scale the original jump.
export const CONTROLLED_JUMP_MIN_POWER_RATIO = 0.45;
export const CONTROLLED_JUMP_MIN_ENERGY_COST = 4;

// Energy System
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_RATE = 15; // points per second
export const JUMP_ENERGY_COST = 10;

// Tag mechanics
export const TAG_COOLDOWN = 2000; // 2 seconds in ms
export const NEW_CHASER_TAG_DELAY_MS = 600; // brief no-tag window immediately after becoming Chaser

// Platform generation
export const PLATFORM_MIN_WIDTH = 180;
export const PLATFORM_MAX_WIDTH = 380;
export const PLATFORM_HEIGHT = 20;
export const PLATFORM_SPAWN_BUFFER = 500; // How far ahead to generate/despawn platforms
export const MIN_PLATFORM_GAP_X = 60;
export const MAX_PLATFORM_GAP_X = 200;
export const MIN_PLATFORM_GAP_Y = -120;
export const MAX_PLATFORM_GAP_Y = 120;
// Geometry clearance is stricter than simple non-overlap. Parallel platforms whose horizontal
// spans (or moving sweep envelopes) overlap must leave enough vertical room for an agent body,
// while nearby platforms on the same level keep a readable horizontal gap.
export const MIN_PLATFORM_CLEARANCE_X = 42;
export const MIN_PLATFORM_CLEARANCE_Y = 76;
// Branch trees may use more vertical space than the ordinary trunk. This gives recursive choices
// enough room to remain visually distinct without forcing deep routes into one another.
export const BRANCH_MIN_PLATFORM_Y = 80;
export const BRANCH_BOTTOM_MARGIN = 40;

// Runtime action telemetry remains directional so diagnostics can distinguish left from right, while
// the neural policy itself uses a single signed horizontal output.
export const ACTION_SPACE = ["move_left", "move_right", "jump", "sprint"] as const;
export const POLICY_OUTPUT_SPACE = ["horizontal_drive", "jump", "sprint"] as const;
export const POLICY_CONTROL_ACTIVE_THRESHOLD = 0.10;
// Jump behaves like a button rather than a held auto-repeat control. A press must cross the high
// threshold, and another jump is impossible until the output is released below the low threshold.
export const JUMP_PRESS_THRESHOLD = 0.55;
export const JUMP_RELEASE_THRESHOLD = 0.20;
// Compact non-redundant senses:
// 5 self + 1 target/threat cooldown + 2 current/reference ledges
// + 9 semantic platform slots + 4 target/threat dynamics + 2 teammate position = 23.
// Presentation-camera position is intentionally excluded: rendering is not game state.
export const STATE_VECTOR_SIZE = 23;
// Invariant Coordinate Reference (prevents window resizing from changing neural network inputs)
export const WORLD_REF_WIDTH = 1200;
export const WORLD_REF_HEIGHT = 800;

// Presentation-camera / chase-containment contract. The champion camera may auto-zoom down to
// 50% of the invariant reference view; requiring a smaller scale would make the agents too small
// to follow meaningfully. Headless training uses this same reference envelope. A Chaser escape is
// triggered only when every Chaser-to-Runner pair exceeds it, so Runner-Runner separation alone
// cannot create a browser-size-dependent Chaser failure.
export const CAMERA_FRAME_PADDING_REFERENCE_PX = 72;
export const CAMERA_MIN_USEFUL_AUTO_ZOOM = 0.5;
export const CHASE_ESCAPE_MAX_GROUP_SPAN_X =
  (WORLD_REF_WIDTH - CAMERA_FRAME_PADDING_REFERENCE_PX * 2) / CAMERA_MIN_USEFUL_AUTO_ZOOM;
export const CHASE_ESCAPE_MAX_GROUP_SPAN_Y =
  (WORLD_REF_HEIGHT - CAMERA_FRAME_PADDING_REFERENCE_PX * 2) / CAMERA_MIN_USEFUL_AUTO_ZOOM;

// Visual-only rightward flow reward breakdown. Evolutionary fitness is defined separately in trainingEpisode.ts.
export const RIGHTWARD_VELOCITY_REWARD = 0.05;
export const RIGHTWARD_PROGRESSION_REWARD = 0.08;

// Elo Rating System Hyperparameters
export const INITIAL_ELO = 1200;
export const ELO_K_FACTOR = 24;
// Telemetry History
export const SURVIVAL_TIME_HISTORY_LENGTH = 20; // Average over the last N survival times
export const TIME_TO_TAG_HISTORY_LENGTH = 10; // Average over the last N tag times

// NEAT (NeuroEvolution of Augmenting Topologies)
export const NEAT_POPULATION_SIZE = 48;
export const NEAT_OPPONENTS_PER_GENOME = 3;
export const NEAT_HOF_OPPONENTS_PER_GENOME = 3; // historical-league matches; with 3 current matches this yields a 50/20/15/15 current/recent/strong/diverse mix
export const NEAT_HOF_MAX_SIZE = 12; // per role: recent champions + behaviorally diverse historical champions
export const NEAT_HOF_RECENT_SLOTS = 4;
export const NEAT_HOF_SIMILARITY_THRESHOLD = 0.16; // descriptors closer than this are treated as the same behavioral niche
export const NEAT_HOF_NOVELTY_WEIGHT = 0.75; // historical archive utility = novelty + fixed-benchmark strength
export const NEAT_BENCHMARK_REFERENCES_PER_ROLE = 3; // frozen at the beginning of a run; never used for selection
export const NEAT_BENCHMARK_START_MODES = 3; // exact visual, varied fresh, and true mid-game per frozen reference
// Main population evaluation uses a common opponent panel: every candidate in a role is
// compared against the same opponents/scenario seeds, eliminating most opponent-draw noise.
// The strongest few then face a separate held-out panel before one is accepted as champion.
export const NEAT_CHAMPION_VALIDATION_CANDIDATES = 4;
export const NEAT_CHAMPION_VALIDATION_CURRENT_OPPONENTS = 4;
export const NEAT_CHAMPION_VALIDATION_HOF_OPPONENTS = 2;
// Retained visible champions are chosen separately from evolutionary champions. Only the strongest
// held-out candidates are re-run on the frozen benchmark, keeping the extra cost modest while
// preventing a transient co-evolutionary matchup from replacing a broadly capable policy.
export const NEAT_GENERALIST_VALIDATION_CANDIDATES = 2;
export const NEAT_GENERALIST_REPLACEMENT_MARGIN = 1.5;
export const NEAT_EPISODE_MAX_MS = 12000;

// Gameplay-interest shaping. Runner progression is a capped minimum-pace objective rather than an
// unbounded distance race. Every 2-second window asks for modest SAFE rightward progress; going
// faster than the target earns nothing extra, leaving room for dodging, reversing, route choice and
// waiting for terrain. Chaser traversal shaping is deliberately much smaller than a +20 tag.
export const RUNNER_PACE_WINDOW_MS = 2000;
export const DEFAULT_RUNNER_PACE_TARGET_PX = 260;
export const MIN_RUNNER_PACE_TARGET_PX = 100;
export const MAX_RUNNER_PACE_TARGET_PX = 600;
export const DEFAULT_RUNNER_PACE_REWARD_PER_WINDOW = 15;
export const MAX_RUNNER_PACE_REWARD_PER_WINDOW = 30;
export const DEFAULT_CHASER_PURSUIT_REWARD_PER_PLATFORM = 2.5;
export const MAX_CHASER_PURSUIT_REWARD_PER_PLATFORM = 8;
export const CHASER_PURSUIT_REWARD_CAP_PER_WINDOW = 5;
// Tactical evasion reward: entering genuine pressure (<=180px) and opening back beyond 380px
// without a tag/fall earns a small capped bonus. Pace remains the dominant movement requirement.
export const RUNNER_PRESSURE_ESCAPE_REWARD = 3;
export const RUNNER_PRESSURE_ESCAPE_REWARD_CAP_PER_WINDOW = 6;

// Interaction diagnostics / evade hysteresis.
export const CLOSE_ENCOUNTER_ENTER_PX = 180;
export const CLOSE_ENCOUNTER_EXIT_PX = 380;
export const TAG_AFTER_RUNNER_FALL_WINDOW_MS = 2000;

// Branch-and-reconnect structures become more frequent farther from the origin. Both routes are
// intentionally reachable but now remain spatially separated for a meaningful runway before
// reconnecting, so a fork creates a real commitment/interception decision rather than a cosmetic detour.
// Route choices now appear during the part of an episode the population actually reaches while
// still becoming more common farther into the level. The generator also has early-window and
// maximum-spacing safeguards in simulationCore.ts, so these are the background probabilities rather
// than the only mechanism that can produce a branch.
export const BRANCH_STRUCTURE_MIN_X = 650;
export const BRANCH_STRUCTURE_BASE_CHANCE = 0.18;
export const BRANCH_STRUCTURE_MAX_CHANCE = 0.36;
export const NEAT_COMPATIBILITY_THRESHOLD = 0.8;
export const NEAT_TARGET_SPECIES = 8;
export const NEAT_CROSSOVER_RATE = 0.75;
export const NEAT_WEIGHT_MUTATION_RATE = 0.8;
export const NEAT_ADD_NODE_RATE = 0.03;
export const NEAT_ADD_CONNECTION_RATE = 0.08;
