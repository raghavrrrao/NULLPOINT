import * as RAPIER from "@dimforge/rapier3d-compat";

import { PLAYER_CONFIG, createLogger } from "@nullpoint/shared";

const log = createLogger("physics");

/** A cast result expressed in the units the rest of the client uses. */
export interface CastHit {
  /** Distance travelled before impact, metres. */
  readonly distance: number;
}

/**
 * The Rapier world and the queries the client needs against it.
 *
 * Rapier's own gravity is zero on purpose: the character is kinematic and its
 * gravity lives in `@nullpoint/shared`'s movement simulation, so that the server
 * can run the identical integration in a later phase (`ARCHITECTURE.md` §3.1).
 * Two gravities would mean two answers.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly rapier = RAPIER;
  private readonly identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    log.info("Rapier initialised", RAPIER.version());
    return new PhysicsWorld();
  }

  /**
   * Adds a static box collider. Every visible piece of the arena goes through
   * here so a mesh can never exist without matching collision.
   */
  addStaticBox(
    position: RAPIER.Vector,
    halfExtents: RAPIER.Vector,
    rotation: RAPIER.Rotation,
  ): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(rotation),
    );
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    return this.world.createCollider(desc, body);
  }

  createCharacterController(): RAPIER.KinematicCharacterController {
    const c = this.world.createCharacterController(PLAYER_CONFIG.colliderOffset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.enableAutostep(PLAYER_CONFIG.stepHeight, PLAYER_CONFIG.stepMinWidth, true);
    c.enableSnapToGround(PLAYER_CONFIG.snapToGroundDistance);
    c.setMaxSlopeClimbAngle(PLAYER_CONFIG.maxSlopeClimbAngle);
    c.setMinSlopeSlideAngle(PLAYER_CONFIG.minSlopeSlideAngle);
    // Nothing dynamic exists in Phase 1; leaving this on would only cost time.
    c.setApplyImpulsesToDynamicBodies(false);
    return c;
  }

  /** Creates the player's kinematic-position capsule at `feetPosition`. */
  createCharacterBody(
    feetPosition: RAPIER.Vector,
    halfHeight: number,
    radius: number,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const centreY = feetPosition.y + halfHeight + radius;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        feetPosition.x,
        centreY,
        feetPosition.z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius),
      body,
    );
    return { body, collider };
  }

  /**
   * Sweeps a sphere and reports the first hit.
   *
   * Used for camera collision and for the crouch headroom test.
   *
   * `direction` must be unit length. Rapier integrates the swept position as
   * `origin + direction * toi`, so with a unit direction the reported `toi` is
   * already a distance in metres and needs no rescaling.
   */
  sweepSphere(
    origin: RAPIER.Vector,
    direction: RAPIER.Vector,
    radius: number,
    maxDistance: number,
    exclude?: RAPIER.Collider,
  ): CastHit | null {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      origin,
      this.identityRotation,
      direction,
      shape,
      0, // targetDistance: report contact at zero separation.
      maxDistance,
      true,
      undefined,
      undefined,
      exclude,
    );
    if (hit === null) return null;
    return { distance: hit.time_of_impact };
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
