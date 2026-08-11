import RAPIER from "@dimforge/rapier3d-compat";

import {
  Button,
  MovementState,
  PLAYER_CONFIG,
  capsuleHalfHeight,
  commitMovementResult,
  createCharacterSimState,
  createMoveIntent,
  stepCharacterMovement,
  vec3,
  type CharacterSimState,
  type InputCommand,
  type MoveIntent,
  type SpawnPoint,
  type Vec3,
} from "@nullpoint/shared";

import type { CharacterBody, ServerWorld } from "./world.ts";

/**
 * A player, as the server sees one.
 *
 * The authoritative half of what `client/src/entities/Player.ts` is: the same
 * `stepCharacterMovement`, the same Rapier kinematic capsule, the same
 * `commitMovementResult`. It has no rendering, no animation and no camera —
 * those are presentation and stay on the client.
 *
 * The movement equations are **not** reimplemented here. They live in
 * `@nullpoint/shared` and both sides run the identical code, which is the whole
 * reason prediction can work in Session C.
 */

const STAND_HALF_HEIGHT = capsuleHalfHeight(PLAYER_CONFIG.standHeight, PLAYER_CONFIG.radius);
const CROUCH_HALF_HEIGHT = capsuleHalfHeight(PLAYER_CONFIG.crouchHeight, PLAYER_CONFIG.radius);

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const UP = { x: 0, y: 1, z: 0 };

export class ServerPlayer {
  readonly playerId: number;
  readonly displayName: string;
  readonly state: CharacterSimState;

  private readonly world: ServerWorld;
  private readonly character: CharacterBody;
  private readonly intent: MoveIntent = createMoveIntent();
  private readonly requested: Vec3 = vec3();
  private readonly applied: Vec3 = vec3();

  /** Highest input sequence actually applied. Echoed back for reconciliation. */
  private lastAppliedSequence = 0;
  /** Aim pitch, radians. Carried for presentation; not used by movement. */
  private aimPitch = 0;
  private aiming = false;

  constructor(
    playerId: number,
    displayName: string,
    world: ServerWorld,
    spawn: SpawnPoint,
  ) {
    this.playerId = playerId;
    this.displayName = displayName;
    this.world = world;

    this.state = createCharacterSimState(spawn.position);
    this.state.yaw = spawn.yaw;

    this.character = world.createCharacterBody(
      spawn.position,
      STAND_HALF_HEIGHT,
      PLAYER_CONFIG.radius,
    );
  }

  get acknowledgedSequence(): number {
    return this.lastAppliedSequence;
  }

  get pitch(): number {
    return this.aimPitch;
  }

  get isAiming(): boolean {
    return this.aiming;
  }

  /**
   * Applies one input command and advances the simulation by one tick.
   *
   * The command's own yaw and pitch are taken as the player's look direction —
   * a client is trusted to say where it is *looking*, because looking is not a
   * gameplay outcome. It is never trusted about where it *is*.
   */
  applyCommand(command: InputCommand, dt: number): void {
    const forward = (command.buttons & Button.Forward ? 1 : 0) - (command.buttons & Button.Back ? 1 : 0);
    const right = (command.buttons & Button.Right ? 1 : 0) - (command.buttons & Button.Left ? 1 : 0);

    this.intent.forward = forward;
    this.intent.right = right;
    this.intent.cameraYaw = command.yaw;
    this.intent.sprint = (command.buttons & Button.Sprint) !== 0;
    this.intent.walk = false;
    this.intent.crouch = (command.buttons & Button.Crouch) !== 0;
    this.intent.aim = (command.buttons & Button.Aim) !== 0;
    this.intent.jump = (command.buttons & Button.Jump) !== 0;
    this.intent.speedMultiplier = 1;

    this.aimPitch = command.pitch;
    this.aiming = this.intent.aim;

    this.simulate(this.intent, dt);
    this.lastAppliedSequence = command.sequence;
  }

  /** Advances with no new input — the player keeps falling and settling. */
  applyIdleTick(dt: number): void {
    this.intent.forward = 0;
    this.intent.right = 0;
    this.intent.jump = false;
    this.simulate(this.intent, dt);
  }

  private simulate(intent: MoveIntent, dt: number): void {
    this.resolveCrouch(intent.crouch);

    stepCharacterMovement(this.state, intent, dt, PLAYER_CONFIG, this.requested);

    this.character.controller.computeColliderMovement(this.character.collider, this.requested);
    const movement = this.character.controller.computedMovement();
    this.applied.x = movement.x;
    this.applied.y = movement.y;
    this.applied.z = movement.z;

    commitMovementResult(
      this.state,
      this.applied,
      this.requested,
      this.character.controller.computedGrounded(),
      dt,
      PLAYER_CONFIG,
    );

    const halfHeight = this.state.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.world.placeCharacter(this.character.body, this.state.position, halfHeight, PLAYER_CONFIG.radius);
  }

  /**
   * Applies the crouch request, refusing to stand under an obstruction.
   *
   * Mirrors the client's rule. The server has the final say: a client that
   * thinks it stood up under a beam is simply wrong, and the next snapshot
   * corrects it.
   */
  private resolveCrouch(wantsCrouch: boolean): void {
    if (wantsCrouch === this.state.crouching) return;
    if (!wantsCrouch && !this.hasHeadroom()) return;

    this.state.crouching = wantsCrouch;
    const halfHeight = wantsCrouch ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.character.collider.setHalfHeight(halfHeight);
    this.world.placeCharacter(this.character.body, this.state.position, halfHeight, PLAYER_CONFIG.radius);
  }

  private hasHeadroom(): boolean {
    const gap = PLAYER_CONFIG.standHeight - PLAYER_CONFIG.crouchHeight;
    if (gap <= 0) return true;

    // A sphere sweep rather than a ray: the capsule has width, and a ray up the
    // centre line happily stands the player into a beam their shoulders hit.
    const origin = {
      x: this.state.position.x,
      y: this.state.position.y + PLAYER_CONFIG.crouchHeight - PLAYER_CONFIG.radius,
      z: this.state.position.z,
    };
    const hit = this.world.world.castShape(
      origin,
      IDENTITY_ROTATION,
      UP,
      new RAPIER.Ball(PLAYER_CONFIG.radius * 0.92),
      0,
      gap,
      true,
      undefined,
      undefined,
      this.character.collider,
    );
    return hit === null;
  }

  /** Teleports to a spawn and clears momentum. Used on join and respawn. */
  respawnAt(spawn: SpawnPoint): void {
    this.state.position.x = spawn.position.x;
    this.state.position.y = spawn.position.y;
    this.state.position.z = spawn.position.z;
    this.state.velocity.x = 0;
    this.state.velocity.y = 0;
    this.state.velocity.z = 0;
    this.state.yaw = spawn.yaw;
    this.state.crouching = false;
    this.state.movementState = MovementState.Idle;
    this.character.collider.setHalfHeight(STAND_HALF_HEIGHT);
    this.world.placeCharacter(
      this.character.body,
      this.state.position,
      STAND_HALF_HEIGHT,
      PLAYER_CONFIG.radius,
    );
  }

  dispose(): void {
    this.world.removeCharacter(this.character);
  }
}
