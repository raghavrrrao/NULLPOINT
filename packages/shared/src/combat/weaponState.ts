import { secondsPerShot, type WeaponDefinition } from "./weapon.ts";

/**
 * The weapon state machine.
 *
 * An explicit state plus explicit guards, not a scatter of booleans
 * (Phase 2 brief §16). Every rule about when firing is allowed lives in
 * `canFire`; every rule about reloading lives in `canReload`. Nothing else in
 * the codebase is permitted to decide those questions.
 *
 * Pure and clock-free: `stepWeapon` is driven by an injected `dt`, so it runs
 * identically in a unit test, in the browser, and — in a later phase — on a
 * server that does not trust the client (`ARCHITECTURE.md` §6).
 */

export const WeaponState = {
  Idle: "IDLE",
  Firing: "FIRING",
  Reloading: "RELOADING",
  Empty: "EMPTY",
} as const;

export type WeaponState = (typeof WeaponState)[keyof typeof WeaponState];

export interface WeaponRuntime {
  state: WeaponState;
  /** Rounds in the magazine. */
  magazine: number;
  /** Rounds held outside the magazine. */
  reserve: number;
  /** Seconds until the next shot is permitted. */
  cooldown: number;
  /** Seconds left in the current reload, 0 when not reloading. */
  reloadRemaining: number;
  /** True while the aim button is held. Orthogonal to `state` by design. */
  aiming: boolean;
  /** Seconds since the most recent shot. Drives muzzle flash and recoil. */
  timeSinceShot: number;
  /** Shots fired over the whole session. Diagnostics only. */
  shotsFired: number;
}

/** What the player is asking the weapon to do this tick. */
export interface WeaponInput {
  /** True on the tick the fire button went down. */
  firePressed: boolean;
  /** True while the fire button is held. */
  fireHeld: boolean;
  /** True on the tick the reload button went down. */
  reloadPressed: boolean;
  /** True while the aim button is held. */
  aimHeld: boolean;
}

/** What happened during one weapon tick. */
export interface WeaponTickResult {
  /** Shots to resolve this tick. Can exceed 1 only if dt spans several intervals. */
  shotsFired: number;
  /** A reload finished this tick. */
  reloadCompleted: boolean;
  /** A reload started this tick. */
  reloadStarted: boolean;
  /** Fire was requested but the magazine is empty — play the dry click. */
  dryFired: boolean;
}

export function createWeaponRuntime(definition: WeaponDefinition): WeaponRuntime {
  return {
    state: WeaponState.Idle,
    magazine: definition.magazineSize,
    reserve: definition.reserveAmmo,
    cooldown: 0,
    reloadRemaining: 0,
    aiming: false,
    timeSinceShot: Number.POSITIVE_INFINITY,
    shotsFired: 0,
  };
}

export function createWeaponInput(): WeaponInput {
  return { firePressed: false, fireHeld: false, reloadPressed: false, aimHeld: false };
}

/** True when the weapon may fire right now. The single authority on this. */
export function canFire(runtime: WeaponRuntime): boolean {
  return (
    runtime.state !== WeaponState.Reloading &&
    runtime.magazine > 0 &&
    runtime.cooldown <= 0
  );
}

/**
 * True when a reload would achieve something.
 *
 * A full magazine or an empty reserve both make it pointless, and reloading
 * during a reload is not a thing.
 */
export function canReload(runtime: WeaponRuntime, definition: WeaponDefinition): boolean {
  return (
    runtime.state !== WeaponState.Reloading &&
    runtime.magazine < definition.magazineSize &&
    runtime.reserve > 0
  );
}

/**
 * How a reload redistributes ammunition.
 *
 * Split out from the state machine so the arithmetic — including the
 * insufficient-reserve case — is testable on its own.
 */
export function computeReloadTransfer(
  magazine: number,
  reserve: number,
  magazineSize: number,
): { magazine: number; reserve: number } {
  const wanted = Math.max(0, magazineSize - magazine);
  const moved = Math.min(wanted, Math.max(0, reserve));
  return { magazine: magazine + moved, reserve: reserve - moved };
}

