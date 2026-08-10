/**
 * The character movement simulation.
 *
 * This is the module `ARCHITECTURE.md` §3.1 exists for: when networking arrives,
 * the client's prediction and the server's authority both call these functions,
 * so there is exactly one implementation of what an input does.
 *
 * Constraints (`ARCHITECTURE.md` §3.2): no DOM, no Three.js, no Rapier, no Node
 * built-ins, no wall-clock reads. Collision response is deliberately *not* here
 * — it belongs to whoever owns the physics world. This module answers "where
 * does the character want to go this tick"; physics answers "where does it
 * actually end up".
 */

import type { PlayerConfig } from "../constants/player.ts";
import { angleDelta, clamp, dampAngle, wrapAngle, type Vec3 } from "../math/index.ts";
import { MovementState, type CharacterSimState, type MoveIntent } from "../types/index.ts";

/**
 * Converts camera-relative input into a world-space direction on the XZ plane.
 *
 * Three.js convention: at yaw 0 a camera looks down −Z, so forward is
 * `(−sin y, 0, −cos y)` and right is `(cos y, 0, −sin y)`.
 */
export function computeWishDirection(
  forward: number,
  right: number,
  cameraYaw: number,
  out: Vec3,
): Vec3 {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);

  const x = -sin * forward + cos * right;
  const z = -cos * forward - sin * right;

  const len = Math.hypot(x, z);
  if (len > 1e-6) {
    out.x = x / len;
    out.z = z / len;
  } else {
    out.x = 0;
    out.z = 0;
  }
  out.y = 0;
  return out;
}

/**
 * The yaw a character must have to face `direction`.
 *
 * Model forward is −Z (`CLAUDE.md` §5), so facing `d` means
 * `(−sin y, −cos y) = (d.x, d.z)`, hence `y = atan2(−d.x, −d.z)`.
 */
export function yawFromDirection(direction: Vec3): number {
  return Math.atan2(-direction.x, -direction.z);
}

/** Which of the four speeds applies, given the current modifiers. */
export function selectTargetSpeed(
  intent: MoveIntent,
  crouching: boolean,
  config: PlayerConfig,
): number {
  // Aiming suppresses sprint rather than stacking with it: a shouldered weapon
  // and a full sprint are mutually exclusive stances, and letting both apply at
  // once makes the transition between them impossible to read.
  const sprinting = intent.sprint && !intent.aim;
  const base = crouching
    ? config.crouchSpeed
    : sprinting
      ? config.sprintSpeed
      : intent.walk
        ? config.walkSpeed
        : config.runSpeed;

  // Guard the multiplier rather than trusting it: it is an input, and a
  // negative or non-finite value would drive the character backwards or NaN the
  // whole simulation.
  const multiplier = Number.isFinite(intent.speedMultiplier)
    ? clamp(intent.speedMultiplier, 0, 1)
    : 1;
  return base * multiplier;
}

/**
 * Locomotion state for animation and the debug HUD. Speed-driven, not
 * timer-driven.
 *
 * `horizontalSpeed` is passed in rather than read from `velocity` so callers can
 * supply the speed actually achieved. A character shoving against a wall has a
 * full-speed velocity vector and zero real motion; animating from the former is
 * what makes a character run on the spot.
 */
export function resolveMovementState(
  horizontalSpeed: number,
  verticalVelocity: number,
  grounded: boolean,
  crouching: boolean,
  config: PlayerConfig,
): MovementState {
  if (!grounded) {
    return verticalVelocity > config.fallVelocityThreshold ? MovementState.Jump : MovementState.Fall;
  }
  if (crouching) return MovementState.Crouch;

  if (horizontalSpeed < config.idleSpeedThreshold) return MovementState.Idle;
  if (horizontalSpeed < config.runSpeedThreshold) return MovementState.Walk;
  if (horizontalSpeed < config.sprintSpeedThreshold) return MovementState.Run;
  return MovementState.Sprint;
}

/**
 * Accelerates horizontal velocity toward the wished-for velocity.
 *
 * Grounded uses a straight move-towards, which gives a firm stop rather than the
 * indefinite slide an exponential decay produces. Airborne blends the target
 * between current momentum and the wish so `airControl` is a real 0..1 knob:
 * at 0 the character keeps its trajectory, at 1 it steers as freely as on foot.
 */
