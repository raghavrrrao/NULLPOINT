/**
 * The Phase 1 grey-box arena, described as data.
 *
 * Meshes and colliders are both generated from this one list, which is the only
 * way to guarantee the Phase 1 requirement that every visual element which
 * should block the player actually does. Adding a box here adds both.
 *
 * Everything is an axis-aligned or single-axis-rotated cuboid: `PROJECT.md` §4
 * keeps art direction open, and simple primitives are far cheaper than mesh
 * colliders (Phase 1 brief §6).
 *
 * Layout, looking down (+X right, −Z away from camera at spawn):
 *
 *   ┌─────────────────────────────────────────┐
 *   │  platform+ramp        stairs → ledge    │   −Z
 *   │                                         │
 *   │  pillars      spawn        corridor     │
 *   │              crates                     │   +Z
 *   └─────────────────────────────────────────┘
 */

export type ArenaSurface = "floor" | "wall" | "prop" | "ramp" | "accent";

export interface ArenaBox {
  readonly name: string;
  /** Centre of the box, metres. */
  readonly position: readonly [number, number, number];
  /** Full extents, metres. */
  readonly size: readonly [number, number, number];
  /** Rotation about X then Y, radians. Used only for ramps. */
  readonly rotation?: readonly [number, number];
  readonly surface: ArenaSurface;
}

const ARENA_HALF = 30;
const WALL_HEIGHT = 7;

/** Slope of the main ramp: rises 3 m over 8 m of ground, ≈20.6°. */
const RAMP_RISE = 3;
const RAMP_RUN = 8;
const RAMP_ANGLE = Math.atan2(RAMP_RISE, RAMP_RUN);
const RAMP_LENGTH = Math.hypot(RAMP_RISE, RAMP_RUN);
const RAMP_THICKNESS = 0.4;

/** Player spawn, at the character's feet. Slightly above the floor so the first tick falls. */
export const SPAWN_POSITION: readonly [number, number, number] = [0, 0.6, 12];

function stairs(): ArenaBox[] {
  const steps: ArenaBox[] = [];
  const stepRise = 0.32; // Below PLAYER_CONFIG.stepHeight, so autostep handles them.
  // The tread must be wider than the player's capsule diameter (2 × 0.34 m).
  // At 0.55 m the capsule could not rest on a single step and Rapier's autostep
  // correctly refused to climb — the character just shuffled at the bottom.
  const stepDepth = 0.9;
  for (let i = 0; i < 5; i++) {
    const height = stepRise * (i + 1);
    steps.push({
      name: `stair-${i}`,
      position: [13, height / 2, -7 - i * stepDepth],
      size: [4, height, stepDepth],
      surface: "accent",
    });
  }
  return steps;
}

