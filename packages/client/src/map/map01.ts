import { PLAYER_CONFIG, vec3 } from "@nullpoint/shared";

import type { ArenaBox } from "../world/arenaLayout.ts";
import type { TrainingTargetOptions } from "../world/TrainingTarget.ts";
import type { BotSpawn } from "../world/trainingRange.ts";
import type { DecorBox, MapDefinition, SpawnPoint } from "./types.ts";

/**
 * MAP 01 — "Substation": the first designed NULLPOINT combat arena.
 *
 * Compact on purpose. 48 × 40 m of playable floor means a player crossing it at
 * run speed meets something in a few seconds; a larger map would read as empty
 * with one bot in it, and the point of this map is to show how NULLPOINT plays,
 * not how big it can be.
 *
 * Everything is sized against the character rather than eyeballed:
 *
 * | Quantity | Value | Why |
 * | -------- | ----- | --- |
 * | Character height | 1.8 m | `PLAYER_CONFIG.standHeight` |
 * | Capsule diameter | 0.68 m | Sets the minimum stair tread and gap width |
 * | Step height | 0.45 m | Sets the maximum stair rise |
 * | Slope limit | 50° | Sets the ramp angle |
 * | Crouch height | 1.15 m | Sets low-cover height |
 *
 * Looking down, +X right and −Z away:
 *
 * ```
 *            ┌──────────────── ELEVATED PLATFORM (y=3) ────────────────┐   z −19
 *            │        long sightline south down the centre lane        │
 *            └──── ramp (W) ────┘                └──── stairs (E) ─────┘   z −9
 *   ┌────────┐                                                  ┌────────┐
 *   │  WEST  │            CENTRAL ARENA  (cover tiers)          │  EAST  │
 *   │  ROUTE │      ▪ low   ▪ medium   █ full-height pillars    │  ROUTE │  z 0
 *   └────────┘                                                  └────────┘
 *            ┌───────────────── ENTRY / SPAWN BAND ─────────────────────┐   z 10
 *            │   S1              S3          S4              S2         │
 *            └──────────────────────────────────────────────────────────┘   z 18
 * ```
 *
 * The centre lane (x ∈ [−2, 2]) is left open from the platform to the entry
 * band, which is the map's one long shot at ~25 m. It is deliberately the most
 * exposed path: the two side routes are longer but safe, so crossing the middle
 * is a choice rather than the only option.
 */

const HALF_X = 24;
const HALF_Z = 20;
const WALL_HEIGHT = 6;
const FLOOR_THICKNESS = 1;

/** Platform deck height. Two crouch-heights up: readable as a storey. */
const DECK = 3;

/**
 * Cover tiers, metres.
 *
 * Low is below the 1.15 m crouch height, so crouching behind it is full
 * protection while standing still lets the weapon clear it. Medium is just above
 * standing eye level, so it breaks line of sight without being climbable. Full
 * is tall enough that nothing is visible over it at any range.
 */
const COVER_LOW = 1.0;
const COVER_MEDIUM = 2.0;
const COVER_FULL = 3.2;

/** Stair rise stays under the 0.45 m step height so autostep handles it. */
const STEP_RISE = 0.3;
/**
 * Tread depth. Must exceed the capsule's 0.68 m diameter — at 0.55 m the capsule
 * cannot rest on a single tread and Rapier correctly refuses to climb, which is
 * a lesson this project has already paid for once.
 */
const STEP_DEPTH = 0.9;

const RAMP_RISE = DECK;
const RAMP_RUN = 8;
const RAMP_ANGLE = Math.atan2(RAMP_RISE, RAMP_RUN);
const RAMP_LENGTH = Math.hypot(RAMP_RISE, RAMP_RUN);
const RAMP_THICKNESS = 0.4;

/** East stairs, climbing from the arena floor to the platform deck. */
function stairs(): ArenaBox[] {
  const steps: ArenaBox[] = [];
  const count = Math.round(DECK / STEP_RISE);
  for (let i = 0; i < count; i++) {
    const height = STEP_RISE * (i + 1);
    steps.push({
      name: `m01-stair-${i}`,
      // Each step is a box grown from the floor, so its top face is the tread.
      position: [13, height / 2, -1 - i * STEP_DEPTH],
      size: [5, height, STEP_DEPTH],
      surface: "accent",
    });
  }
  return steps;
}

