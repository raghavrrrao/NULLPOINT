import type { Vec3 } from "../math/index.ts";

/**
 * What the player is asking for this tick. Produced by the client's input
 * layer; consumed by the shared movement simulation.
 *
 * Deliberately free of key names and device concepts so that a gamepad, a
 * replay, or (later) a networked input command can produce the same shape.
 */
export interface MoveIntent {
  /** −1 back … +1 forward, camera-relative. */
  forward: number;
  /** −1 left … +1 right, camera-relative. */
  right: number;
  /** Camera yaw in radians; movement is resolved against it. */
  cameraYaw: number;
  sprint: boolean;
  /** Explicit walk modifier — moves at `walkSpeed` instead of `runSpeed`. */
  walk: boolean;
  crouch: boolean;
  /**
   * True while aiming. Turns the character to face the camera rather than the
   * direction of travel, so the weapon points where the player is looking.
   */
  aim: boolean;
  /**
   * Scales the selected movement speed, 1 = unmodified.
   *
   * Carried on the intent rather than read from a weapon, so the movement
   * simulation stays free of any knowledge of weapons.
   */
  speedMultiplier: number;
  /** True only on the tick the jump was requested (edge, not level). */
  jump: boolean;
}

export function createMoveIntent(): MoveIntent {
  return {
    forward: 0,
    right: 0,
    cameraYaw: 0,
    sprint: false,
    walk: false,
    crouch: false,
    aim: false,
    speedMultiplier: 1,
    jump: false,
  };
}

/**
 * Locomotion state. Drives animation selection and the debug HUD.
 *
 * This is a display/animation concept, not a physics concept — the physics
 * state is `CharacterSimState`.
 */
export const MovementState = {
  Idle: "IDLE",
  Walk: "WALK",
  Run: "RUN",
  Sprint: "SPRINT",
  Jump: "JUMP",
  Fall: "FALL",
  Crouch: "CROUCH",
} as const;

export type MovementState = (typeof MovementState)[keyof typeof MovementState];

/** The mutable physical state of a character. Owned by whoever simulates it. */
export interface CharacterSimState {
  /** World-space position of the character's feet. */
  position: Vec3;
  /** World-space velocity, m/s. */
  velocity: Vec3;
  /** Facing angle in radians, Y-up. Model forward is −Z. */
  yaw: number;
  grounded: boolean;
  crouching: boolean;
  /**
   * Horizontal speed the character actually achieved last tick, m/s.
   *
   * Distinct from `velocity`, which is what the character is *trying* to do.
   * Pressed against a wall the two diverge, and animation and the HUD must
   * follow this one or the character runs on the spot.
   */
  measuredSpeed: number;
  /** Seconds since the character was last grounded. Used for coyote time. */
  timeSinceGrounded: number;
  /** Seconds remaining in which a buffered jump may still fire. */
  jumpBufferRemaining: number;
  movementState: MovementState;
}

export function createCharacterSimState(position: Vec3): CharacterSimState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    grounded: false,
    crouching: false,
    measuredSpeed: 0,
    timeSinceGrounded: Number.POSITIVE_INFINITY,
    jumpBufferRemaining: 0,
    movementState: MovementState.Fall,
  };
}
