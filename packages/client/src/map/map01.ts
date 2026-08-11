/**
 * MAP 01 — "Substation": the client's half.
 *
 * The gameplay half — collision geometry, spawn points, bounds and the metrics
 * they are derived from — lives in `@nullpoint/shared`, because the authoritative
 * server builds its physics world from exactly that data and cannot import the
 * client. What is left here is everything the server has no use for: decoration,
 * lighting, training targets and bot placements.
 *
 * There is deliberately no second copy of any coordinate. The design rationale
 * for the layout is documented alongside the geometry, in shared.
 */

import {
  MAP01_BOUNDS,
  MAP01_GAMEPLAY,
  MAP01_GEOMETRY,
  MAP01_METRICS,
  MAP01_SPAWNS,
} from "@nullpoint/shared";

import type { TrainingTargetOptions } from "../world/TrainingTarget.ts";
import type { BotSpawn } from "../world/trainingRange.ts";
import type { DecorBox, MapDefinition } from "./types.ts";

export { MAP01_BOUNDS, MAP01_GAMEPLAY, MAP01_GEOMETRY, MAP01_METRICS, MAP01_SPAWNS };

/** Platform deck height, mirrored from the shared metrics for local readability. */
const DECK = MAP01_METRICS.deckHeight;

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

/**
 * The client's Map 01: the shared gameplay half, plus everything visual.
 */
export const MAP01: MapDefinition = {
  id: MAP01_GAMEPLAY.id,
  name: MAP01_GAMEPLAY.name,
  summary: MAP01_GAMEPLAY.summary,
  bounds: MAP01_GAMEPLAY.bounds,
  geometry: MAP01_GAMEPLAY.geometry,
  spawns: MAP01_GAMEPLAY.spawns,
  decor: MAP01_DECOR,
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