export const MAP01_GEOMETRY: readonly ArenaBox[] = [
  // ---- Ground and boundary ----
  { name: "m01-floor", position: [0, -FLOOR_THICKNESS / 2, 0], size: [HALF_X * 2, FLOOR_THICKNESS, HALF_Z * 2], surface: "floor" },
  { name: "m01-wall-n", position: [0, WALL_HEIGHT / 2, -HALF_Z], size: [HALF_X * 2, WALL_HEIGHT, 1], surface: "wall" },
  { name: "m01-wall-s", position: [0, WALL_HEIGHT / 2, HALF_Z], size: [HALF_X * 2, WALL_HEIGHT, 1], surface: "wall" },
  { name: "m01-wall-w", position: [-HALF_X, WALL_HEIGHT / 2, 0], size: [1, WALL_HEIGHT, HALF_Z * 2], surface: "wall" },
  { name: "m01-wall-e", position: [HALF_X, WALL_HEIGHT / 2, 0], size: [1, WALL_HEIGHT, HALF_Z * 2], surface: "wall" },

  // ---- Elevated platform: the long-sightline position ----
  // Deck spans x −16…16, z −19…−9. Wide enough that both climbs land *on* it:
  // an 18 m deck left the stairs and ramp topping out beside it with nothing to
  // step onto, which is a climb to nowhere.
  { name: "m01-platform", position: [0, DECK / 2, -14], size: [32, DECK, 10], surface: "accent" },
  // Railings along the firing edge with an 8 m gap in the middle. The gap is the
  // firing position; the railings are what make standing up there survivable.
  { name: "m01-deck-rail-w", position: [-10, DECK + 0.5, -9.3], size: [12, 1, 0.4], surface: "prop" },
  { name: "m01-deck-rail-e", position: [10, DECK + 0.5, -9.3], size: [12, 1, 0.4], surface: "prop" },

  // ---- Platform access ----
  // West ramp. Offset so the ramp's top *surface* meets the deck rather than its
  // centre line, which would otherwise leave a lip at both ends.
  {
    name: "m01-ramp",
    position: [
      -13,
      DECK / 2 - (RAMP_THICKNESS / 2) * Math.cos(RAMP_ANGLE),
      -5 + (RAMP_THICKNESS / 2) * Math.sin(RAMP_ANGLE),
    ],
    size: [5, RAMP_THICKNESS, RAMP_LENGTH],
    rotation: [RAMP_ANGLE, 0],
    surface: "ramp",
  },
  // East stairs.
  ...stairs(),

  // ---- Central arena cover, three tiers ----
  // Low: shoot over standing, fully protected crouched.
  { name: "m01-low-a", position: [-4.5, COVER_LOW / 2, -2.5], size: [2.6, COVER_LOW, 1.4], surface: "prop" },
  { name: "m01-low-b", position: [4.5, COVER_LOW / 2, 2.5], size: [2.6, COVER_LOW, 1.4], surface: "prop" },
  { name: "m01-low-c", position: [0, COVER_LOW / 2, 6.5], size: [3.2, COVER_LOW, 1.4], surface: "prop" },

  // Medium: breaks line of sight standing, for repositioning.
  { name: "m01-med-a", position: [-7.5, COVER_MEDIUM / 2, 3], size: [2.2, COVER_MEDIUM, 2.2], surface: "prop" },
  { name: "m01-med-b", position: [7.5, COVER_MEDIUM / 2, -3], size: [2.2, COVER_MEDIUM, 2.2], surface: "prop" },

  // Full: the two pillars that flank the centre lane. They leave x ∈ [−2, 2]
  // open, which is what keeps the long shot available but contested.
  { name: "m01-pillar-w", position: [-3.6, COVER_FULL / 2, 0], size: [1.6, COVER_FULL, 1.6], surface: "prop" },
  { name: "m01-pillar-e", position: [3.6, COVER_FULL / 2, 0], size: [1.6, COVER_FULL, 1.6], surface: "prop" },

  // ---- Side routes ----
  // Long walls separating each flank from the centre, open at both ends so the
  // routes connect the entry band to the deck without a dead end.
  //
  // At x = ±12.5 these ran straight across the foot of the stairs and the ramp:
  // the capsule jammed against the wall and never reached the first tread, so
  // neither climb was usable. They sit outboard of both climbs now.
  { name: "m01-route-wall-w", position: [-16.5, 1.6, 5], size: [0.6, 3.2, 14], surface: "wall" },
  { name: "m01-route-wall-e", position: [16.5, 1.6, 5], size: [0.6, 3.2, 14], surface: "wall" },
  // A doorway-height gap in each, so a player can cut through mid-route. The
  // opening is 3 m — comfortably more than the 0.68 m capsule, with room for the
  // third-person camera to follow.
  { name: "m01-route-cut-w", position: [-16.5, 4.6, 5], size: [0.6, 2.8, 3], surface: "wall" },
  { name: "m01-route-cut-e", position: [16.5, 4.6, 5], size: [0.6, 2.8, 3], surface: "wall" },

  // Cover inside each route, so a flanker is not defenceless in a corridor.
  { name: "m01-route-cover-w", position: [-20.5, COVER_MEDIUM / 2, -2], size: [2, COVER_MEDIUM, 2], surface: "prop" },
  { name: "m01-route-cover-e", position: [20.5, COVER_MEDIUM / 2, -2], size: [2, COVER_MEDIUM, 2], surface: "prop" },
  { name: "m01-route-low-w", position: [-20.5, COVER_LOW / 2, 8], size: [2.4, COVER_LOW, 1.2], surface: "prop" },
  { name: "m01-route-low-e", position: [20.5, COVER_LOW / 2, 8], size: [2.4, COVER_LOW, 1.2], surface: "prop" },

  // ---- Entry band cover ----
  // Each spawn gets something to stand behind, and none of them looks straight
  // down the centre lane at another.
  { name: "m01-entry-cover-w", position: [-14.5, COVER_FULL / 2, 13.5], size: [4, COVER_FULL, 1.2], surface: "wall" },
  { name: "m01-entry-cover-e", position: [14.5, COVER_FULL / 2, 13.5], size: [4, COVER_FULL, 1.2], surface: "wall" },
  { name: "m01-entry-low-c", position: [0, COVER_LOW / 2, 12], size: [5, COVER_LOW, 1.2], surface: "prop" },
  { name: "m01-entry-med-w", position: [-7, COVER_MEDIUM / 2, 15], size: [2, COVER_MEDIUM, 2], surface: "prop" },
  { name: "m01-entry-med-e", position: [7, COVER_MEDIUM / 2, 15], size: [2, COVER_MEDIUM, 2], surface: "prop" },
];

