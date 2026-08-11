import { vec3 } from "@nullpoint/shared";

import { ARENA_BOXES, SPAWN_POSITION } from "../world/arenaLayout.ts";
import { BOT_SPAWNS, RANGE_BOXES, TRAINING_TARGETS } from "../world/trainingRange.ts";
import { MAP01 } from "./map01.ts";
import type { MapDefinition } from "./types.ts";

/**
 * The maps the game can load.
 *
 * Two, for a reason worth stating. `TRAINING` is the Phase 1 grey-box arena and
 * the Phase 2 range, unchanged: its stairs, ramp, crouch gate, corridor and
 * inside corner exist to exercise the movement and camera systems, and roughly
 * sixty regression tests assert against their exact coordinates. Deleting it to
 * make room for a designed map would throw away that coverage.
 *
 * `MAP01` is the game's actual first map and the default. The regression suites
 * select `TRAINING` explicitly.
 */

/** The Phase 1 arena and Phase 2 range, as a map. Content is unchanged. */
export const TRAINING_MAP: MapDefinition = {
  id: "TRAINING",
  name: "Training Arena",
  summary: "Phase 1 grey-box systems test bed plus the Phase 2 firing range.",
  bounds: { x: [-30, 30], z: [-30, 30] },
  geometry: [...ARENA_BOXES, ...RANGE_BOXES],
  decor: [],
  spawns: [
    {
      id: "TRAINING-SPAWN",
      position: vec3(SPAWN_POSITION[0], SPAWN_POSITION[1], SPAWN_POSITION[2]),
      yaw: 0,
      cover: "open ground; this is a test bed, not a combat map",
    },
  ],
  targets: TRAINING_TARGETS,
  bots: BOT_SPAWNS,
  lighting: {
    keyColour: 0xffffff,
    keyIntensity: 2.0,
    keyDirection: [-0.4, -1, -0.3],
    skyColour: 0x93a7bd,
    groundColour: 0x30363d,
    hemisphereIntensity: 0.7,
    ambientIntensity: 0.3,
    fogColour: 0x171b20,
    fogDensity: 0.0055,
  },
};

const MAPS: Readonly<Record<string, MapDefinition>> = {
  [MAP01.id]: MAP01,
  [TRAINING_MAP.id]: TRAINING_MAP,
};

/** The map loaded when nothing asks for a specific one. */
export const DEFAULT_MAP_ID = MAP01.id;

/**
 * Resolves a map by id, falling back to the default.
 *
 * Unknown ids fall back rather than throw: the id can come from a query string,
 * and a typo should start the game on the default map, not fail to start.
 */
export function resolveMap(id: string | null | undefined): MapDefinition {
  if (id === null || id === undefined) return MAPS[DEFAULT_MAP_ID] as MapDefinition;
  const found = MAPS[id.toUpperCase()];
  return found ?? (MAPS[DEFAULT_MAP_ID] as MapDefinition);
}

/** Every map id, for development tooling. */
export function mapIds(): readonly string[] {
  return Object.keys(MAPS);
}

export { MAP01, MAP01_METRICS } from "./map01.ts";
export type { DecorBox, MapDefinition, MapLighting, SpawnPoint } from "./types.ts";
