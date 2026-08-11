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

  /**
   * Aim blend, 0 = hip, 1 = fully aimed. Drives boom length, shoulder offset,
   * pivot height and field of view together so the transition reads as one move.
   */
  private aimBlend = 0;
  private aimHeld = false;

  /**
   * Recoil applied to the *view* only, radians.
   *
   * Added on top of the player's own pitch and yaw rather than written into
   * them, so the view climbs while firing and returns by itself. Writing it into
   * `pitchAngle` would make every burst permanently re-aim the player.
   */
  private recoilPitch = 0;
  private recoilYaw = 0;

  /** Excludes a collider — the followed character — from camera collision. */
  ignoreCollider(collider: RAPIER.Collider): void {
    this.ignoredCollider = collider;
  }

  /** Requests the aim framing. Blended over several frames, never snapped. */
  setAiming(aiming: boolean): void {
    this.aimHeld = aiming;
  }

  /** Sets the current view recoil offset, radians. */
  setRecoil(pitch: number, yaw: number): void {
    this.recoilPitch = pitch;
    this.recoilYaw = yaw;
  }

  /** 0 = hip, 1 = fully aimed. */
  get aimAmount(): number {
    return this.aimBlend;
  }

  /**
   * Yaw actually used for the view this frame, including recoil.
   *
   * Movement is resolved against this rather than the raw stored yaw so that
   * the character continues to move where the player is looking while the
   * weapon is climbing.
   */
  get viewYaw(): number {
    return wrapAngle(this.viewYawUnbounded);
  }

  /**
   * The same view yaw, **not** normalised.
   *
   * Rendering uses this and gameplay uses the wrapped {@link viewYaw}. An Euler
   * angle of 7π and one of π describe the same orientation, so normalising is
   * invisible in a still frame — but it puts a ±2π step in the *value*, and any
   * consumer that ever interpolates or damps that value would sweep the long way
   * round and produce exactly the snap this camera must never have. Keeping the
   * rendered angle unbounded means no such seam can be introduced by accident.
   */
  private get viewYawUnbounded(): number {
    return this.yawAngle + this.recoilYaw;
  }

  /** Pitch actually used for the view this frame, including recoil. */
  get viewPitch(): number {
    return clamp(this.pitchAngle - this.recoilPitch, config.minPitch, config.maxPitch);
  }

  /** Points the boom from the pivot toward the camera at `pitch`. */
  private setDirection(pitch: number): void {
    const yaw = this.viewYawUnbounded;
    const cosPitch = Math.cos(pitch);
    this.offsetDirection.set(
      Math.sin(yaw) * cosPitch,
      Math.sin(pitch),
      Math.cos(yaw) * cosPitch,
    );
  }

  /**
   * Accumulated horizontal look, radians. **Unbounded and never reset.**
   *
   * Turning right past a full circle continues to 2π, 4π and beyond rather than
   * wrapping to −π, so the value is monotonic while the player keeps turning the
   * same way. That is what makes "rotate 1080° and check nothing snapped" a
   * question this code can answer.
   */
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
    // Deliberately not wrapped. Horizontal look is unlimited: it accumulates for
    // as long as the player keeps moving the mouse, in either direction.
    this.yawAngle -= deltaX * config.sensitivity;
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
    this.aimBlend = damp(this.aimBlend, this.aimHeld ? 1 : 0, config.aimTransitionRate, dt);
    const t = this.aimBlend;

    // Boom, shoulder, pivot height and field of view all move together, so the
    // aim transition reads as one motion rather than four independent ones.
    const baseDistance = config.distance + (config.aimDistance - config.distance) * t;
    const shoulderOffset =
      config.shoulderOffset + (config.aimShoulderOffset - config.shoulderOffset) * t;
    const fov = config.fov + (config.aimFov - config.fov) * t;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const goalX = targetX;
    const goalY = targetY + pivotHeight + config.aimPivotLift * t;
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
    const viewYaw = this.viewYawUnbounded;
    const rightX = Math.cos(viewYaw);
    const rightZ = -Math.sin(viewYaw);
    const shoulderX = rightX * shoulderOffset;
    const shoulderZ = rightZ * shoulderOffset;

    const originX = this.pivot.x + shoulderX;
    const originY = this.pivot.y;
    const originZ = this.pivot.z + shoulderZ;

    // Sweep the boom the player actually asked for, at their own pitch.
    const viewPitch = this.viewPitch;
    this.setDirection(viewPitch);
    const nominalAllowed = this.resolveCollision(originX, originY, originZ, baseDistance);

    // Decide the lift from the *nominal* sweep, never from the lifted one. The
    // lifted boom finds more room, which would immediately argue for less lift,
    // which would find less room — a pumping loop. Measuring the unlifted boom
    // keeps the input to this decision independent of its own output.
    // The comfort threshold is capped by the boom length actually wanted. Aiming
    // deliberately shortens the boom to 2.1 m; measured against a fixed 2.4 m
    // that looked like an obstruction, so the anti-corner lift fired on every
    // aim and tilted the view 13° up — throwing the shot off the crosshair.
    const comfortable = Math.min(config.comfortableDistance, baseDistance);
    const span = comfortable - config.minDistance;
    const shortfall = span > 1e-6 ? clamp((comfortable - nominalAllowed) / span, 0, 1) : 0;
    // Aim at an absolute pitch, not an offset: when the player looks up their
    // own pitch already points the boom downward into the floor behind them, and
    // adding a constant would leave it there.
    const liftTarget = Math.max(0, config.cornerPitch - viewPitch) * shortfall;
    this.collisionLift = damp(this.collisionLift, liftTarget, config.liftDamp, dt);

    let allowed = nominalAllowed;
    if (this.collisionLift > 1e-3) {
      // Clamped short of vertical: at 90° the boom is directly overhead and
      // `lookAt` loses its up vector.
      this.setDirection(Math.min(viewPitch + this.collisionLift, MAX_EFFECTIVE_PITCH));
      allowed = this.resolveCollision(originX, originY, originZ, baseDistance);
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

    // Orientation comes from yaw and pitch directly, never from looking at the
    // pivot. With a lateral shoulder offset, "look at the pivot" makes the view
    // direction depend on boom length — so entering aim, which shortens the boom
    // and widens the offset, silently rotated the crosshair off whatever the
    // player had it on. Screen centre must mean the aim direction and nothing
    // else, because that is what hitscan traces along.
    //
    // The collision lift is folded in so that when the boom climbs over the
    // character while cornered, the view tilts down to keep them in frame.
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(-(this.viewPitch + this.collisionLift), this.viewYawUnbounded, 0);
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
  private resolveCollision(
    originX: number,
    originY: number,
    originZ: number,
    maxDistance: number,
  ): number {
    const hit = this.physics.sweepSphere(
      { x: originX, y: originY, z: originZ },
      { x: this.offsetDirection.x, y: this.offsetDirection.y, z: this.offsetDirection.z },
      config.collisionRadius,
      maxDistance,
      this.ignoredCollider,
    );

    if (hit === null) return maxDistance;

    // The floor is itself capped by the contact distance. `minDistance` only
    // stops a degenerate near-zero boom putting the camera at the pivot; it must
    // never be able to place the camera *beyond* what the sweep just hit, which
    // is what pushes it through a wall when the player is cornered.
    const floor = Math.min(config.minDistance, Math.max(hit.distance, 0));
    return clamp(hit.distance - config.collisionPadding, floor, maxDistance);
  }

  /** Places the camera without smoothing. Used on spawn so frame one is correct. */
  snapTo(targetX: number, targetY: number, targetZ: number, pivotHeight: number): void {
    this.pivotInitialised = false;
    this.currentDistance = config.distance;
    this.collisionLift = 0;
    this.aimBlend = this.aimHeld ? 1 : 0;
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
