import type * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
  MovementState,
  PLAYER_CONFIG,
  capsuleHalfHeight,
  commitMovementResult,
  createCharacterSimState,
  damp,
  stepCharacterMovement,
  vec3,
  wrapAngle,
  type CharacterSimState,
  type MoveIntent,
  type Vec3,
} from "@nullpoint/shared";

import { AnimationController } from "../character/AnimationController.ts";
import type { CharacterAsset } from "../character/CharacterAsset.ts";
import { WeaponPose } from "../character/weaponPose.ts";
import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";

const config = PLAYER_CONFIG;

const STAND_HALF_HEIGHT = capsuleHalfHeight(config.standHeight, config.radius);
const CROUCH_HALF_HEIGHT = capsuleHalfHeight(config.crouchHeight, config.radius);

/**
 * The local player: simulation state, its Rapier capsule, and its visual rig.
 *
 * The movement maths deliberately lives in `@nullpoint/shared`; this class only
 * connects it to the physics world and the renderer. When the server arrives it
 * runs the same `stepCharacterMovement` against its own Rapier world
 * (`ARCHITECTURE.md` §3.1).
 */
export class Player {
  readonly state: CharacterSimState;
  readonly object: THREE.Object3D;

  private readonly physics: PhysicsWorld;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly animation: AnimationController;
  private readonly asset: CharacterAsset;
  private readonly pose: WeaponPose | null;
  private readonly weaponJoint: THREE.Object3D;

  private readonly requested: Vec3 = vec3();
  private readonly applied: Vec3 = vec3();

  /** Render interpolation: the previous and current fixed-tick poses. */
  private previousPosition: Vec3 = vec3();
  private previousYaw = 0;
  private renderYaw = 0;

  /** Smoothed capsule height, used only to drive the camera pivot. */
  private visualCrouchBlend = 0;

  constructor(physics: PhysicsWorld, asset: CharacterAsset, spawn: Vec3) {
    this.physics = physics;
    this.asset = asset;

    this.state = createCharacterSimState(spawn);
    this.previousPosition = { ...spawn };

    const created = physics.createCharacterBody(spawn, STAND_HALF_HEIGHT, config.radius);
    this.body = created.body;
    this.collider = created.collider;
    this.controller = physics.createCharacterController();

    this.object = new THREE.Object3D();
    this.object.name = "player";
    this.object.add(asset.root);
    this.object.position.set(spawn.x, spawn.y, spawn.z);

    this.animation = new AnimationController(asset);

    // The weapon mounts on the chest joint the rig provides. A GLB without one
    // falls back to the character root, so the weapon is still visible and still
    // follows the character.
    this.weaponJoint = asset.rig?.weaponMount ?? asset.root;
    this.pose = asset.rig !== null ? new WeaponPose(asset.rig) : null;
  }

  /** Joint a weapon should be parented to. */
  get weaponAttachment(): THREE.Object3D {
    return this.weaponJoint;
  }

  /** 0 = carrying, 1 = fully aimed. */
  get aimBlend(): number {
    return this.pose?.aimBlend ?? 0;
  }

  /**
   * Applies the upper-body weapon pose.
   *
   * Called after {@link render} so it overrides the bones the animation mixer
   * has just written, leaving the legs to the locomotion clips.
   */
  applyWeaponPose(
    aiming: boolean,
    yawOffset: number,
    pitch: number,
    recoilPitch: number,
    dt: number,
  ): void {
    this.pose?.apply(aiming, yawOffset, pitch, recoilPitch, dt);
  }

  /**
   * The player's own capsule.
   *
   * Exposed so the camera can exclude it from its collision sweep — the sweep
   * starts inside the character, so without this it collides with the player.
   */
  get characterCollider(): RAPIER.Collider {
    return this.collider;
  }

  get position(): Readonly<Vec3> {
    return this.state.position;
  }

  get velocity(): Readonly<Vec3> {
    return this.state.velocity;
  }

  get movementState(): MovementState {
    return this.state.movementState;
  }

  get grounded(): boolean {
    return this.state.grounded;
  }

  get isCrouching(): boolean {
    return this.state.crouching;
  }

