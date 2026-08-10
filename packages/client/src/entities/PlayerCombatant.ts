import {
  applyDamage,
  createLogger,
  type Damageable,
  type DamageResult,
  type HitInfo,
  type Vec3,
} from "@nullpoint/shared";

const log = createLogger("player-health");

/**
 * The player's health, death and respawn.
 *
 * Separate from `Player` on purpose: `Player` owns simulation and rendering, and
 * has no business knowing what a hit point is. This satisfies the same
 * `Damageable` contract the training targets and the bot do, so the bot's
 * hitscan resolves against the player through exactly the same path the player's
 * hitscan resolves against a target — one damage system, not two.
 *
 * Minimal by intent: the brief asks for enough to validate combat, not a death
 * screen.
 */

export interface PlayerCombatantOptions {
  readonly maxHealth: number;
  /** Delay from death to respawn, s. */
  readonly respawnDelay: number;
  readonly spawn: Readonly<Vec3>;
}

export const PLAYER_COMBAT_DEFAULTS = {
  maxHealth: 100,
  respawnDelay: 2.5,
} as const;

export class PlayerCombatant implements Damageable {
  readonly damageableId = "LOCAL_PLAYER";
  readonly maxHealth: number;

  private currentHealth: number;
  private readonly respawnDelay: number;
  private readonly spawn: Vec3;

  private respawnCountdown = 0;
  private deaths = 0;
  private damageTaken = 0;
  /** Set on the tick a respawn is due; the owner clears it once it has acted. */
  private respawnRequested = false;

  constructor(options: PlayerCombatantOptions) {
    this.maxHealth = options.maxHealth;
    this.currentHealth = options.maxHealth;
    this.respawnDelay = options.respawnDelay;
    this.spawn = { ...options.spawn };
  }

  get health(): number {
    return this.currentHealth;
  }

  get isAlive(): boolean {
    return this.currentHealth > 0;
  }

  /** True while dead — combat and movement input are suppressed. */
  get isDead(): boolean {
    return this.currentHealth <= 0;
  }

  get timeToRespawn(): number {
    return this.respawnCountdown;
  }

  get deathCount(): number {
    return this.deaths;
  }

  get totalDamageTaken(): number {
    return this.damageTaken;
  }

  get spawnPoint(): Readonly<Vec3> {
    return this.spawn;
  }

  takeDamage(amount: number, hit: HitInfo): DamageResult {
    const result = applyDamage(this.currentHealth, this.maxHealth, amount);
    if (result.applied <= 0) return result;

    this.currentHealth = result.remainingHealth;
    this.damageTaken += result.applied;

    if (result.killed) {
      this.deaths += 1;
      this.respawnCountdown = this.respawnDelay;
      log.info(`player killed by ${hit.sourceId}; respawning in ${this.respawnDelay.toFixed(1)} s`);
    }
    return result;
  }

  /**
   * Advances the respawn timer.
   *
   * @returns true on the single tick the player should be put back at spawn.
   */
  fixedUpdate(dt: number): boolean {
    if (!this.isDead) return false;

    this.respawnCountdown = Math.max(0, this.respawnCountdown - dt);
    if (this.respawnCountdown > 0) return false;

    this.currentHealth = this.maxHealth;
    this.respawnRequested = true;
    return true;
  }

  /** Restores full health without waiting. Test and development hook. */
  reset(): void {
    this.currentHealth = this.maxHealth;
    this.respawnCountdown = 0;
    this.respawnRequested = false;
  }

  /** Whether a respawn has been served since the last death. */
  get hasRespawned(): boolean {
    return this.respawnRequested;
  }
}
