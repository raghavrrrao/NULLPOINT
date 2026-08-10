import type { Vec3 } from "../math/index.ts";

/**
 * The damage contract.
 *
 * Deliberately narrow and free of rendering and physics types so that the same
 * interface works for the training targets in this phase and for networked
 * players later, when the server — not the client — decides that a hit landed
 * (`ARCHITECTURE.md` §6). Nothing here trusts the caller: `applyDamage` clamps
 * its own input rather than assuming a sane amount.
 */

export interface HitInfo {
  /** World-space impact point. */
  readonly point: Vec3;
  /** Surface normal at the impact point. */
  readonly normal: Vec3;
  /** Distance from the shot origin, m. */
  readonly distance: number;
  /** Identifier of whoever fired. `"LOCAL_PLAYER"` in this phase. */
  readonly sourceId: string;
}

export interface DamageResult {
  /** Damage actually applied after clamping, hit points. */
  readonly applied: number;
  readonly remainingHealth: number;
  /** True when this hit brought health to zero. */
  readonly killed: boolean;
}

export interface Damageable {
  readonly damageableId: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly isAlive: boolean;
  takeDamage(amount: number, hit: HitInfo): DamageResult;
}

/**
 * Applies damage to a health pool and reports the outcome.
 *
 * Shared by every damageable thing so the arithmetic — clamping, the
 * already-dead case, the overkill case — exists once.
 */
export function applyDamage(
  currentHealth: number,
  maxHealth: number,
  amount: number,
): DamageResult {
  if (currentHealth <= 0) {
    return { applied: 0, remainingHealth: 0, killed: false };
  }

  // Negative or non-finite damage would heal or corrupt the pool. Reject rather
  // than trust — the same input could arrive over a network later.
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const applied = Math.min(requested, currentHealth);
  const remainingHealth = Math.min(maxHealth, currentHealth - applied);

  return { applied, remainingHealth, killed: remainingHealth <= 0 && applied > 0 };
}
