import RAPIER from "@dimforge/rapier3d-compat";

import { PLAYER_CONFIG, type GameplayMap, type Vec3 } from "@nullpoint/shared";

import { mapColliders } from "./collision.ts";

/**
 * The authoritative physics world.
 *
 * Built from a `GameplayMap` in `@nullpoint/shared` — the same list the client
 * builds its meshes from, so what the server simulates and what the player sees
 * are the same geometry by construction rather than by discipline.
 *
 * Deliberately free of Three.js. The server has no renderer, and
 * `ARCHITECTURE.md` forbids it importing the client.
 */

/** Rapier ships as WASM and must be initialised once before any world is made. */
let rapierReady: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface CharacterBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
}

export class ServerWorld {
  readonly world: RAPIER.World;
  readonly map: GameplayMap;

  private readonly scratchTranslation = { x: 0, y: 0, z: 0 };

  constructor(map: GameplayMap) {
    this.map = map;
    // Gravity lives in the shared movement simulation, not in Rapier — the
    // character is kinematic and the client does exactly the same, so putting it
    // here would apply it twice.
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    for (const box of mapColliders(map)) {
      const rotation = new RAPIER.Quaternion(0, 0, 0, 1);
      if (box.rotation.x !== 0 || box.rotation.y !== 0) {
        // Rapier has no Euler helper; compose X then Y to match the client's
        // `THREE.Euler(x, y, 0)` ordering exactly.
        const { x: rx, y: ry } = box.rotation;
        const sx = Math.sin(rx / 2);
        const cx = Math.cos(rx / 2);
        const sy = Math.sin(ry / 2);
        const cy = Math.cos(ry / 2);
        rotation.x = sx * cy;
        rotation.y = cx * sy;
        rotation.z = -sx * sy;
        rotation.w = cx * cy;
      }

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(box.translation.x, box.translation.y, box.translation.z)
          .setRotation(rotation),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z),
        body,
      );
    }
  }

  /**
   * Creates a player capsule and its character controller.
   *
   * Same dimensions and same controller settings as the client's
   * `PhysicsWorld.createCharacterBody` — if these drift, the server and the
   * client disagree about where a player can stand, which is the one thing
   * authority is supposed to settle.
   */
  createCharacterBody(feetPosition: Vec3, halfHeight: number, radius: number): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        feetPosition.x,
        feetPosition.y + halfHeight + radius,
        feetPosition.z,
      ),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);

    const controller = this.world.createCharacterController(PLAYER_CONFIG.colliderOffset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(PLAYER_CONFIG.stepHeight, PLAYER_CONFIG.stepMinWidth, true);
    controller.enableSnapToGround(PLAYER_CONFIG.snapToGroundDistance);
    controller.setMaxSlopeClimbAngle(PLAYER_CONFIG.maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(PLAYER_CONFIG.minSlopeSlideAngle);
    controller.setApplyImpulsesToDynamicBodies(false);

    return { body, collider, controller };
  }

  /** Moves a kinematic capsule to a new feet position. */
  placeCharacter(body: RAPIER.RigidBody, feetPosition: Vec3, halfHeight: number, radius: number): void {
    this.scratchTranslation.x = feetPosition.x;
    this.scratchTranslation.y = feetPosition.y + halfHeight + radius;
    this.scratchTranslation.z = feetPosition.z;
    body.setTranslation(this.scratchTranslation, true);
  }

  removeCharacter(character: CharacterBody): void {
    this.world.removeCharacterController(character.controller);
    this.world.removeCollider(character.collider, false);
    this.world.removeRigidBody(character.body);
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
