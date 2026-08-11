import { PLAYER_CONFIG } from "../constants/index.ts";
import { vec3 } from "../math/index.ts";

import type { ArenaBox, GameplayMap, SpawnPoint } from "./types.ts";

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

export const MAP01_BOUNDS = {
  x: [-HALF_X, HALF_X],
  z: [-HALF_Z, HALF_Z],
} as const;

/** The authoritative half of Map 01. The client adds visuals on top. */
export const MAP01_GAMEPLAY: GameplayMap = {
  id: "MAP01",
  name: "Substation",
  summary: "Compact industrial arena: central cover, two flank routes, one elevated deck.",
  bounds: MAP01_BOUNDS,
  geometry: MAP01_GEOMETRY,
  spawns: MAP01_SPAWNS,
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
