import type { Vec3 } from "../math/index.ts";

/**
 * Authoritative map data.
 *
 * This is the subset of a map the **server** needs in order to build its own
 * physics world and place players: collision boxes, spawn points and bounds.
 * Nothing here may reference Three.js, materials, lighting or decoration — the
 * server has no renderer, and `ARCHITECTURE.md` §3.2 forbids shared code from
 * depending on either package.
 *
 * The client builds its meshes *from* this data rather than holding a second
 * copy of the coordinates. One definition, so the thing the player sees and the
 * thing the server simulates cannot drift apart.
 */

/**
 * Surface kind.
 *
 * Retained in shared because it is the client's only cue for how to render a
 * box, and keeping it here means the client never has to maintain a parallel
 * table keyed by box name.
 */
export type ArenaSurface = "floor" | "wall" | "prop" | "ramp" | "accent";

/** A solid, axis-aligned or single-axis-rotated box. Always gets a collider. */
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

/** Somewhere a player can start. */
export interface SpawnPoint {
  readonly id: string;
  /** Feet position. */
  readonly position: Vec3;
  /** Facing on spawn, radians. Character forward is −Z. */
  readonly yaw: number;
  /** What this spawn is protected by. Design note, not used at runtime. */
  readonly cover: string;
}

/** The authoritative half of a map: everything the server needs, and no more. */
export interface GameplayMap {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Playable bounds, metres. */
  readonly bounds: {
    readonly x: readonly [number, number];
    readonly z: readonly [number, number];
  };
  /** Everything solid. The server builds colliders from exactly this list. */
  readonly geometry: readonly ArenaBox[];
  readonly spawns: readonly SpawnPoint[];
}
