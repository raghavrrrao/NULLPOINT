/**
 * Third-person camera tuning. Centralised for the same reason as PLAYER_CONFIG:
 * the Phase 1 brief requires distance/height/sensitivity to be configurable and
 * not hardcoded into unrelated code.
 */

export interface CameraConfig {
  readonly fov: number;
  readonly near: number;
  readonly far: number;

  /** Boom length behind the pivot, m. Phase 1 brief asks for 4–6 m. */
  readonly distance: number;
  /**
   * Absolute floor on boom length, m. A safety stop only — it exists so a
   * degenerate sweep cannot put the camera inside the character's head.
   *
   * It must stay small, because it is the one place the collision result is
   * overridden. Raising it to enforce a *comfortable* distance would push the
   * camera back through whatever the sweep just hit, and you would see through
   * walls. Comfort is handled by `comfortableDistance` and the lift instead.
   */
  readonly minDistance: number;
  /**
   * Boom length below which the camera starts lifting over the character, m.
   *
   * When geometry stops the boom short of this, the camera rises rather than
   * jamming into the back of the character's head at eye level.
   */
  readonly comfortableDistance: number;
  /**
   * Effective pitch the boom aims for when fully compressed, radians.
   *
   * A target rather than an offset: a fixed offset added to the player's own
   * pitch leaves the camera low whenever they happen to be looking up, which is
   * exactly when it gets pinned against the wall behind them.
   */
  readonly cornerPitch: number;
  /** Rate at which the lift eases in and out. */
  readonly liftDamp: number;
  /** Pivot height above the character's feet while standing, m. */
  readonly pivotHeight: number;
  /** Pivot height above the character's feet while crouched, m. */
  readonly crouchPivotHeight: number;
  /** Lateral offset for the over-the-shoulder framing, m (+ is right). */
  readonly shoulderOffset: number;

  /** Radians of rotation per pixel of mouse movement. */
  readonly sensitivity: number;
  /** Lowest pitch, radians (negative looks down). */
  readonly minPitch: number;
  /** Highest pitch, radians. */
  readonly maxPitch: number;

  /** Rate at which the pivot chases the character. */
  readonly followDamp: number;
  /**
   * Rate at which the boom extends back out after an obstruction clears.
   * Pulling in is instant; easing out prevents the camera popping through a
   * wall it has only just cleared.
   */
  readonly reboundDamp: number;
  /** Radius of the sphere cast used for camera collision, m. */
  readonly collisionRadius: number;
  /** Extra clearance kept between the camera and a surface, m. */
  readonly collisionPadding: number;
}

export const CAMERA_CONFIG: CameraConfig = {
  fov: 72,
  near: 0.1,
  far: 400,

  distance: 5.0,
  minDistance: 0.5,
  comfortableDistance: 2.4,
  // ~72°. Against a tall wall the boom available at pitch p is roughly
  // (gap / cos p), so the angle has to be steep to buy back real distance:
  // at 27° almost nothing is recovered, at 72° it is over three times the gap.
  cornerPitch: 1.25,
  liftDamp: 9,
  pivotHeight: 1.62,
  crouchPivotHeight: 1.02,
  shoulderOffset: 0.55,

  sensitivity: 0.0022,
  minPitch: (-58 * Math.PI) / 180,
  maxPitch: (66 * Math.PI) / 180,

  followDamp: 20,
  reboundDamp: 6,
  collisionRadius: 0.22,
  collisionPadding: 0.1,
};
