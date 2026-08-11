import type { Vec3 } from "@nullpoint/shared";

import type { ArenaBox } from "../world/arenaLayout.ts";
import type { TrainingTargetOptions } from "../world/TrainingTarget.ts";
import type { BotSpawn } from "../world/trainingRange.ts";

/**
 * What a playable map is made of.
 *
 * A map is **data**, not code: geometry, spawns, targets and bot placements are
 * declared here and built by the same loop that has always built the arena, so a
 * piece of geometry still cannot end up visible-but-not-solid.
 *
 * The split matters more than it looks. When the authoritative server arrives it
 * needs the *gameplay* geometry and nothing else — no meshes, no materials, no
 * lights. Keeping decoration in a separate list from collision means that
 * subset already exists and is explicit, rather than having to be recovered from
 * a scene graph later (`ARCHITECTURE.md` §5.4).
 */

/**
 * A piece of the map that exists only to be looked at.
 *
 * Deliberately a distinct type from {@link ArenaBox}: there is no way to add one
 * of these and accidentally get a collider, or to add gameplay geometry and
 * accidentally get none.
 */
export interface DecorBox {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly rotation?: readonly [number, number];
  /** Colour, so decoration can read differently from cover the player can use. */
  readonly colour: number;
  /** Emissive strength, 0–1. Used for light fittings and markings. */
  readonly glow?: number;
}

/**
 * Somewhere a player can start.
 *
 * Multiplayer does not exist yet, but spawn selection is a map property rather
 * than a player property, so it belongs in the map from the beginning. The local
 * player currently always takes the first.
 */
export interface SpawnPoint {
  readonly id: string;
  /** Feet position. */
  readonly position: Vec3;
  /** Facing on spawn, radians. Character forward is −Z. */
  readonly yaw: number;
  /** Human-readable note on what this spawn is protected by. */
  readonly cover: string;
}

/** Lighting for a map. Deliberately small — three lights, no post-processing. */
export interface MapLighting {
  /** Key light colour and intensity. */
  readonly keyColour: number;
  readonly keyIntensity: number;
  /** Key light direction, from the light toward the origin. */
  readonly keyDirection: readonly [number, number, number];
  /** Sky and ground hemisphere colours, for fill. */
  readonly skyColour: number;
  readonly groundColour: number;
  readonly hemisphereIntensity: number;
  readonly ambientIntensity: number;
  readonly fogColour: number;
  readonly fogDensity: number;
}

export interface MapDefinition {
  readonly id: string;
  readonly name: string;
  /** One line on what the map is for. Shown in the development HUD. */
  readonly summary: string;
  /** Playable bounds, metres: [minX, maxX] and [minZ, maxZ]. */
  readonly bounds: { readonly x: readonly [number, number]; readonly z: readonly [number, number] };
  /** Everything solid. Meshes and colliders are both built from this. */
  readonly geometry: readonly ArenaBox[];
  /** Everything visual-only. Never given a collider. */
  readonly decor: readonly DecorBox[];
  readonly spawns: readonly SpawnPoint[];
  readonly targets: readonly TrainingTargetOptions[];
  readonly bots: readonly BotSpawn[];
  readonly lighting: MapLighting;
}