export function accelerateHorizontal(
  velocity: Vec3,
  wishDir: Vec3,
  targetSpeed: number,
  hasInput: boolean,
  grounded: boolean,
  dt: number,
  config: PlayerConfig,
): void {
  let targetX = wishDir.x * targetSpeed;
  let targetZ = wishDir.z * targetSpeed;
  let acceleration: number;

  if (grounded) {
    acceleration = hasInput ? config.groundAcceleration : config.groundDeceleration;
    if (!hasInput) {
      targetX = 0;
      targetZ = 0;
    }
  } else if (hasInput) {
    const t = clamp(config.airControl, 0, 1);
    targetX = velocity.x + (targetX - velocity.x) * t;
    targetZ = velocity.z + (targetZ - velocity.z) * t;
    acceleration = config.airAcceleration;
  } else {
    // No input in the air: keep momentum. Air braking makes jumps feel sticky.
    return;
  }

  const deltaX = targetX - velocity.x;
  const deltaZ = targetZ - velocity.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const maxDelta = acceleration * dt;

  if (distance <= maxDelta || distance < 1e-6) {
    velocity.x = targetX;
    velocity.z = targetZ;
    return;
  }

  velocity.x += (deltaX / distance) * maxDelta;
  velocity.z += (deltaZ / distance) * maxDelta;
}

/** Applies gravity, terminal velocity, and the grounded stick velocity. */
export function applyVerticalMotion(
  velocity: Vec3,
  grounded: boolean,
  dt: number,
  config: PlayerConfig,
): void {
  if (grounded && velocity.y <= 0) {
    velocity.y = config.groundStickVelocity;
    return;
  }
  velocity.y += config.gravity * dt;
  if (velocity.y < config.maxFallSpeed) velocity.y = config.maxFallSpeed;
}

/**
 * Decides whether a jump fires this tick, honouring coyote time and the jump
 * buffer. Returns true when the jump was consumed.
 *
 * Both forgiveness windows exist because a strict `grounded && pressed` test
 * feels broken to a player: it eats jumps pressed a frame before landing and a
 * frame after walking off a ledge.
 */
export function tryConsumeJump(state: CharacterSimState, config: PlayerConfig): boolean {
  const withinCoyote = state.grounded || state.timeSinceGrounded <= config.coyoteTime;
  if (!withinCoyote || state.jumpBufferRemaining <= 0) return false;

  state.velocity.y = config.jumpVelocity;
  state.jumpBufferRemaining = 0;
  state.timeSinceGrounded = Number.POSITIVE_INFINITY;
  state.grounded = false;
  return true;
}

/**
 * Turns the character's legs.
 *
 * Two regimes, which is what separates a polished third-person shooter from a
 * prototype:
 *
 * - **Moving.** The legs follow the direction of travel, or the aim direction
 *   while aiming, so a strafing player keeps the weapon on target.
 * - **Standing.** The legs hold still until the aim swings past a deadzone the
 *   torso can no longer cover, then turn to catch up. Rotating the whole
 *   character toward the camera every frame is what makes a prototype feel like
 *   a turret on a base.
 */
export function resolveFacing(
  state: CharacterSimState,
  intent: MoveIntent,
  hasInput: boolean,
  wishDir: Vec3,
  dt: number,
  config: PlayerConfig,
): void {
  if (hasInput) {
    const target = intent.aim ? intent.cameraYaw : yawFromDirection(wishDir);
    const rate = intent.aim ? config.aimRotationDamp : config.rotationDamp;
    turnToward(state, target, rate, dt, config);
    return;
  }

  const limit = intent.aim ? config.aimYawLimit : config.hipYawLimit;
  const offset = angleDelta(state.yaw, intent.cameraYaw);
  if (Math.abs(offset) <= limit) return;

  // Over-rotate past the limit so the aim does not end up pinned to the edge of
  // the deadzone, where every twitch of the camera would restart the turn.
  const target = intent.cameraYaw - Math.sign(offset) * limit * config.turnRecentre;
  turnToward(state, target, config.turnDamp, dt, config);
}

/**
 * Eases the facing toward `target`, never faster than `maxTurnSpeed`.
 *
 * The damping gives the ease-out; the cap stops the large-error case from
 * starting with a lurch, which is what reads as a snap.
 */