export const ARENA_BOXES: readonly ArenaBox[] = [
  // ---- Ground ----
  { name: "floor", position: [0, -0.5, 0], size: [ARENA_HALF * 2, 1, ARENA_HALF * 2], surface: "floor" },

  // ---- Perimeter walls ----
  { name: "wall-north", position: [0, WALL_HEIGHT / 2, -ARENA_HALF], size: [ARENA_HALF * 2, WALL_HEIGHT, 1], surface: "wall" },
  { name: "wall-south", position: [0, WALL_HEIGHT / 2, ARENA_HALF], size: [ARENA_HALF * 2, WALL_HEIGHT, 1], surface: "wall" },
  { name: "wall-west", position: [-ARENA_HALF, WALL_HEIGHT / 2, 0], size: [1, WALL_HEIGHT, ARENA_HALF * 2], surface: "wall" },
  { name: "wall-east", position: [ARENA_HALF, WALL_HEIGHT / 2, 0], size: [1, WALL_HEIGHT, ARENA_HALF * 2], surface: "wall" },

  // ---- Elevated platform, reached by the ramp. Tests falling off an edge. ----
  // Spans z −6 … −18 so its near edge meets the top of the ramp exactly. An
  // earlier layout left a 2 m gap here that the player fell straight through.
  { name: "platform", position: [-14, 1.5, -12], size: [12, 3, 12], surface: "accent" },
  {
    name: "ramp",
    // Offset so the ramp's top *surface* runs from (z −6, y 3) to (z +2, y 0)
    // rather than its centre line, which would leave a lip at the bottom.
    position: [-14, 1.5 - (RAMP_THICKNESS / 2) * Math.cos(RAMP_ANGLE), -2 + (RAMP_THICKNESS / 2) * Math.sin(RAMP_ANGLE)],
    size: [6, RAMP_THICKNESS, RAMP_LENGTH],
    rotation: [RAMP_ANGLE, 0],
    surface: "ramp",
  },

  // ---- Stairs up to a ledge. Tests autostep. ----
  ...stairs(),
  // Top tread ends at z ≈ −11.05; the ledge picks up from there at the same height.
  { name: "stair-ledge", position: [13, 0.8, -12.8], size: [4, 1.6, 4], surface: "accent" },

  // ---- Crouch gate. Beam underside sits at 1.4 m: too low to stand, fine crouched. ----
  { name: "gate-post-left", position: [-3.5, 1.75, -18], size: [1, 3.5, 1], surface: "wall" },
  { name: "gate-post-right", position: [3.5, 1.75, -18], size: [1, 3.5, 1], surface: "wall" },
  { name: "gate-beam", position: [0, 1.7, -18], size: [6, 0.6, 1], surface: "wall" },

  // ---- Tight corridor. Tests close-quarters camera behaviour. ----
  { name: "corridor-west", position: [17, 1.75, 4], size: [0.6, 3.5, 14], surface: "wall" },
  { name: "corridor-east", position: [20, 1.75, 4], size: [0.6, 3.5, 14], surface: "wall" },
  { name: "corridor-cap", position: [18.5, 1.75, -3.3], size: [3.6, 3.5, 0.6], surface: "wall" },

  // ---- Inside corner. Forces the camera to pull in hard. ----
  { name: "corner-long", position: [8, 2, -22], size: [11, 4, 0.8], surface: "wall" },
  { name: "corner-short", position: [13.1, 2, -18.6], size: [0.8, 4, 7.6], surface: "wall" },

  // ---- Pillars. Repeated camera occlusion at speed. ----
  { name: "pillar-a", position: [-9, 2, 8], size: [1, 4, 1], surface: "prop" },
  { name: "pillar-b", position: [-5, 2, 12], size: [1, 4, 1], surface: "prop" },
  { name: "pillar-c", position: [-12, 2, 14], size: [1, 4, 1], surface: "prop" },
  { name: "pillar-d", position: [-7, 2, 17], size: [1, 4, 1], surface: "prop" },

  // ---- Crates. Graded heights around the step limit. ----
  { name: "crate-step-low", position: [5, 0.15, 6], size: [1.6, 0.3, 1.6], surface: "prop" },
  { name: "crate-step-mid", position: [7, 0.2, 4], size: [1.6, 0.4, 1.6], surface: "prop" },
  { name: "crate-blocking", position: [9, 0.4, 2], size: [1.4, 0.8, 1.4], surface: "prop" },
  { name: "crate-tall", position: [4, 0.75, 1], size: [1.5, 1.5, 1.5], surface: "prop" },
  { name: "crate-stack", position: [4, 1.9, 1], size: [1.1, 0.8, 1.1], surface: "prop" },

  // ---- Steep slope. Above the climb limit, so the player should slide back. ----
  {
    name: "slope-too-steep",
    position: [-22, 1.4, 6],
    size: [6, 0.4, 5],
    rotation: [(62 * Math.PI) / 180, 0],
    surface: "ramp",
  },
];

/** Colour per surface kind. Flat, unlit-looking greys — this is a grey-box. */
export const SURFACE_COLOURS: Record<ArenaSurface, number> = {
  floor: 0x4d555e,
  wall: 0x5c646e,
  prop: 0x7d8895,
  ramp: 0x6a747f,
  accent: 0x626c78,
};