/**
 * Visual-only geometry. **Never given a collider.**
 *
 * Kept in its own list so the gameplay/decoration boundary is a type distinction
 * rather than a naming convention, and so the server's future copy of this map
 * can ignore it wholesale.
 */
export const MAP01_DECOR: readonly DecorBox[] = [
  // Overhead structural beams, well above head height.
  { name: "m01-beam-1", position: [0, 5.4, -6], size: [48, 0.4, 0.5], colour: 0x3f4750 },
  { name: "m01-beam-2", position: [0, 5.4, 6], size: [48, 0.4, 0.5], colour: 0x3f4750 },
  { name: "m01-beam-3", position: [0, 5.4, 16], size: [48, 0.4, 0.5], colour: 0x3f4750 },

  // Light fittings under the beams. Emissive so the room reads as lit from
  // somewhere rather than from nowhere.
  { name: "m01-lamp-1", position: [-10, 5.1, -6], size: [3, 0.2, 0.8], colour: 0xffe6b8, glow: 1 },
  { name: "m01-lamp-2", position: [10, 5.1, -6], size: [3, 0.2, 0.8], colour: 0xffe6b8, glow: 1 },
  { name: "m01-lamp-3", position: [-10, 5.1, 6], size: [3, 0.2, 0.8], colour: 0xffe6b8, glow: 1 },
  { name: "m01-lamp-4", position: [10, 5.1, 6], size: [3, 0.2, 0.8], colour: 0xffe6b8, glow: 1 },
  { name: "m01-lamp-5", position: [0, 5.1, 16], size: [3, 0.2, 0.8], colour: 0xffe6b8, glow: 1 },

  // Floor markings: a hazard stripe along the centre lane and at the deck edge,
  // so the map's most exposed ground is legible as such at a glance.
  { name: "m01-mark-lane", position: [0, 0.01, 2], size: [4, 0.02, 22], colour: 0x6b5a2a },
  { name: "m01-mark-deck", position: [0, DECK + 0.01, -9.6], size: [8, 0.02, 0.6], colour: 0x8a6f2f },

  // Pipework along the perimeter, purely for context.
  { name: "m01-pipe-w", position: [-23.2, 4.2, 0], size: [0.35, 0.35, 38], colour: 0x525b66 },
  { name: "m01-pipe-e", position: [23.2, 4.2, 0], size: [0.35, 0.35, 38], colour: 0x525b66 },
  { name: "m01-pipe-n", position: [0, 4.6, -19.2], size: [46, 0.3, 0.3], colour: 0x525b66 },
];

/**
 * Four spawns, none facing another and each behind something.
 *
 * **OPEN:** how spawns are chosen in a real match — furthest-from-enemy, team
 * sides, or fixed — is a game-design decision that belongs with the game mode
 * (`PROJECT.md` Q2/Q8). The local player currently always takes the first, which
 * is a development convenience, not a rule.
 */
export const MAP01_SPAWNS: readonly SpawnPoint[] = [
  {
    id: "S1-SOUTH-WEST",
    position: vec3(-14.5, 0.6, 16),
    // Facing north-east, across the map rather than down the centre lane.
    yaw: -Math.PI / 5,
    cover: "full-height entry wall to the north",
  },
  {
    id: "S2-SOUTH-EAST",
    position: vec3(14.5, 0.6, 16),
    yaw: Math.PI / 5,
    cover: "full-height entry wall to the north",
  },
  {
    id: "S3-WEST-ROUTE",
    position: vec3(-20.5, 0.6, 6),
    yaw: -Math.PI / 2.4,
    cover: "route wall to the east, low cover to the south",
  },
  {
    id: "S4-EAST-ROUTE",
    position: vec3(20.5, 0.6, 6),
    yaw: Math.PI / 2.4,
    cover: "route wall to the west, low cover to the south",
  },
];

