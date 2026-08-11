import * as THREE from "three";

import { createLogger } from "@nullpoint/shared";

import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";
import type { DamageableRegistry } from "../combat/DamageableRegistry.ts";
import { SURFACE_COLOURS, type ArenaBox } from "./arenaLayout.ts";
import { TrainingTarget } from "./TrainingTarget.ts";
import type { DecorBox, MapDefinition } from "../map/types.ts";

const log = createLogger("arena");

/**
 * Builds a map's render meshes and physics colliders from its description.
 *
 * Gameplay geometry comes out of one loop, so a piece of it cannot end up
 * visible-but-not-solid. Decoration comes out of a separate loop that never
 * touches the physics world, so it cannot accidentally become collision either
 * (`map/types.ts`).
 */
export class Arena {
  readonly group = new THREE.Group();
  readonly targets: readonly TrainingTarget[];
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly geometry = new Map<string, THREE.BoxGeometry>();

  readonly map: MapDefinition;

  constructor(physics: PhysicsWorld, damageables: DamageableRegistry, map: MapDefinition) {
    this.group.name = `map-${map.id}`;
    this.map = map;

    const boxes = map.geometry;
    for (const box of boxes) {
      this.group.add(this.createMesh(box));
      this.createCollider(physics, box);
    }

    for (const box of map.decor) {
      this.group.add(this.createDecorMesh(box));
    }

    const targets: TrainingTarget[] = [];
    for (const options of map.targets) {
      const target = new TrainingTarget(physics, options);
      // Registered by collider handle so hitscan can resolve a raycast result
      // back to the thing it hit without the physics layer knowing about targets.
      damageables.register(target.colliderId, target);
      this.group.add(target.group);
      targets.push(target);
    }
    this.targets = targets;

    log.info(
      `map ${map.id}: ${boxes.length} solid boxes, ${map.decor.length} decorative, ` +
        `${targets.length} targets, ${map.spawns.length} spawns`,
    );
  }

  /** @param dt Real frame delta, seconds. */
  update(dt: number): void {
    for (const target of this.targets) target.update(dt);
  }

  /** Restores every target to full health. Development hook. */
  resetTargets(): void {
    for (const target of this.targets) target.reset();
  }

  private materialFor(colour: number): THREE.MeshStandardMaterial {
    let material = this.materials.get(colour);
    if (material === undefined) {
      material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92, metalness: 0.0 });
      this.materials.set(colour, material);
    }
    return material;
  }

  private geometryFor(size: readonly [number, number, number]): THREE.BoxGeometry {
    // Boxes repeat a lot (stairs, pillars, crates); sharing geometry keeps the
    // draw-call and memory cost of the grey-box down.
    const key = size.join(",");
    let geometry = this.geometry.get(key);
    if (geometry === undefined) {
      geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
      this.geometry.set(key, geometry);
    }
    return geometry;
  }

  /**
   * Builds a visual-only mesh.
   *
   * Never given a collider, and never shadow-casting onto gameplay space in a
   * way that could be mistaken for cover: decoration must not change how the map
   * reads as a place to fight.
   */
  private createDecorMesh(box: DecorBox): THREE.Mesh {
    const material = this.decorMaterialFor(box.colour, box.glow ?? 0);
    const mesh = new THREE.Mesh(this.geometryFor(box.size), material);
    mesh.name = box.name;
    mesh.position.set(box.position[0], box.position[1], box.position[2]);
    if (box.rotation !== undefined) mesh.rotation.set(box.rotation[0], box.rotation[1], 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  private decorMaterialFor(colour: number, glow: number): THREE.MeshStandardMaterial {
    const key = colour * 8 + Math.round(glow * 4);
    let material = this.materials.get(key);
    if (material === undefined) {
      material = new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.85,
        metalness: 0.05,
        emissive: new THREE.Color(colour).multiplyScalar(glow),
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private createMesh(box: ArenaBox): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geometryFor(box.size),
      this.materialFor(SURFACE_COLOURS[box.surface]),
    );
    mesh.name = box.name;
    mesh.position.set(box.position[0], box.position[1], box.position[2]);
    if (box.rotation !== undefined) {
      mesh.rotation.set(box.rotation[0], box.rotation[1], 0);
    }
    mesh.castShadow = box.surface !== "floor";
    mesh.receiveShadow = true;
    return mesh;
  }

  private createCollider(physics: PhysicsWorld, box: ArenaBox): void {
    const quaternion = new THREE.Quaternion();
    if (box.rotation !== undefined) {
      quaternion.setFromEuler(new THREE.Euler(box.rotation[0], box.rotation[1], 0));
    }

    physics.addStaticBox(
      { x: box.position[0], y: box.position[1], z: box.position[2] },
      { x: box.size[0] / 2, y: box.size[1] / 2, z: box.size[2] / 2 },
      { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    );
  }


  dispose(): void {
    for (const target of this.targets) target.dispose();
    for (const geometry of this.geometry.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometry.clear();
    this.materials.clear();
  }
}
