/**
 * Client-side view of the arena description.
 *
 * The geometry itself lives in `@nullpoint/shared` — the authoritative server
 * builds its physics world from the same list, and two copies of the same
 * coordinates would be free to drift apart. What stays here is presentation:
 * how a surface is coloured.
 */

export { ARENA_BOXES, TRAINING_SPAWN_POSITION as SPAWN_POSITION } from "@nullpoint/shared";
export type { ArenaBox, ArenaSurface } from "@nullpoint/shared";

import type { ArenaSurface } from "@nullpoint/shared";

export const SURFACE_COLOURS: Record<ArenaSurface, number> = {
  floor: 0x4d555e,
  wall: 0x5c646e,
  prop: 0x7d8895,
  ramp: 0x6a747f,
  accent: 0x626c78,
};
