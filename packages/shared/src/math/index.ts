/**
 * Small math helpers shared by client and server.
 *
 * Deliberately dependency-free: this module must run in a browser, in Node, and
 * in a bare unit test, so it may not import Three.js (`CLAUDE.md` §6).
 */

/** A plain 3-component vector. Y-up, right-handed, metres. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `rate` is the fraction of the remaining distance closed per second, so the
 * result is identical at 30 Hz and 240 Hz. A plain `lerp(a, b, 0.1)` per frame
 * is not, which is why it is not used for camera or rotation smoothing.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wraps an angle into (−π, π]. */
export function wrapAngle(radians: number): number {
  let a = (radians + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angular distance from `from` to `to`, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Angle smoothing that takes the short way around the circle. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return wrapAngle(current + angleDelta(current, target) * (1 - Math.exp(-rate * dt)));
}

export function horizontalLength(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Normalises in place on the XZ plane. A zero-length vector is left at zero. */
export function normalizeHorizontal(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.z);
  if (len > 1e-6) {
    v.x /= len;
    v.z /= len;
  } else {
    v.x = 0;
    v.z = 0;
  }
  return v;
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