  /** Speed actually achieved last tick — drives animation, not commanded speed. */
  get horizontalSpeed(): number {
    return this.state.measuredSpeed;
  }

  /** Camera pivot height, following the crouch blend rather than snapping. */
  pivotHeight(standing: number, crouched: number): number {
    return standing + (crouched - standing) * this.visualCrouchBlend;
  }

  /**
   * Advances one fixed simulation tick.
   *
   * Order matters: crouch is resolved first because it changes the collider that
   * the movement solve runs against.
   */
  fixedUpdate(intent: MoveIntent, dt: number): void {
    this.previousPosition.x = this.state.position.x;
    this.previousPosition.y = this.state.position.y;
    this.previousPosition.z = this.state.position.z;
    this.previousYaw = this.state.yaw;

    this.resolveCrouch(intent.crouch);

    stepCharacterMovement(this.state, intent, dt, config, this.requested);

    this.controller.computeColliderMovement(this.collider, this.requested);
    const movement = this.controller.computedMovement();
    this.applied.x = movement.x;
    this.applied.y = movement.y;
    this.applied.z = movement.z;

    commitMovementResult(
      this.state,
      this.applied,
      this.requested,
      this.controller.computedGrounded(),
      dt,
      config,
    );

    const halfHeight = this.state.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.body.setNextKinematicTranslation({
      x: this.state.position.x,
      y: this.state.position.y + halfHeight + config.radius,
      z: this.state.position.z,
    });
  }

  /**
   * Applies the crouch request, refusing to stand up when something is overhead.
   *
   * The headroom test is a sphere sweep rather than a ray because the capsule has
   * width: a ray up the centre line happily stands the player into a beam their
   * shoulders would hit.
   */
  private resolveCrouch(wantsCrouch: boolean): void {
    if (wantsCrouch === this.state.crouching) return;

    if (!wantsCrouch && !this.hasHeadroomToStand()) return;

    this.state.crouching = wantsCrouch;
    const halfHeight = wantsCrouch ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.collider.setHalfHeight(halfHeight);
    // The capsule is centred on the body, so resizing it about a fixed centre
    // would sink the feet into the floor. Re-anchor to the feet instead.
    this.body.setTranslation(
      {
        x: this.state.position.x,
        y: this.state.position.y + halfHeight + config.radius,
        z: this.state.position.z,
      },
      true,
    );
  }

  private hasHeadroomToStand(): boolean {
    const gap = config.standHeight - config.crouchHeight;
    if (gap <= 0) return true;

    // Start at the crouched capsule's top sphere centre and sweep up by the
    // height difference. A slightly smaller radius avoids grazing walls the
    // player is legitimately standing against.
    const origin = {
      x: this.state.position.x,
      y: this.state.position.y + config.crouchHeight - config.radius,
      z: this.state.position.z,
    };
    const hit = this.physics.sweepSphere(
      origin,
      { x: 0, y: 1, z: 0 },
      config.radius * 0.92,
      gap,
      this.collider,
    );
    return hit === null;
  }

  /**
   * Updates the visual transform between fixed ticks.
   *
   * @param alpha Fraction through the current tick, 0..1.
   * @param dt    Real frame delta, seconds.
   */
  render(alpha: number, dt: number): void {
    this.object.position.set(
      this.previousPosition.x + (this.state.position.x - this.previousPosition.x) * alpha,
      this.previousPosition.y + (this.state.position.y - this.previousPosition.y) * alpha,
      this.previousPosition.z + (this.state.position.z - this.previousPosition.z) * alpha,
    );

    // Interpolating yaw needs the short-way-around form, or the character
    // spins the wrong way through the ±π seam.
    const delta = wrapAngle(this.state.yaw - this.previousYaw);
    this.renderYaw = wrapAngle(this.previousYaw + delta * alpha);
    this.object.rotation.y = this.renderYaw;

    this.visualCrouchBlend = damp(this.visualCrouchBlend, this.state.crouching ? 1 : 0, config.crouchDamp, dt);

    this.animation.update(this.state.movementState, this.horizontalSpeed, dt);
  }

  dispose(): void {
    this.animation.dispose();
    this.asset.dispose();
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeCollider(this.collider, false);
    this.physics.world.removeRigidBody(this.body);
  }
}