/**
 * Discards negative cooldown credit.
 *
 * While the trigger is down the overshoot is carried so the fire rate stays
 * exact. While it is up, carrying it would let a player bank credit by waiting
 * and then loose several rounds instantly on the next press.
 */
function bankCooldown(runtime: WeaponRuntime): void {
  if (runtime.cooldown < 0) runtime.cooldown = 0;
}

/** The state a non-reloading weapon should be resting in. */
function restingState(runtime: WeaponRuntime): WeaponState {
  return runtime.magazine > 0 ? WeaponState.Idle : WeaponState.Empty;
}

/**
 * Advances the weapon by `dt` seconds and reports what happened.
 *
 * Fire rate is enforced by a cooldown accumulator rather than a timer, so it is
 * frame-rate independent and deterministic: the same input over the same dt
 * always produces the same number of shots.
 */
export function stepWeapon(
  runtime: WeaponRuntime,
  input: WeaponInput,
  dt: number,
  definition: WeaponDefinition,
): WeaponTickResult {
  const result: WeaponTickResult = {
    shotsFired: 0,
    reloadCompleted: false,
    reloadStarted: false,
    dryFired: false,
  };

  runtime.aiming = input.aimHeld;
  runtime.timeSinceShot += dt;
  // Deliberately not clamped at zero. Clamping discards the sub-tick remainder,
  // which quantises the interval up to a whole frame and drops the real rate to
  // whatever divides evenly into the frame time — 700 RPM became 600 at 60 Hz.
  // The overshoot is carried instead, and `bankCooldown` stops it accumulating
  // into a burst while the trigger is released.
  runtime.cooldown -= dt;

  if (runtime.state === WeaponState.Reloading) {
    runtime.reloadRemaining -= dt;
    if (runtime.reloadRemaining <= 0) {
      const transferred = computeReloadTransfer(
        runtime.magazine,
        runtime.reserve,
        definition.magazineSize,
      );
      runtime.magazine = transferred.magazine;
      runtime.reserve = transferred.reserve;
      runtime.reloadRemaining = 0;
      runtime.state = restingState(runtime);
      result.reloadCompleted = true;
    }
    bankCooldown(runtime);
    // Firing is impossible while reloading — no fall-through.
    return result;
  }

  if (input.reloadPressed && canReload(runtime, definition)) {
    runtime.state = WeaponState.Reloading;
    runtime.reloadRemaining = definition.reloadSeconds;
    result.reloadStarted = true;
    bankCooldown(runtime);
    return result;
  }

  const wantsToFire =
    definition.fireMode === "AUTOMATIC" ? input.fireHeld : input.firePressed;

  if (!wantsToFire) {
    runtime.state = restingState(runtime);
    bankCooldown(runtime);
    return result;
  }

  if (runtime.magazine <= 0) {
    runtime.state = WeaponState.Empty;
    // Only the initial press clicks; holding the trigger on an empty magazine
    // must not machine-gun the dry-fire sound.
    result.dryFired = input.firePressed;
    bankCooldown(runtime);
    return result;
  }

  const interval = secondsPerShot(definition);
  // A loop rather than a single shot: at low frame rates one tick can legitimately
  // span more than one firing interval, and dropping those shots would make the
  // weapon's real rate depend on frame rate.
  while (runtime.cooldown <= 0 && runtime.magazine > 0) {
    runtime.magazine -= 1;
    runtime.shotsFired += 1;
    runtime.cooldown += interval;
    runtime.timeSinceShot = 0;
    result.shotsFired += 1;
  }

  runtime.state = runtime.magazine > 0 ? WeaponState.Firing : WeaponState.Empty;
  return result;
}

/** Ammunition display string, e.g. `27 / 120`. */
export function formatAmmo(runtime: WeaponRuntime): string {
  return `${runtime.magazine} / ${runtime.reserve}`;
}
