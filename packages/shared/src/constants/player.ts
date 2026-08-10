/**
 * Every tunable number for character movement and shape.
 *
 * `CLAUDE.md` §5 and the Phase 1 brief both require these to be centralised —
 * no magic numbers in the controller, the animation system, or the collider
 * setup. Units are metres, seconds, radians (`CLAUDE.md` §5).
 */

export interface PlayerConfig {
  /** Speed with the walk modifier held, m/s. */
  readonly walkSpeed: number;
  /** Default movement speed, m/s. */
  readonly runSpeed: number;
  /** Speed with sprint held, m/s. */
  readonly sprintSpeed: number;
  /** Speed while crouched, m/s. */
  readonly crouchSpeed: number;

  /** Horizontal acceleration while grounded, m/s². */
  readonly groundAcceleration: number;
  /** Horizontal deceleration while grounded with no input, m/s². */
  readonly groundDeceleration: number;
  /** Horizontal acceleration while airborne, m/s². */
  readonly airAcceleration: number;
  /** Fraction of ground control retained in the air, 0..1. */
  readonly airControl: number;

  /** Downward acceleration, m/s². Larger than real gravity for jump feel. */
  readonly gravity: number;
  /** Terminal velocity, m/s (negative). */
  readonly maxFallSpeed: number;
  /**
   * Constant downward velocity applied while grounded, m/s. Keeps the capsule
   * pressed into the floor so Rapier's ground snapping holds contact when
   * walking down slopes and steps instead of launching off them.
   */
  readonly groundStickVelocity: number;
  /** Upward launch velocity on jump, m/s. */
  readonly jumpVelocity: number;
  /** Grace period after leaving ground where a jump still works, seconds. */
  readonly coyoteTime: number;
  /** How long a jump pressed before landing stays queued, seconds. */
  readonly jumpBufferTime: number;

  /** Exponential rate at which the character turns to face movement. */
  readonly rotationDamp: number;
  /** Exponential rate at which the character turns to face the aim direction. */
  readonly aimRotationDamp: number;
  /**
   * How far the aim may swing from the character's facing before the legs turn
   * while aiming, radians.
   *
   * Inside this the torso absorbs the difference and the legs hold still, which
   * is what stops a third-person character spinning like a turret every time the
   * camera moves.
   */
  readonly aimYawLimit: number;
  /** The same deadzone while not aiming. Wider: the character is relaxed. */
  readonly hipYawLimit: number;
  /**
   * Fraction of the limit the body over-rotates past once it starts turning.
   *
   * Turning only back to the limit leaves the aim pinned to the edge of the
   * deadzone, so the legs stutter on every small camera movement.
   */
  readonly turnRecentre: number;
  /** Rate the legs turn once the deadzone is exceeded. */
  readonly turnDamp: number;
  /**
   * Hard ceiling on how fast the character may turn, radians per second.
   *
   * Exponential damping alone is proportional to the error, so a 170° swing
   * starts with a lurch. Capping the rate is what keeps a large turn readable
   * instead of a snap.
   */
  readonly maxTurnSpeed: number;

  /** Capsule radius, m. */
  readonly radius: number;
  /** Total capsule height standing, m. */
  readonly standHeight: number;
  /** Total capsule height crouched, m. */
  readonly crouchHeight: number;
  /** Rate at which the collider and camera pivot interpolate on crouch. */
  readonly crouchDamp: number;

  /** Maximum step height the controller will climb, m. */
  readonly stepHeight: number;
  /** Minimum step width required to autostep, m. */
  readonly stepMinWidth: number;
  /** Steepest slope that can be walked up, radians. */
  readonly maxSlopeClimbAngle: number;
  /** Slopes steeper than this cause sliding, radians. */
  readonly minSlopeSlideAngle: number;
  /** Distance the controller snaps down to keep contact on descents, m. */
  readonly snapToGroundDistance: number;
  /** Collide-and-slide skin width, m. */
  readonly colliderOffset: number;

  /** Horizontal speed above which locomotion leaves IDLE, m/s. */
  readonly idleSpeedThreshold: number;
  /** Horizontal speed at which WALK becomes RUN, m/s. */
  readonly runSpeedThreshold: number;
  /** Horizontal speed at which RUN becomes SPRINT, m/s. */
  readonly sprintSpeedThreshold: number;
  /** Downward velocity below which JUMP becomes FALL, m/s. */
  readonly fallVelocityThreshold: number;
}

export const PLAYER_CONFIG: PlayerConfig = {
  walkSpeed: 2.0,
  runSpeed: 5.2,
  sprintSpeed: 8.0,
  crouchSpeed: 1.7,

  groundAcceleration: 55,
  groundDeceleration: 65,
  airAcceleration: 14,
  airControl: 0.45,

  // Heavier than 9.81 m/s²: real gravity makes a 1.2 m jump feel floaty at this
  // scale. Paired with jumpVelocity below it gives a ~0.63 s airtime arc.
  gravity: -24,
  maxFallSpeed: -55,
  groundStickVelocity: -2,
  jumpVelocity: 7.6,
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,

  rotationDamp: 16,
  aimRotationDamp: 14,
  aimYawLimit: (48 * Math.PI) / 180,
  hipYawLimit: (85 * Math.PI) / 180,
  turnRecentre: 0.45,
  turnDamp: 9,
  maxTurnSpeed: 5.0,

  radius: 0.34,
  standHeight: 1.8,
  crouchHeight: 1.15,
  crouchDamp: 14,

  stepHeight: 0.45,
  stepMinWidth: 0.25,
  maxSlopeClimbAngle: (50 * Math.PI) / 180,
  minSlopeSlideAngle: (38 * Math.PI) / 180,
  snapToGroundDistance: 0.4,
  colliderOffset: 0.02,

  idleSpeedThreshold: 0.35,
  runSpeedThreshold: 3.1,
  sprintSpeedThreshold: 6.3,
  fallVelocityThreshold: -0.6,
};

/**
 * Rapier capsules are described by the half-height of the *cylindrical* section,
 * excluding the two hemispherical caps. Deriving it here keeps the conversion in
 * one place instead of in the collider setup.
 */
export function capsuleHalfHeight(totalHeight: number, radius: number): number {
  return Math.max(0.01, totalHeight / 2 - radius);
}
