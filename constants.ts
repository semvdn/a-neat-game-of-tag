
// Game world
export const GRAVITY = 0.5;
export const FALL_BOUNDARY = 2000; // Y-coord to trigger respawn

// Agent properties
export const AGENT_WIDTH = 40;
export const AGENT_HEIGHT = 60;
export const AGENT_COLORS = ['#ef4444', '#3b82f6', '#22c55e']; // red, blue, green

// Physics properties (Base Abilities)
export const AGENT_ACCELERATION = 0.5;
export const FRICTION = 0.9; // closer to 1 is less friction
export const MAX_SPEED = 5;
export const JUMP_STRENGTH = -13;

// Progression upgrades. These do not change the original 4-action controller or 39-input senses.
// Sprint uses the strength of an already-selected left/right NEAT output as a continuous intensity.
export const SPRINT_MAX_SPEED = 7.25;
export const SPRINT_ACCELERATION_MULTIPLIER = 1.35;
export const SPRINT_ENERGY_COST_PER_SEC = 28;
// Controlled jump uses the strength of the already-selected jump output to scale the original jump.
export const CONTROLLED_JUMP_MIN_POWER_RATIO = 0.45;
export const CONTROLLED_JUMP_MIN_ENERGY_COST = 4;

// Energy System
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_RATE = 15; // points per second
export const JUMP_ENERGY_COST = 10;

// Tag mechanics
export const TAG_COOLDOWN = 2000; // 2 seconds in ms

// Platform generation
export const PLATFORM_MIN_WIDTH = 180;
export const PLATFORM_MAX_WIDTH = 380;
export const PLATFORM_HEIGHT = 20;
export const PLATFORM_SPAWN_BUFFER = 500; // How far ahead to generate/despawn platforms
export const MIN_PLATFORM_GAP_X = 60;
export const MAX_PLATFORM_GAP_X = 200;
export const MIN_PLATFORM_GAP_Y = -120;
export const MAX_PLATFORM_GAP_Y = 120;

// Learning Agent - Base Abilities Action Space
export const ACTION_SPACE = ["move_left", "move_right", "jump", "wait"];
// 6 self + 3 explicit boundary + 4 platform ledge + (3 nearby_plats * 3 feats = 9) + 4 target + 4 teammate + 8 lidar_rays + 1 bias = 39
export const NUM_LIDAR_RAYS = 8;
export const LIDAR_MAX_DISTANCE = 350;
export const STATE_VECTOR_SIZE = 39;
// Invariant Coordinate Reference (prevents window resizing from changing neural network inputs)
export const WORLD_REF_WIDTH = 1200;
export const WORLD_REF_HEIGHT = 800;

// Camera Frame Boundary Constraints & Rightward Flow Reward Shaping
export const LEFT_BOUNDARY_TOUCH_PENALTY = -2.5; // Direct penalty per frame when pinned against left screen edge
export const LEFT_BOUNDARY_PUSH_PENALTY = -2.0; // Penalty when actively pushing left against the screen edge
export const LEFT_BOUNDARY_BUFFER_RATIO = 0.20; // Leftmost 20% of screen margin is the trailing danger zone
export const LEFT_BOUNDARY_PROXIMITY_PENALTY = -1.2; // Progressive penalty scaling up as agent nears left boundary
export const RIGHTWARD_VELOCITY_REWARD = 0.05; // Forward momentum incentive rewarding rightward movement across all agents
export const RIGHTWARD_PROGRESSION_REWARD = 0.08; // Reward for expanding the group's forward horizon to the right

// Elo Rating System Hyperparameters
export const INITIAL_ELO = 1200;
export const ELO_K_FACTOR = 24;
// Telemetry History
export const SURVIVAL_TIME_HISTORY_LENGTH = 20; // Average over the last N survival times
export const TIME_TO_TAG_HISTORY_LENGTH = 10; // Average over the last N tag times

// NEAT (NeuroEvolution of Augmenting Topologies)
export const NEAT_POPULATION_SIZE = 48;
export const NEAT_OPPONENTS_PER_GENOME = 3;
export const NEAT_HOF_OPPONENTS_PER_GENOME = 1; // extra historical opponent per genome once the archive is populated
export const NEAT_HOF_MAX_SIZE = 12; // per role: recent champions + a reservoir sample of older champions
export const NEAT_HOF_RECENT_SLOTS = 4;
export const NEAT_EPISODE_MAX_MS = 12000;
export const NEAT_COMPATIBILITY_THRESHOLD = 0.8;
export const NEAT_TARGET_SPECIES = 8;
export const NEAT_CROSSOVER_RATE = 0.75;
export const NEAT_WEIGHT_MUTATION_RATE = 0.8;
export const NEAT_ADD_NODE_RATE = 0.03;
export const NEAT_ADD_CONNECTION_RATE = 0.08;