/** Plates face −Z, back toward the entry band. */
const FACING_SOUTH = Math.PI;

/**
 * Targets covering every engagement the map is meant to produce.
 *
 * Placed off one another's sight lines from the entry band, for the same reason
 * the training range's are: a plate that intermittently eats rounds aimed at
 * another is a flaky test and a confusing practice session.
 */
export const MAP01_TARGETS: readonly TrainingTargetOptions[] = [
  // Short: just past the entry band's low cover.
  { id: "M01_CLOSE", position: [-6, 1.3, 5], size: [1.1, 1.5], health: 100, facing: FACING_SOUTH, postHeight: 1.3 },
  // Medium: beside the central pillars.
  { id: "M01_MID", position: [6.5, 1.3, -6], size: [1.1, 1.5], health: 100, facing: FACING_SOUTH, postHeight: 1.3 },
  // Long: on the platform deck, down the open centre lane (~25 m from spawn).
  { id: "M01_LONG", position: [0, DECK + 1.2, -12], size: [1.1, 1.4], health: 100, facing: FACING_SOUTH, postHeight: 1.2 },
  // Elevated, off-lane: only visible from the west side of the arena.
  { id: "M01_HIGH", position: [-6.5, DECK + 1.2, -12.5], size: [1.1, 1.4], health: 100, facing: FACING_SOUTH, postHeight: 1.2 },
  // Behind low cover: the plate's lower half is protected from the entry band.
  { id: "M01_COVER", position: [4.5, 1.75, 4.2], size: [1.1, 1.1], health: 100, facing: FACING_SOUTH, postHeight: 1.75 },
  // In the west route, for the flank.
  { id: "M01_FLANK", position: [-20.5, 1.3, -8], size: [1.1, 1.5], health: 100, facing: FACING_SOUTH, postHeight: 1.3 },
  // Moving, crossing the centre lane above the pillars so it never masks another.
  {
    id: "M01_MOVER",
    position: [0, 3.6, -3],
    size: [1.1, 1.2],
    health: 100,
    facing: FACING_SOUTH,
    postHeight: 3.6,
    motion: { axis: "x", amplitude: 3.5, period: 7 },
  },
];

/**
 * One bot, in the central arena.
 *
 * The bot walks in a straight line at the player (`shared/sim/botBrain.ts`), so
 * it is placed where straight lines actually reach: the open middle, which
 * connects to the entry band, both routes and the foot of both climbs. It cannot
 * climb, so it will not follow onto the deck — noted as a limitation rather than
 * papered over with a navigation system this phase is told not to build.
 */
export const MAP01_BOTS: readonly BotSpawn[] = [
  { id: "BOT_ALPHA", position: [0, 0.6, -5], damage: 12 },
];

export const MAP01: MapDefinition = {
  id: "MAP01",
  name: "Substation",
  summary: "Compact industrial arena: central cover, two flank routes, one elevated deck.",
  bounds: { x: [-HALF_X, HALF_X], z: [-HALF_Z, HALF_Z] },
  geometry: MAP01_GEOMETRY,
  decor: MAP01_DECOR,
  spawns: MAP01_SPAWNS,
  targets: MAP01_TARGETS,
  bots: MAP01_BOTS,
  lighting: {
    keyColour: 0xfff2dd,
    keyIntensity: 2.1,
    // From the north-west and high, so cover casts shadows across the lanes
    // rather than along them and silhouettes stay readable against the floor.
    keyDirection: [-0.45, -1, -0.35],
    skyColour: 0x9fb4cc,
    groundColour: 0x2e343c,
    hemisphereIntensity: 0.75,
    ambientIntensity: 0.28,
    fogColour: 0x161a1f,
    // Light enough to give depth without hiding a player at the far end of the
    // 25 m sightline — readability beats atmosphere.
    fogDensity: 0.006,
  },
};

/** Sanity constants other modules and tests can assert against. */
export const MAP01_METRICS = {
  deckHeight: DECK,
  coverLow: COVER_LOW,
  coverMedium: COVER_MEDIUM,
  coverFull: COVER_FULL,
  stepRise: STEP_RISE,
  stepDepth: STEP_DEPTH,
  rampAngle: RAMP_ANGLE,
  /** Longest clear shot: platform deck to the entry band, metres. */
  longSightline: 25,
  characterHeight: PLAYER_CONFIG.standHeight,
} as const;
