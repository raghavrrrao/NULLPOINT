import * as RAPIER from "@dimforge/rapier3d-compat";

import { PLAYER_CONFIG, createLogger } from "@nullpoint/shared";

const log = createLogger("physics");

/** A cast result expressed in the units the rest of the client uses. */
export interface CastHit {
  /** Distance travelled before impact, metres. */
  readonly distance: number;
}

/** A ray hit, with everything hitscan needs to resolve a shot. */
export interface RayHit {
  /** Distance from the ray origin, metres. */
  distance: number;
  /** World-space impact point. */
  readonly point: { x: number; y: number; z: number };
  /** Surface normal at the impact point. */
  readonly normal: { x: number; y: number; z: number };
  /** Handle of the collider that was hit, for damageable lookup. */
  colliderHandle: number;
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
  /** Reused across casts so hitscan allocates nothing per shot. */
  private readonly scratchRay: RAPIER.Ray;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.scratchRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  }

  /** Allocates a reusable ray-hit record for a caller to own. */
  static createRayHit(): RayHit {
    return {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      colliderHandle: -1,
    };
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

  /**
   * Casts a ray and reports the first collider hit.
   *
   * Writes into the caller's `out` object rather than allocating: hitscan runs
   * up to a dozen times a second while the trigger is held, and the Phase 2
   * brief bans per-shot allocation.
   *
   * `direction` must be unit length, so `timeOfImpact` is a distance in metres.
   */
  castRay(
    origin: RAPIER.Vector,
    direction: RAPIER.Vector,
    maxDistance: number,
    out: RayHit,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    this.scratchRay.origin = origin;
    this.scratchRay.dir = direction;

    const hit = this.world.castRayAndGetNormal(
      this.scratchRay,
      maxDistance,
      // `solid: true` — a ray starting inside a collider reports impact at the
      // origin rather than passing through it.
      true,
      undefined,
      undefined,
      exclude,
    );
    if (hit === null) return null;

    out.distance = hit.timeOfImpact;
    out.point.x = origin.x + direction.x * hit.timeOfImpact;
    out.point.y = origin.y + direction.y * hit.timeOfImpact;
    out.point.z = origin.z + direction.z * hit.timeOfImpact;
    out.normal.x = hit.normal.x;
    out.normal.y = hit.normal.y;
    out.normal.z = hit.normal.z;
    out.colliderHandle = hit.collider.handle;
    return out;
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
