import { clamp, wrapAngle } from "../math/index.ts";

/**
 * Angle quantisation, §1.2.
 *
 * Yaw is a full turn in a `u16`; pitch is a half-turn in an `i16`. Both are
 * lossy by design — the loss is bounded and stated here so nothing downstream
 * has to guess how exact a replicated angle is.
 */

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Largest yaw error introduced by quantisation, radians (~0.0055°). */
export const YAW_QUANTISATION_ERROR = TAU / 65536 / 2;
/** Largest pitch error introduced by quantisation, radians (~0.0027°). */
export const PITCH_QUANTISATION_ERROR = HALF_PI / 32767 / 2;

/** Radians → `u16`. Wraps first, so any input angle is representable. */
export function encodeYaw(yaw: number): number {
  const wrapped = wrapAngle(yaw);
  // wrapAngle gives (−π, π]; shift into [0, 2π) before scaling so the whole
  // u16 range is used and −π and +π do not collide on different codes.
  const positive = wrapped < 0 ? wrapped + TAU : wrapped;
  return Math.round((positive / TAU) * 65536) & 0xffff;
}

/** `u16` → radians in (−π, π]. */
export function decodeYaw(raw: number): number {
  return wrapAngle(((raw & 0xffff) / 65536) * TAU);
}

/** Radians → `i16`, clamped to ±π/2. */
export function encodePitch(pitch: number): number {
  const limited = clamp(pitch, -HALF_PI, HALF_PI);
  return Math.round((limited / HALF_PI) * 32767);
}

/** `i16` → radians in [−π/2, π/2]. */
export function decodePitch(raw: number): number {
  return (raw / 32767) * HALF_PI;
}
