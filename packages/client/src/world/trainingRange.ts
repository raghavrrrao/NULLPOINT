import type { ArenaBox } from "./arenaLayout.ts";
import type { TrainingTargetOptions } from "./TrainingTarget.ts";

/**
 * The Phase 2 training range.
 *
 * Occupies the empty south-east band of the Phase 1 arena (x −8…28, z 20…28) so
 * nothing in the existing layout had to move — the brief is explicit that the
 * map is not to be redesigned.
 *
 * The firing line is at x ≈ −6 and the player shoots along **+X**. That gives a
 * long unobstructed run for the range checks without crossing any Phase 1
 * geometry.
 *
 * The three range targets are **staggered in z on purpose**. Placed on one line
 * they were perfectly collinear from the firing line, so the near plate absorbed
 * every round aimed at the two behind it and they could not be tested — or
 * played — until it was destroyed.
 *
 * The stagger is measured from the *camera*, not the player: the over-the-
 * shoulder offset puts the eye ~0.8 m to the side, which is enough to swing a
 * near plate back into the sight line of a far one.
 *
 *   firing line                                        arena wall
 *   x=−6        x=2      x=12        x=18   x=22   x=26   x=30
 *    |           |         |           |      |      |      |
 *    |  [narrow lane ]   [open]     [cover] [high] [long]   |
 */

/** Where the player should stand to use the range, at the feet. */
export const RANGE_FIRING_LINE: readonly [number, number, number] = [-6, 0.4, 24];

/**
 * Plates face −X, back toward the firing line.
 *
 * A plate's local forward is +Z, which a yaw of −π/2 rotates onto −X.
 */
const FACING = -Math.PI / 2;

/** Static geometry for the range. Fed through the same collider-building path. */
export const RANGE_BOXES: readonly ArenaBox[] = [
  // Narrow firing lane: two low walls the player shoots between.
  //
  // Deliberately started at x = 1.5 rather than nearer the origin. Spanning
  // x = 0 put a wall across the approach to the south perimeter wall, which is
  // where the Phase 1 cornered-camera regression test walks — the range must not
  // reach into ground the existing arena tests rely on.
  { name: "range-lane-south", position: [5.5, 1.0, 26.3], size: [8, 2.0, 0.4], surface: "wall" },
  { name: "range-lane-north", position: [5.5, 1.0, 20.8], size: [8, 2.0, 0.4], surface: "wall" },

  // Cover: a chest-high block with a target behind it, so only the upper plate
  // is exposed from the firing line.
  //
  // Sat at z = 21 originally, level with the target — but shots arrive at an
  // angle from a firing line 3.8 m away in z, so they passed the block's edge
  // instead of hitting it. It is now on the actual sight line and deep enough
  // to stay on it.
  { name: "range-cover", position: [15, 0.75, 21.5], size: [2.4, 1.5, 1.0], surface: "prop" },

  // Elevated platform carrying the high target.
  { name: "range-riser", position: [22, 1.1, 26.5], size: [3, 2.2, 3], surface: "accent" },

  // Backstop, so long-range misses stop somewhere readable rather than at the
  // arena wall 30 m further on.
  { name: "range-backstop", position: [28.4, 1.6, 24], size: [0.5, 3.2, 9], surface: "accent" },
];

/**
 * Targets at graded distances from the firing line, plus one behind cover and
 * one elevated — the set the brief asks for to exercise range, cover and aim.
 */
export const TRAINING_TARGETS: readonly TrainingTargetOptions[] = [
  {
    id: "CLOSE",
    position: [2, 1.3, 22.2],
    size: [1.2, 1.6],
    health: 100,
    facing: FACING,
    postHeight: 1.3,
  },
  {
    id: "MEDIUM",
    position: [12, 1.3, 25.6],
    size: [1.2, 1.6],
    health: 100,
    facing: FACING,
    postHeight: 1.3,
  },
  {
    id: "LONG",
    position: [26, 1.3, 23.8],
    size: [1.2, 1.6],
    health: 100,
    facing: FACING,
    postHeight: 1.3,
  },
  {
    // Plate centre at 1.85 m with 1.5 m of cover in front: the lower half is
    // protected, so a hit needs either height or a step to the side.
    id: "COVER",
    position: [18, 1.85, 21],
    size: [1.2, 1.3],
    health: 100,
    facing: FACING,
    postHeight: 1.85,
  },
  {
    // Standing on the riser, whose top is at y = 2.2.
    id: "ELEVATED",
    position: [22, 3.4, 26.5],
    size: [1.2, 1.4],
    health: 100,
    facing: FACING,
    postHeight: 1.2,
  },

  // The two movers are placed **off every static target's sight line from the
  // firing line**, and with nothing behind them. A mover that drifts across the
  // line to another plate would intermittently eat rounds aimed at it, which is
  // the same defect the z-stagger above exists to avoid — except intermittent,
  // so it would show up as a flaky test rather than an obvious one.
  {
    // Crosses the firing lane laterally, above it.
    //
    // The height is not decoration: the lane is narrow and the sight lines to
    // MEDIUM and LONG run down the middle of it, so a mover at plate height
    // sweeps across them and intermittently eats their rounds. At 3.4 m it is
    // clear of every static target's sight line in **elevation** instead, which
    // no amount of shuffling it sideways could achieve.
    id: "MOVER_H",
    position: [8, 3.4, 23.5],
    size: [1.1, 1.4],
    health: 100,
    facing: FACING,
    postHeight: 3.4,
    motion: { axis: "z", amplitude: 0.9, period: 5.5 },
  },
  {
    // Rises and drops, for leading a target in elevation rather than bearing.
    //
    // Placed *before* the firing lane starts (x < 1.5). Anywhere past it and
    // deep in z sits behind the 2 m lane wall, which clipped the sight line at
    // grazing incidence and made hits intermittent.
    id: "MOVER_V",
    position: [0, 2.2, 21.5],
    size: [1.1, 1.2],
    health: 100,
    facing: FACING,
    postHeight: 2.2,
    motion: { axis: "y", amplitude: 0.9, period: 7, phase: 0.25 },
  },
];

/**
 * Where the training bots start.
 *
 * Deliberately far from both the player spawn (0, 12) and the range firing line
 * (−6, 24) — beyond the bot's `loseTargetRadius`, so a bot never wanders into
 * the range and starts absorbing rounds aimed at a plate. The player has to go
 * and find it.
 *
 * The Phase 1 elevated platform (x −20…−8, z −18…−6) sits between the spawn and
 * this corner, which gives the line-of-sight rules something real to work
 * against: the bot cannot shoot the player through it.
 */
export interface BotSpawn {
  readonly id: string;
  readonly position: readonly [number, number, number];
  /** Damage per hit at point-blank range, before falloff. */
  readonly damage: number;
}

export const BOT_SPAWNS: readonly BotSpawn[] = [
  { id: "BOT_ALPHA", position: [-14, 0.6, -25], damage: 12 },
];
