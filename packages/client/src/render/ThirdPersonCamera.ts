import type * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { CAMERA_CONFIG, clamp, damp, wrapAngle } from "@nullpoint/shared";

import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";

const config = CAMERA_CONFIG;

/**
 * Ceiling on pitch after the collision lift is added, radians (~77°).
 * At 90° the boom is directly overhead and `lookAt` has no usable up vector.
 */
const MAX_EFFECTIVE_PITCH = 1.35;

/**
 * Over-the-shoulder third-person camera.
 *
 * Owns the yaw and pitch that the character's movement is resolved against, so
 * this is the authority on "where is forward" (`ARCHITECTURE.md` §4.2). The
 * character never drives the camera; the camera never drives the character's
 * position.
 */
export class ThirdPersonCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly physics: PhysicsWorld;

  private yawAngle = 0;
  private pitchAngle = -0.12;

  /** Smoothed pivot, so the camera trails the character instead of snapping. */
  private readonly pivot = new THREE.Vector3();
  private pivotInitialised = false;

  /** Current boom length after collision, eased outward on release. */
  private currentDistance = config.distance;

  private readonly desiredPosition = new THREE.Vector3();
  private readonly offsetDirection = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  /**
   * The player's collider, excluded from the collision sweep.
   *
   * The sweep starts at the pivot, which is *inside* the character, so without
   * excluding it the camera collides with the player it is following.
   */
  private ignoredCollider: RAPIER.Collider | undefined;

  constructor(camera: THREE.PerspectiveCamera, physics: PhysicsWorld) {
    this.camera = camera;
    this.physics = physics;
  }

  /**
   * Extra pitch added when geometry compresses the boom, radians.
   *
   * Kept separate from `pitchAngle` so the player's own look input is never
   * altered by collision — releasing the obstruction restores exactly the view
   * they were holding.
   */
  private collisionLift = 0;

  /** Excludes a collider — the followed character — from camera collision. */
  ignoreCollider(collider: RAPIER.Collider): void {
    this.ignoredCollider = collider;
  }

  /** Points the boom from the pivot toward the camera at `pitch`. */
  private setDirection(pitch: number): void {
    const cosPitch = Math.cos(pitch);
    this.offsetDirection.set(
      Math.sin(this.yawAngle) * cosPitch,
      Math.sin(pitch),
      Math.cos(this.yawAngle) * cosPitch,
    );
  }

  get yaw(): number {
    return this.yawAngle;
  }

  get pitch(): number {
    return this.pitchAngle;
  }

  /**
   * Applies raw pointer-lock mouse movement, in pixels.
   *
   * Signs are not symmetric, and both are deliberate. Moving the mouse right
   * must turn the view right: forward is `(−sin yaw, −cos yaw)`, so turning
   * from north toward east requires yaw to *decrease*. Pushing the mouse away
   * must look up: the boom sits above the pivot at positive pitch, so looking up
   * means pitch *decreases* with a negative `deltaY`.
   */
  applyMouseDelta(deltaX: number, deltaY: number): void {
    this.yawAngle = wrapAngle(this.yawAngle - deltaX * config.sensitivity);
    this.pitchAngle = clamp(
      this.pitchAngle + deltaY * config.sensitivity,
      config.minPitch,
      config.maxPitch,
    );
  }

  /**
   * Positions the camera for this frame.
   *
   * @param targetX/Y/Z Character feet position.
   * @param pivotHeight Height of the look pivot above the feet.
   * @param dt          Real frame delta, seconds.
   */
  update(targetX: number, targetY: number, targetZ: number, pivotHeight: number, dt: number): void {
    const goalX = targetX;
    const goalY = targetY + pivotHeight;
    const goalZ = targetZ;

    if (!this.pivotInitialised) {
      this.pivot.set(goalX, goalY, goalZ);
      this.pivotInitialised = true;
    } else {
      this.pivot.set(
        damp(this.pivot.x, goalX, config.followDamp, dt),
        damp(this.pivot.y, goalY, config.followDamp, dt),
        damp(this.pivot.z, goalZ, config.followDamp, dt),
      );
    }

    // Over-the-shoulder lateral shift, perpendicular to the boom on the XZ plane.
    const rightX = Math.cos(this.yawAngle);
    const rightZ = -Math.sin(this.yawAngle);
    const shoulderX = rightX * config.shoulderOffset;
    const shoulderZ = rightZ * config.shoulderOffset;

    const originX = this.pivot.x + shoulderX;
    const originY = this.pivot.y;
    const originZ = this.pivot.z + shoulderZ;

    // Sweep the boom the player actually asked for, at their own pitch.
    this.setDirection(this.pitchAngle);
    const nominalAllowed = this.resolveCollision(originX, originY, originZ);

    // Decide the lift from the *nominal* sweep, never from the lifted one. The
    // lifted boom finds more room, which would immediately argue for less lift,
    // which would find less room — a pumping loop. Measuring the unlifted boom
    // keeps the input to this decision independent of its own output.
    const span = config.comfortableDistance - config.minDistance;
    const shortfall = span > 1e-6 ? clamp((config.comfortableDistance - nominalAllowed) / span, 0, 1) : 0;
    // Aim at an absolute pitch, not an offset: when the player looks up their
    // own pitch already points the boom downward into the floor behind them, and
    // adding a constant would leave it there.
    const liftTarget = Math.max(0, config.cornerPitch - this.pitchAngle) * shortfall;
    this.collisionLift = damp(this.collisionLift, liftTarget, config.liftDamp, dt);

    let allowed = nominalAllowed;
    if (this.collisionLift > 1e-3) {
      // Clamped short of vertical: at 90° the boom is directly overhead and
      // `lookAt` loses its up vector.
      this.setDirection(Math.min(this.pitchAngle + this.collisionLift, MAX_EFFECTIVE_PITCH));
      allowed = this.resolveCollision(originX, originY, originZ);
    }

    // Pull in immediately when blocked, ease back out when clear: the reverse
    // makes the camera pop through the wall it has just cleared.
    this.currentDistance =
      allowed < this.currentDistance
        ? allowed
        : damp(this.currentDistance, allowed, config.reboundDamp, dt);

    this.desiredPosition.set(
      originX + this.offsetDirection.x * this.currentDistance,
      originY + this.offsetDirection.y * this.currentDistance,
      originZ + this.offsetDirection.z * this.currentDistance,
    );

    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.set(originX, originY, originZ);
    this.camera.lookAt(this.lookTarget);
  }

  /**
   * Sphere-casts from the pivot along the boom and returns the distance the
   * camera may use.
   *
   * A sphere rather than a ray, because a ray squeezes through the gap between
   * two colliders and lets the near plane clip into geometry.
   *
   * The result is never raised back up toward a preferred distance. Only
   * `minDistance` floors it, and only as a degenerate-case stop — anything more
   * would place the camera behind the surface the sweep just found, which is
   * how a "minimum distance" turns into seeing through walls.
   */
  private resolveCollision(originX: number, originY: number, originZ: number): number {
    const hit = this.physics.sweepSphere(
      { x: originX, y: originY, z: originZ },
      { x: this.offsetDirection.x, y: this.offsetDirection.y, z: this.offsetDirection.z },
      config.collisionRadius,
      config.distance,
      this.ignoredCollider,
    );

    if (hit === null) return config.distance;

    // The floor is itself capped by the contact distance. `minDistance` only
    // stops a degenerate near-zero boom putting the camera at the pivot; it must
    // never be able to place the camera *beyond* what the sweep just hit, which
    // is what pushes it through a wall when the player is cornered.
    const floor = Math.min(config.minDistance, Math.max(hit.distance, 0));
    return clamp(hit.distance - config.collisionPadding, floor, config.distance);
  }

  /** Places the camera without smoothing. Used on spawn so frame one is correct. */
  snapTo(targetX: number, targetY: number, targetZ: number, pivotHeight: number): void {
    this.pivotInitialised = false;
    this.currentDistance = config.distance;
    this.collisionLift = 0;
    this.update(targetX, targetY, targetZ, pivotHeight, 1);
  }

  /** Current boom length in metres, after collision. Development hook. */
  get boomDistance(): number {
    return this.currentDistance;
  }

  /** Extra pitch currently added by collision, radians. Development hook. */
  get lift(): number {
    return this.collisionLift;
  }
}