function turnToward(
  state: CharacterSimState,
  target: number,
  rate: number,
  dt: number,
  config: PlayerConfig,
): void {
  const eased = dampAngle(state.yaw, target, rate, dt);
  const step = angleDelta(state.yaw, eased);
  const maxStep = config.maxTurnSpeed * dt;
  state.yaw = wrapAngle(state.yaw + clamp(step, -maxStep, maxStep));
}

const scratchWishDir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Advances one fixed simulation tick and returns the desired displacement.
 *
 * Mutates `state.velocity`, `state.yaw`, `state.movementState` and the jump
 * timers. It does **not** move `state.position` — the caller applies the
 * displacement through collision and writes back the corrected position and
 * grounded flag via {@link commitMovementResult}.
 *
 * `state.crouching` must already be resolved by the caller, because deciding
 * whether standing up is possible needs a headroom query, which is physics.
 */
export function stepCharacterMovement(
  state: CharacterSimState,
  intent: MoveIntent,
  dt: number,
  config: PlayerConfig,
  outDisplacement: Vec3,
): Vec3 {
  state.timeSinceGrounded = state.grounded ? 0 : state.timeSinceGrounded + dt;
  state.jumpBufferRemaining = intent.jump
    ? config.jumpBufferTime
    : Math.max(0, state.jumpBufferRemaining - dt);

  const wishDir = computeWishDirection(intent.forward, intent.right, intent.cameraYaw, scratchWishDir);
  const hasInput = wishDir.x !== 0 || wishDir.z !== 0;
  const targetSpeed = selectTargetSpeed(intent, state.crouching, config);

  accelerateHorizontal(state.velocity, wishDir, targetSpeed, hasInput, state.grounded, dt, config);

  const jumped = tryConsumeJump(state, config);
  if (!jumped) {
    applyVerticalMotion(state.velocity, state.grounded, dt, config);
  }

  resolveFacing(state, intent, hasInput, wishDir, dt, config);

  state.movementState = resolveMovementState(
    Math.hypot(state.velocity.x, state.velocity.z),
    state.velocity.y,
    state.grounded,
    state.crouching,
    config,
  );

  outDisplacement.x = state.velocity.x * dt;
  outDisplacement.y = state.velocity.y * dt;
  outDisplacement.z = state.velocity.z * dt;
  return outDisplacement;
}

/**
 * Writes the result of the collision solve back into the simulation state.
 *
 * Horizontal velocity is deliberately **not** rewritten from the applied
 * displacement. Doing so creates a feedback loop against a blocking surface: the
 * velocity collapses to nearly zero, so the next tick asks the collision solver
 * to move a fraction of a millimetre, so its step-up logic has nothing to work
 * with and the character can never climb a stair it is standing right against.
 * Instead the commanded velocity is left intact — the solver already clamps how
 * far the character actually travels — and `measuredSpeed` records what really
 * happened for animation and the HUD.
 */
export function commitMovementResult(
  state: CharacterSimState,
  appliedDisplacement: Vec3,
  requestedDisplacement: Vec3,
  grounded: boolean,
  dt: number,
  config: PlayerConfig,
): void {
  state.position.x += appliedDisplacement.x;
  state.position.y += appliedDisplacement.y;
  state.position.z += appliedDisplacement.z;

  state.measuredSpeed =
    dt > 0 ? Math.hypot(appliedDisplacement.x, appliedDisplacement.z) / dt : 0;

  // A ceiling is the one case that must feed back: without it the character
  // keeps its upward velocity while pinned under an overhang and hangs there.
  if (state.velocity.y > 0 && appliedDisplacement.y < requestedDisplacement.y - 1e-5) {
    state.velocity.y = 0;
  }

  const wasGrounded = state.grounded;
  state.grounded = grounded;
  if (grounded) {
    state.timeSinceGrounded = 0;
    if (state.velocity.y < 0) state.velocity.y = config.groundStickVelocity;
  } else if (wasGrounded) {
    state.timeSinceGrounded = 0;
  }

  state.movementState = resolveMovementState(
    state.measuredSpeed,
    state.velocity.y,
    state.grounded,
    state.crouching,
    config,
  );
}
