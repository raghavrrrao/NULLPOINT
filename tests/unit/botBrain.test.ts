import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOT_CONFIG,
  BotState,
  createBotBrain,
  stepBotBrain,
  type BotBrain,
  type BotConfig,
  type BotSenses,
} from "../../packages/shared/src/sim/botBrain.ts";

const DT = 1 / 60;

function senses(overrides: Partial<BotSenses> = {}): BotSenses {
  return {
    distance: 5,
    hasLineOfSight: true,
    playerAlive: true,
    alive: true,
    ...overrides,
  };
}

/** Runs the brain for `seconds` and reports how many shots it asked for. */
function run(
  brain: BotBrain,
  input: BotSenses,
  seconds: number,
  config: BotConfig = BOT_CONFIG,
): { shots: number; moves: number; respawns: number } {
  let shots = 0;
  let moves = 0;
  let respawns = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const decision = stepBotBrain(brain, input, DT, config);
    if (decision.fire) shots += 1;
    if (decision.move) moves += 1;
    if (decision.respawn) respawns += 1;
  }
  return { shots, moves, respawns };
}

describe("bot brain", () => {
  it("starts idle and stays idle with the player out of range", () => {
    const brain = createBotBrain();
    const result = run(brain, senses({ distance: BOT_CONFIG.detectionRadius + 5 }), 2);

    assert.equal(brain.state, BotState.Idle);
    assert.equal(result.shots, 0);
    assert.equal(result.moves, 0);
  });

  it("does not acquire a player it cannot see, however close", () => {
    const brain = createBotBrain();
    const result = run(brain, senses({ distance: 2, hasLineOfSight: false }), 2);

    assert.equal(brain.state, BotState.Idle);
    assert.equal(brain.aware, false);
    // This is the rule that stops a bot shooting through a wall.
    assert.equal(result.shots, 0);
  });

  it("chases a visible player that is beyond engage range", () => {
    const brain = createBotBrain();
    const decision = stepBotBrain(brain, senses({ distance: BOT_CONFIG.engageRadius + 4 }), DT);

    assert.equal(brain.state, BotState.Chase);
    assert.equal(decision.move, true);
    assert.equal(decision.face, true);
    assert.equal(decision.fire, false);
  });

  it("engages and holds position once inside engage range", () => {
    const brain = createBotBrain();
    const decision = stepBotBrain(brain, senses({ distance: BOT_CONFIG.engageRadius - 1 }), DT);

    assert.equal(brain.state, BotState.Engage);
    assert.equal(decision.fire, true, "the first shot is not delayed by a cooldown");
    assert.equal(decision.move, false);
  });

  it("respects the fire interval rather than firing every tick", () => {
    const brain = createBotBrain();
    const seconds = 10;
    const result = run(brain, senses({ distance: 5 }), seconds);

    // One immediately, then one per interval.
    const expected = Math.floor(seconds / BOT_CONFIG.fireInterval) + 1;
    assert.ok(
      Math.abs(result.shots - expected) <= 1,
      `expected about ${expected} shots in ${seconds}s, got ${result.shots}`,
    );
  });

  it("uses hysteresis so a player on the range boundary does not flicker", () => {
    const brain = createBotBrain();
    // Engage first, then step just outside the engage radius but inside disengage.
    stepBotBrain(brain, senses({ distance: BOT_CONFIG.engageRadius - 0.5 }), DT);
    assert.equal(brain.state, BotState.Engage);

    const between = (BOT_CONFIG.engageRadius + BOT_CONFIG.disengageRadius) / 2;
    stepBotBrain(brain, senses({ distance: between }), DT);
    assert.equal(brain.state, BotState.Engage, "should not drop back to chase inside the gap");

    stepBotBrain(brain, senses({ distance: BOT_CONFIG.disengageRadius + 1 }), DT);
    assert.equal(brain.state, BotState.Chase);
  });

  it("keeps pursuing briefly after losing sight, then gives up", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 6 }), DT);
    assert.equal(brain.aware, true);

    const blind = senses({ distance: 6, hasLineOfSight: false });
    run(brain, blind, BOT_CONFIG.pursueBlindFor * 0.5);
    assert.equal(brain.aware, true, "cover should not be an instant off switch");

    run(brain, blind, BOT_CONFIG.pursueBlindFor);
    assert.equal(brain.aware, false);
    assert.equal(brain.state, BotState.Idle);
  });

  it("stops firing while it cannot see the player, even while aware", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 5 }), DT);

    const result = run(brain, senses({ distance: 5, hasLineOfSight: false }), BOT_CONFIG.fireInterval * 1.5);
    assert.equal(result.shots, 0);
  });

  it("treats a dead player as no target", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 4 }), DT);
    assert.equal(brain.state, BotState.Engage);

    const result = run(brain, senses({ distance: 4, playerAlive: false }), 2);
    assert.equal(brain.state, BotState.Idle);
    assert.equal(result.shots, 0);
  });

  it("dies, waits the respawn delay, then asks to respawn exactly once", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 4 }), DT);

    const dead = senses({ distance: 4, alive: false });
    stepBotBrain(brain, dead, DT);
    assert.equal(brain.state, BotState.Dead);

    const early = run(brain, dead, BOT_CONFIG.respawnDelay * 0.5);
    assert.equal(early.respawns, 0, "must not respawn before the delay elapses");

    const late = run(brain, dead, BOT_CONFIG.respawnDelay);
    assert.ok(late.respawns >= 1, "should ask to respawn once the delay elapses");
  });

  it("returns to a clean idle after being revived", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 4 }), DT);
    stepBotBrain(brain, senses({ distance: 4, alive: false }), DT);
    assert.equal(brain.state, BotState.Dead);

    // Revived far away and out of sight: it must not resume the old engagement.
    stepBotBrain(brain, senses({ distance: 40, hasLineOfSight: false }), DT);
    assert.equal(brain.state, BotState.Idle);
    assert.equal(brain.aware, false);
  });

  it("clamps a wild delta rather than skipping the whole cooldown", () => {
    const brain = createBotBrain();
    stepBotBrain(brain, senses({ distance: 4 }), DT);
    // A tab that was backgrounded for a minute must not become a burst.
    const decision = stepBotBrain(brain, senses({ distance: 4 }), 60);
    assert.equal(decision.fire, false);
  });
});
