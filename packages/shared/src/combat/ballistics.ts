import { clamp, type Vec3 } from "../math/index.ts";
import type { RecoilProfile, WeaponDefinition } from "./weapon.ts";

/**
 * Damage falloff, spread and recoil.
 *
 * Randomness is injected rather than taken from `Math.random`, for two reasons:
 * a test can pin it to make spread and recoil exactly reproducible, and a later
 * networked phase can seed client and server identically
 * (`ARCHITECTURE.md` §3.2).
 */

/** A random source returning values in [0, 1). */
export type Random = () => number;

/**
 * Small deterministic PRNG (mulberry32).
 *
 * Not cryptographic, and not meant to be — it exists so that "random" spread is
 * reproducible from a seed.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Damage at a given distance.
 *
 * Full damage out to `falloffStart`, then a linear ramp down to
 * `falloffMinMultiplier` at `range`. Beyond `range` the shot does nothing —
 * callers should not have raycast that far in the first place.
 */
export function damageAtDistance(definition: WeaponDefinition, distance: number): number {
  if (distance > definition.range) return 0;
  if (distance <= definition.falloffStart) return definition.damage;

  const span = definition.range - definition.falloffStart;
  if (span <= 0) return definition.damage * definition.falloffMinMultiplier;

  const t = clamp((distance - definition.falloffStart) / span, 0, 1);
  const multiplier = 1 + (definition.falloffMinMultiplier - 1) * t;
  return definition.damage * multiplier;
}

/**
 * Builds a unit vector perpendicular to `forward`.
 *
 * Picks the world axis least aligned with `forward` before crossing, so the
 * result never degenerates when the player aims straight up or down.
 */
function perpendicular(forward: Vec3, out: Vec3): Vec3 {
  const ax = Math.abs(forward.x);
  const ay = Math.abs(forward.y);
  const az = Math.abs(forward.z);

  let refX = 0;
  let refY = 0;
  let refZ = 0;
  if (ax <= ay && ax <= az) refX = 1;
  else if (ay <= az) refY = 1;
  else refZ = 1;

  out.x = forward.y * refZ - forward.z * refY;
  out.y = forward.z * refX - forward.x * refZ;
  out.z = forward.x * refY - forward.y * refX;

  const length = Math.hypot(out.x, out.y, out.z);
  if (length > 1e-6) {
    out.x /= length;
    out.y /= length;
    out.z /= length;
  }
  return out;
}

const scratchRight: Vec3 = { x: 0, y: 0, z: 0 };
const scratchUp: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Deflects `forward` by a random angle within a cone of half-angle `spread`.
 *
 * The offset is sampled with `sqrt(u)` so shots are uniformly distributed over
 * the cone's area rather than bunched toward the centre, and the result is
 * renormalised so the caller always receives a unit direction.
 *
 * A `spread` of 0 returns `forward` unchanged, which keeps tests that care about
 * exact aim from having to stub the random source.
 */
export function applySpread(forward: Vec3, spread: number, random: Random, out: Vec3): Vec3 {
  out.x = forward.x;
  out.y = forward.y;
  out.z = forward.z;
  if (spread <= 0) return out;

  perpendicular(forward, scratchRight);
  // up = forward × right, already unit length since both inputs are.
  scratchUp.x = forward.y * scratchRight.z - forward.z * scratchRight.y;
  scratchUp.y = forward.z * scratchRight.x - forward.x * scratchRight.z;
  scratchUp.z = forward.x * scratchRight.y - forward.y * scratchRight.x;

  const angle = random() * Math.PI * 2;
  const radius = Math.tan(spread) * Math.sqrt(random());
  const offsetRight = Math.cos(angle) * radius;
  const offsetUp = Math.sin(angle) * radius;

  out.x += scratchRight.x * offsetRight + scratchUp.x * offsetUp;
  out.y += scratchRight.y * offsetRight + scratchUp.y * offsetUp;
  out.z += scratchRight.z * offsetRight + scratchUp.z * offsetUp;

  const length = Math.hypot(out.x, out.y, out.z);
  if (length > 1e-6) {
    out.x /= length;
    out.y /= length;
    out.z /= length;
  }
  return out;
}

/** Accumulated recoil, in radians, applied on top of the player's own aim. */
export interface RecoilState {
  pitch: number;
  yaw: number;
}

export function createRecoilState(): RecoilState {
  return { pitch: 0, yaw: 0 };
}

/**
 * Adds one shot's kick.
 *
 * Pitch is deterministic and yaw carries only a bounded, symmetric variation, so
 * a burst walks upward predictably. Fully random recoil would be untestable and,
 * more importantly, unlearnable for the player.
 */
export function applyShotRecoil(
  state: RecoilState,
  profile: RecoilProfile,
  random: Random,
): void {
  state.pitch = Math.min(state.pitch + profile.pitchPerShot, profile.maxPitch);
  const variance = (random() * 2 - 1) * profile.yawVariance;
  state.yaw += profile.yawPerShot * variance;
}

/** Eases accumulated recoil back toward zero. Frame-rate independent. */
export function recoverRecoil(state: RecoilState, profile: RecoilProfile, dt: number): void {
  const factor = Math.exp(-profile.recoveryRate * dt);
  state.pitch *= factor;
  state.yaw *= factor;
  if (Math.abs(state.pitch) < 1e-5) state.pitch = 0;
  if (Math.abs(state.yaw) < 1e-5) state.yaw = 0;
}
