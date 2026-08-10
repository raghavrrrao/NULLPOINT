import { clamp } from "../math/index.ts";

/**
 * The training bot's decision logic.
 *
 * Pure and deterministic: no physics, no rendering, no clock of its own. It is
 * told how far away the player is and whether it can see them, and it answers
 * with what it wants to do. That keeps the interesting part — the state machine
 * and its edge cases — unit-testable without a browser, and it is where a
 * server-side bot would run unchanged.
 *
 * Deliberately simple, per the phase brief: no pathfinding, no behaviour trees,
 * no tactics. Its purpose is to give the combat systems something that moves,
 * shoots back, dies and comes back.
 */

export const BotState = {
  /** Alive, unaware of the player. */
  Idle: "IDLE",
  /** Aware, closing the distance. */
  Chase: "CHASE",
  /** In range and shooting. */
  Engage: "ENGAGE",
  /** Health exhausted, waiting to respawn. */
  Dead: "DEAD",
} as const;

export type BotState = (typeof BotState)[keyof typeof BotState];

export interface BotConfig {
  /** Beyond this the bot cannot notice the player, m. */
  readonly detectionRadius: number;
  /** At or inside this the bot stops closing and shoots, m. */
  readonly engageRadius: number;
  /**
   * Beyond this an engaged bot resumes chasing, m.
   *
   * Strictly greater than `engageRadius`. Without the gap a player standing
   * exactly at the boundary flips the bot between chasing and shooting every
   * frame, which looks broken and makes its fire rate meaningless.
   */
  readonly disengageRadius: number;
  /** Beyond this a bot that had noticed the player loses them again, m. */
  readonly loseTargetRadius: number;
  /** Seconds between shots. */
  readonly fireInterval: number;
  /** Delay from death to respawn, s. */
  readonly respawnDelay: number;
  /**
   * Time the bot keeps closing after losing sight, s.
   *
   * Without it the bot stops dead the instant the player steps behind cover,
   * which makes cover feel like an off switch rather than cover.
   */
  readonly pursueBlindFor: number;
}

export const BOT_CONFIG: BotConfig = {
  detectionRadius: 26,
  engageRadius: 11,
  disengageRadius: 14,
  loseTargetRadius: 34,
  fireInterval: 0.85,
  respawnDelay: 3,
  pursueBlindFor: 2.5,
};

export interface BotBrain {
  state: BotState;
  /** Seconds until the next shot is allowed. */
  fireCooldown: number;
  /** Seconds until respawn while dead. */
  respawnCountdown: number;
  /** Seconds since the player was last visible; grows while blind. */
  blindFor: number;
  /** True once the bot has noticed the player and not yet lost them. */
  aware: boolean;
}

export function createBotBrain(): BotBrain {
  return {
    state: BotState.Idle,
    fireCooldown: 0,
    respawnCountdown: 0,
    blindFor: Number.POSITIVE_INFINITY,
    aware: false,
  };
}

export interface BotSenses {
  /** Distance to the player, m. */
  readonly distance: number;
  /** Clear line of fire to the player. */
  readonly hasLineOfSight: boolean;
  /** False while the player is dead — a corpse is not a target. */
  readonly playerAlive: boolean;
  /** False once the bot's own health is exhausted. */
  readonly alive: boolean;
}

export interface BotDecision {
  /** Move toward the player this tick. */
  readonly move: boolean;
  /** Turn to face the player this tick. */
  readonly face: boolean;
  /** Fire exactly one round this tick. */
  readonly fire: boolean;
  /** Respawn now. True for a single tick. */
  readonly respawn: boolean;
}

const IDLE: BotDecision = { move: false, face: false, fire: false, respawn: false };

/**
 * Advances the brain one tick and reports what it wants to do.
 *
 * Mutates `brain` and returns the decision; nothing else in the system is
 * touched. The caller owns movement, firing and respawning — this only decides.
 */
export function stepBotBrain(
  brain: BotBrain,
  senses: BotSenses,
  dt: number,
  config: BotConfig = BOT_CONFIG,
): BotDecision {
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;

  brain.fireCooldown = Math.max(0, brain.fireCooldown - step);

  if (!senses.alive) {
    if (brain.state !== BotState.Dead) {
      brain.state = BotState.Dead;
      brain.respawnCountdown = config.respawnDelay;
      brain.aware = false;
      brain.blindFor = Number.POSITIVE_INFINITY;
    }
    brain.respawnCountdown = Math.max(0, brain.respawnCountdown - step);
    return brain.respawnCountdown <= 0
      ? { move: false, face: false, fire: false, respawn: true }
      : IDLE;
  }

  if (brain.state === BotState.Dead) {
    // Revived by the caller; start clean rather than resuming an old chase.
    brain.state = BotState.Idle;
    brain.aware = false;
    brain.blindFor = Number.POSITIVE_INFINITY;
  }

  const visible = senses.hasLineOfSight && senses.playerAlive;
  brain.blindFor = visible ? 0 : brain.blindFor + step;

  if (!senses.playerAlive) {
    brain.aware = false;
    brain.state = BotState.Idle;
    return IDLE;
  }

  // Sight is required to *acquire* the player, but not to keep chasing one —
  // otherwise stepping behind a crate erases the bot's memory instantly.
  if (visible && senses.distance <= config.detectionRadius) brain.aware = true;
  if (senses.distance > config.loseTargetRadius || brain.blindFor > config.pursueBlindFor) {
    brain.aware = false;
  }

  if (!brain.aware) {
    brain.state = BotState.Idle;
    return IDLE;
  }

  const wasEngaging = brain.state === BotState.Engage;
  // Hysteresis: it takes `engageRadius` to start shooting but `disengageRadius`
  // to stop, so a player hovering at the boundary does not flicker the state.
  const inRange = senses.distance <= (wasEngaging ? config.disengageRadius : config.engageRadius);

  if (inRange && visible) {
    brain.state = BotState.Engage;
    const fire = brain.fireCooldown <= 0;
    if (fire) brain.fireCooldown = config.fireInterval;
    // Still closes slightly while engaging would look twitchy; hold position.
    return { move: false, face: true, fire, respawn: false };
  }

  brain.state = BotState.Chase;
  return { move: true, face: true, fire: false, respawn: false };
}
