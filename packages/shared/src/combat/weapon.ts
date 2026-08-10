/**
 * Weapon data.
 *
 * Every number that describes how a weapon behaves lives in a
 * `WeaponDefinition`, never in the firing code. Adding a second weapon in a
 * later phase must mean adding a definition, not touching the combat system
 * (Phase 2 brief §4).
 *
 * Units follow `CLAUDE.md` §5: metres, seconds, radians.
 */

export const FireMode = {
  Automatic: "AUTOMATIC",
  SemiAutomatic: "SEMI_AUTOMATIC",
} as const;

export type FireMode = (typeof FireMode)[keyof typeof FireMode];

export interface RecoilProfile {
  /** Upward kick applied per shot, radians. */
  readonly pitchPerShot: number;
  /** Sideways kick applied per shot, radians. */
  readonly yawPerShot: number;
  /**
   * Fraction of `yawPerShot` that varies per shot, 0..1.
   *
   * Kept deliberately small and bounded: the brief requires recoil that is
   * noticeable but still predictable enough to test and to control.
   */
  readonly yawVariance: number;
  /** Exponential rate at which accumulated recoil returns to zero. */
  readonly recoveryRate: number;
  /** Ceiling on accumulated recoil pitch, radians. */
  readonly maxPitch: number;
  /** Backward travel of the weapon model per shot, m. */
  readonly kickBack: number;
}

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;

  /** Damage at or inside `falloffStart`, hit points. */
  readonly damage: number;
  /** Rounds per minute. Converted to an interval by `secondsPerShot`. */
  readonly fireRateRpm: number;
  readonly fireMode: FireMode;

  readonly magazineSize: number;
  /** Rounds held outside the magazine at spawn. */
  readonly reserveAmmo: number;
  readonly reloadSeconds: number;

  /** Maximum hitscan distance, m. Beyond this a shot hits nothing. */
  readonly range: number;
  /** Distance at which damage begins to drop off, m. */
  readonly falloffStart: number;
  /** Damage multiplier at `range`, 0..1. Interpolated from `falloffStart`. */
  readonly falloffMinMultiplier: number;

  /** Cone half-angle when firing from the hip, radians. */
  readonly hipSpread: number;
  /** Cone half-angle when aiming, radians. */
  readonly aimSpread: number;

  readonly recoil: RecoilProfile;

  /** Muzzle offset from the weapon's origin, m, in weapon-local space. */
  readonly muzzleOffset: readonly [number, number, number];
  /** How long the muzzle flash is visible, seconds. */
  readonly muzzleFlashSeconds: number;

  /** Movement speed multiplier applied while aiming. */
  readonly aimMoveSpeedMultiplier: number;
}

/**
 * The Phase 2 rifle — the only weapon in the game.
 *
 * 700 RPM and 25 damage means a 100 HP training target dies in four hits, which
 * keeps the damage assertions in the tests exact rather than approximate.
 */
export const ASSAULT_RIFLE: WeaponDefinition = {
  id: "ASSAULT_RIFLE",
  name: "Assault Rifle",

  damage: 25,
  fireRateRpm: 700,
  fireMode: FireMode.Automatic,

  magazineSize: 30,
  reserveAmmo: 120,
  reloadSeconds: 2.1,

  range: 120,
  falloffStart: 40,
  falloffMinMultiplier: 0.55,

  hipSpread: 0.038,
  aimSpread: 0.006,

  recoil: {
    pitchPerShot: 0.013,
    yawPerShot: 0.0035,
    yawVariance: 0.6,
    recoveryRate: 7,
    maxPitch: 0.24,
    kickBack: 0.045,
  },

  muzzleOffset: [0, 0.055, -0.62],
  muzzleFlashSeconds: 0.045,

  aimMoveSpeedMultiplier: 0.55,
};

/** Minimum interval between shots, seconds. */
export function secondsPerShot(definition: WeaponDefinition): number {
  if (definition.fireRateRpm <= 0) return Number.POSITIVE_INFINITY;
  return 60 / definition.fireRateRpm;
}

/** Cone half-angle currently in effect, radians. */
export function spreadFor(definition: WeaponDefinition, aiming: boolean): number {
  return aiming ? definition.aimSpread : definition.hipSpread;
}
