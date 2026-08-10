import * as THREE from "three";

import { CAMERA_CONFIG, clamp, damp, wrapAngle } from "@nullpoint/shared";

import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";

const config = CAMERA_CONFIG;

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

  constructor(camera: THREE.PerspectiveCamera, physics: PhysicsWorld) {
    this.camera = camera;
    this.physics = physics;
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

    // Boom direction from pivot to camera: behind the character (+Z rotated by
    // yaw) and lifted by pitch.
    const cosPitch = Math.cos(this.pitchAngle);
    this.offsetDirection.set(
      Math.sin(this.yawAngle) * cosPitch,
      Math.sin(this.pitchAngle),
      Math.cos(this.yawAngle) * cosPitch,
    );

    // Over-the-shoulder lateral shift, perpendicular to the boom on the XZ plane.
    const rightX = Math.cos(this.yawAngle);
    const rightZ = -Math.sin(this.yawAngle);
    const shoulderX = rightX * config.shoulderOffset;
    const shoulderZ = rightZ * config.shoulderOffset;

    const originX = this.pivot.x + shoulderX;
    const originY = this.pivot.y;
    const originZ = this.pivot.z + shoulderZ;

    const allowed = this.resolveCollision(originX, originY, originZ);

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
   */
  private resolveCollision(originX: number, originY: number, originZ: number): number {
    const hit = this.physics.sweepSphere(
      { x: originX, y: originY, z: originZ },
      { x: this.offsetDirection.x, y: this.offsetDirection.y, z: this.offsetDirection.z },
      config.collisionRadius,
      config.distance,
    );

    if (hit === null) return config.distance;
    return clamp(hit.distance - config.collisionPadding, config.minDistance, config.distance);
  }

  /** Places the camera without smoothing. Used on spawn so frame one is correct. */
  snapTo(targetX: number, targetY: number, targetZ: number, pivotHeight: number): void {
    this.pivotInitialised = false;
    this.currentDistance = config.distance;
    this.update(targetX, targetY, targetZ, pivotHeight, 1);
  }
}
