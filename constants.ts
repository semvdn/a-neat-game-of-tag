
// Game world
export const GRAVITY = 0.5;
export const FALL_BOUNDARY = 2000; // Y-coord to trigger fall handling

// Agent properties
export const AGENT_WIDTH = 40;
export const AGENT_HEIGHT = 60;
export const AGENT_COLORS = ['#ef4444', '#3b82f6', '#22c55e']; // red, blue, green

// Physics properties (Base Abilities)
export const AGENT_ACCELERATION = 0.5;
export const FRICTION = 0.9; // closer to 1 is less friction
export const MAX_SPEED = 5;
export const JUMP_STRENGTH = -13;

// Energy / stamina system
export const MAX_ENERGY = 100;
export const FATIGUE_THRESHOLD = 0.30; // below 30% reserve, physical output falls smoothly
export const FATIGUED_ACCELERATION_FACTOR = 0.55;
export const FATIGUED_JUMP_FACTOR = 0.65;
export const FATIGUED_SPEED_FACTOR = 0.72;
export const CRUISE_SPEED_RATIO = 0.72; // sprint output blends from efficient cruise to peak speed
export const MOVE_ENERGY_COST_PER_SEC = 4;
export const SPRINT_ENERGY_COST_PER_SEC = 14; // full-effort full-sprint ~= 18 energy/s total
export const STATIONARY_ENERGY_RECOVERY_PER_SEC = 20;
export const WALK_ENERGY_RECOVERY_PER_SEC = 8;
export const JUMP_MIN_ENERGY_COST = 3;
export const JUMP_EXTRA_ENERGY_COST = 12; // maximum jump ~= 15 energy
export const JUMP_MIN_POWER_RATIO = 0.45;
export const JUMP_CONTROL_THRESHOLD = 0.15;

// Role physiology is deliberately identical. Strategy should emerge from objectives, stamina use, terrain and coevolution — not baked-in physical advantages.
export const CHASER_ENERGY_CAPACITY_MULTIPLIER = 1.00;
export const CHASER_RECOVERY_MULTIPLIER = 1.00;
export const CHASER_SPEED_MULTIPLIER = 1.00;
export const CHASER_ACCELERATION_MULTIPLIER = 1.00;
export const CHASER_JUMP_MULTIPLIER = 1.00;
export const EVADER_ENERGY_CAPACITY_MULTIPLIER = 1.00;
export const EVADER_RECOVERY_MULTIPLIER = 1.00;
export const EVADER_SPEED_MULTIPLIER = 1.00;
export const EVADER_ACCELERATION_MULTIPLIER = 1.00;
export const EVADER_JUMP_MULTIPLIER = 1.00;

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

// NEAT output channels. They are continuous signals, not mutually-exclusive discrete actions.
export const ACTION_SPACE = ["left_drive", "right_drive", "jump_power", "sprint"];
// 6 self + 3 boundary + 4 platform ledge + 9 nearby platforms + 4 target + 4 teammate + 8 lidar + 1 opponent energy = 39
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
export const NEAT_HOF_OPPONENTS_PER_GENOME = 1; // extra historical opponent on horizon-scheduled HoF generations
export const NEAT_HOF_MAX_SIZE = 12; // per role: recent champions + a reservoir sample of older champions
export const NEAT_HOF_RECENT_SLOTS = 4;
export const NEAT_SURVIVAL_SCORE_WINDOW_MS = 10000; // continuous runner survival credit: 1 point per 10s alive
export const NEAT_TAG_POINT_WEIGHT = 1.0;
export const NEAT_FALL_POINT_WEIGHT = 1.5;
export const NEAT_TRAINING_COURSE_LENGTH = 20000;
export const NEAT_COMPATIBILITY_THRESHOLD = 0.8;
export const NEAT_TARGET_SPECIES = 8;
export const NEAT_CROSSOVER_RATE = 0.75;
export const NEAT_WEIGHT_MUTATION_RATE = 0.8;
export const NEAT_ADD_NODE_RATE = 0.03;
export const NEAT_ADD_CONNECTION_RATE = 0.08;
