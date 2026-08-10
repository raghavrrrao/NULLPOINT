import * as THREE from "three";

import { createLogger } from "@nullpoint/shared";

import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";
import { ARENA_BOXES, SURFACE_COLOURS, type ArenaBox } from "./arenaLayout.ts";

const log = createLogger("arena");

/**
 * Builds the arena's render meshes and physics colliders from one description.
 *
 * Both come out of the same loop over `ARENA_BOXES`, so a piece of geometry
 * cannot end up visible-but-not-solid.
 */
export class Arena {
  readonly group = new THREE.Group();
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly geometry = new Map<string, THREE.BoxGeometry>();

  constructor(physics: PhysicsWorld) {
    this.group.name = "arena";

    for (const box of ARENA_BOXES) {
      this.group.add(this.createMesh(box));
      this.createCollider(physics, box);
    }

    this.group.add(this.createGridOverlay());
    log.info(`built ${ARENA_BOXES.length} boxes with matching colliders`);
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

  /** A faint floor grid. Distance and speed are very hard to read on flat grey. */
  private createGridOverlay(): THREE.GridHelper {
    const grid = new THREE.GridHelper(60, 60, 0x5c6874, 0x454e57);
    grid.position.y = 0.01;
    const material = grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.25;
    return grid;
  }

  dispose(): void {
    for (const geometry of this.geometry.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometry.clear();
    this.materials.clear();
  }
}
