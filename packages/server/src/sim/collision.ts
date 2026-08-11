import type { ArenaBox, GameplayMap } from "@nullpoint/shared";

/**
 * Turns a map's shared geometry into physics-engine-ready collider descriptions.
 *
 * Deliberately **not** Rapier-specific and deliberately not a world: Session A's
 * job is to prove the shared map data is sufficient for the server to build one,
 * not to build it. `Rapier.ColliderDesc.cuboid(halfExtents)` plus a translation
 * and rotation is exactly what the client already does with the same list
 * (`world/Arena.ts`), so a matching world is a mechanical step in Session B.
 *
 * Keeping this a pure function also means the geometry can be checked without
 * loading a physics engine at all.
 */

export interface BoxCollider {
  readonly name: string;
  readonly translation: { readonly x: number; readonly y: number; readonly z: number };
  /** Half extents, metres — the form every physics engine wants. */
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  /** Rotation about X then Y, radians. Zero for everything except ramps. */
  readonly rotation: { readonly x: number; readonly y: number };
}

export function toBoxCollider(box: ArenaBox): BoxCollider {
  const [x, y, z] = box.position;
  const [width, height, depth] = box.size;
  const [rotX, rotY] = box.rotation ?? [0, 0];

  return {
    name: box.name,
    translation: { x, y, z },
    halfExtents: { x: width / 2, y: height / 2, z: depth / 2 },
    rotation: { x: rotX, y: rotY },
  };
}

/** Every collider a map needs. One per solid box, and none for decoration. */
export function mapColliders(map: GameplayMap): readonly BoxCollider[] {
  return map.geometry.map(toBoxCollider);
}

/**
 * Checks a map is usable as an authoritative world.
 *
 * Returns the problems rather than throwing, so a caller can report all of them
 * at once. An empty array means the map is sound.
 */
export function validateGameplayMap(map: GameplayMap): readonly string[] {
  const problems: string[] = [];

  if (map.geometry.length === 0) problems.push(`${map.id}: no geometry`);
  if (map.spawns.length === 0) problems.push(`${map.id}: no spawn points`);

  const names = new Set<string>();
  for (const box of map.geometry) {
    if (names.has(box.name)) problems.push(`${map.id}: duplicate geometry name "${box.name}"`);
    names.add(box.name);

    for (const extent of box.size) {
      // A zero or negative extent produces a degenerate collider that some
      // engines accept and then behave unpredictably around.
      if (!Number.isFinite(extent) || extent <= 0) {
        problems.push(`${map.id}: "${box.name}" has a non-positive extent`);
        break;
      }
    }
    for (const axis of box.position) {
      if (!Number.isFinite(axis)) problems.push(`${map.id}: "${box.name}" has a non-finite position`);
    }
  }

  const spawnIds = new Set<string>();
  for (const spawn of map.spawns) {
    if (spawnIds.has(spawn.id)) problems.push(`${map.id}: duplicate spawn id "${spawn.id}"`);
    spawnIds.add(spawn.id);

    const { x, z } = spawn.position;
    if (x < map.bounds.x[0] || x > map.bounds.x[1] || z < map.bounds.z[0] || z > map.bounds.z[1]) {
      problems.push(`${map.id}: spawn "${spawn.id}" is outside the map bounds`);
    }
  }

  return problems;
}
