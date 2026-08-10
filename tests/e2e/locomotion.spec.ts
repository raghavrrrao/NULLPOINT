import { expect, test } from "@playwright/test";

import {
  ConsoleWatcher,
  engagePointerLock,
  expectEventually,
  frames,
  recordFrames,
  snapshot,
  startGame,
  teleport,
  type GameSnapshot,
} from "./helpers.ts";

/**
 * Locomotion behaviour for the real character.
 *
 * The question these answer is not "does a clip play" but "do the legs actually
 * move, do the feet stay on the floor, and does the animation stay out of the
 * simulation's way". Stride is measured as the fore-and-aft travel of the foot
 * **in character space** — that is the only reading that distinguishes a walk
 * cycle from a bind pose sliding along the ground, because in world space a
 * frozen character being carried forward looks identical to a striding one.
 */

/** Open ground, clear of the training range and the arena's obstacles. */
const OPEN_GROUND = { x: 0, y: 0.6, z: 6 };

function strideOf(samples: readonly GameSnapshot[], foot: "left" | "right"): number {
  const z = samples.map((s) => s.footPositions[foot][2]);
  return Math.max(...z) - Math.min(...z);
}

function lowestFoot(samples: readonly GameSnapshot[]): number {
  return Math.min(...samples.map((s) => Math.min(s.footPositions.left[1], s.footPositions.right[1])));
}

function highestFoot(samples: readonly GameSnapshot[]): number {
  return Math.max(...samples.map((s) => Math.max(s.footPositions.left[1], s.footPositions.right[1])));
}

async function settleAt(page: import("@playwright/test").Page): Promise<void> {
  await teleport(page, OPEN_GROUND.x, OPEN_GROUND.y, OPEN_GROUND.z);
  await frames(page, 25);
}

test.describe("locomotion clips", () => {
  test("stands idle without striding", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const samples = await recordFrames(page, 30);
    const last = samples[samples.length - 1];
    expect(last?.animationClip).toBe("IDLE");

    // An idle has breathing, not a gait.
    expect(strideOf(samples, "left")).toBeLessThan(0.1);
    expect(strideOf(samples, "right")).toBeLessThan(0.1);
  });

  test("walks, runs and sprints with distinct gaits", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);

    // Each gait gets its own run-up from open ground. Chaining them in one run
    // marches the character the length of the arena and into a wall, where it
    // stops and never reaches sprint speed at all.
    const gait = async (modifier: string | null): Promise<GameSnapshot[]> => {
      await settleAt(page);
      await page.keyboard.down("w");
      if (modifier !== null) await page.keyboard.down(modifier);
      await frames(page, 30);
      const samples = await recordFrames(page, 26);
      if (modifier !== null) await page.keyboard.up(modifier);
      await page.keyboard.up("w");
      await frames(page, 20);
      return samples;
    };

    const walking = await gait("Alt");
    const running = await gait(null);
    const sprinting = await gait("Shift");

    expect(walking.some((s) => s.animationClip === "WALK")).toBe(true);
    expect(running.some((s) => s.animationClip === "RUN")).toBe(true);
    expect(sprinting.some((s) => s.animationClip === "SPRINT")).toBe(true);

    // The legs must actually swing, and further at speed.
    const walkStride = strideOf(walking, "left");
    const runStride = strideOf(running, "left");
    expect(walkStride).toBeGreaterThan(0.25);
    expect(runStride).toBeGreaterThan(walkStride);
  });

  test("keeps the feet on the floor in every grounded state", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    // The ankle joint sits ~0.09 m above the sole, so a foot at or below zero is
    // through the floor and one much above it is floating.
    const idle = await recordFrames(page, 24);
    expect(lowestFoot(idle)).toBeGreaterThan(0);
    expect(lowestFoot(idle)).toBeLessThan(0.2);

    await page.keyboard.down("w");
    await frames(page, 25);
    const running = await recordFrames(page, 26);
    await page.keyboard.up("w");
    expect(lowestFoot(running), "the planted foot must not sink through the floor").toBeGreaterThan(-0.02);
    expect(lowestFoot(running), "nor float above it").toBeLessThan(0.2);

    await frames(page, 30);
    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    const crouched = await recordFrames(page, 26);
    await page.keyboard.up("Control");

    // This is the case that used to push the feet 26 mm through the ground.
    expect(lowestFoot(crouched)).toBeGreaterThan(-0.02);
  });

  test("splits crouch into a still pose and a moving one", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    await frames(page, 20);
    const still = await snapshot(page);
    expect(still.animationClip).toBe("CROUCH_IDLE");

    await page.keyboard.down("w");
    const moving = await expectEventually(page, "crouch moving", (s) => s.animationClip === "CROUCH_MOVE", 200);
    expect(moving.crouching).toBe(true);

    await page.keyboard.up("w");
    await page.keyboard.up("Control");
  });

  test("crouching folds the spine forward on the real skeleton", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const standing = await snapshot(page);

    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    await frames(page, 35);
    const crouched = await snapshot(page);
    await page.keyboard.up("Control");

    // Negative is a forward fold; positive would arch the back the wrong way.
    expect(crouched.poseAngles.spine).toBeLessThan(standing.poseAngles.spine);
    expect(crouched.poseAngles.spine).toBeLessThan(0);
  });

  test("runs jump, fall and landing in order", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const recording = recordFrames(page, 90);
    await page.keyboard.press("Space");
    const samples = await recording;

    const clips = samples.map((s) => s.animationClip);
    const first = (name: string): number => clips.indexOf(name);

    expect(first("JUMP"), "jump should play on take-off").toBeGreaterThanOrEqual(0);
    expect(first("FALL"), "fall should follow the jump").toBeGreaterThan(first("JUMP"));
    expect(first("LAND"), "landing should follow the fall").toBeGreaterThan(first("FALL"));
    // And it must hand back to normal locomotion rather than sticking.
    expect(clips[clips.length - 1]).not.toBe("LAND");
  });

  test("lets the feet leave the ground while airborne", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const recording = recordFrames(page, 70);
    await page.keyboard.press("Space");
    const samples = await recording;

    const airborne = samples.filter((s) => !s.grounded);
    expect(airborne.length).toBeGreaterThan(3);
    // The grounding correction must release in the air, not pin the feet down.
    expect(highestFoot(airborne)).toBeGreaterThan(0.1);
  });
});

test.describe("animation and simulation stay separate", () => {
  test("animation never moves the character (no root motion)", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    // Idle plays a full cycle with a hip bob. If any of it leaked into the
    // character's position, the player would drift while standing still.
    const before = await snapshot(page);
    const samples = await recordFrames(page, 60);
    const after = await snapshot(page);

    const drift = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    expect(drift, "an idle character must not travel").toBeLessThan(0.02);
    // The clip really was running, so the assertion above means something.
    expect(samples.some((s) => s.animationClip === "IDLE")).toBe(true);
  });

  test("the weapon stays in both hands through every locomotion state", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const worst = { right: 0, left: 0 };
    const track = (samples: readonly GameSnapshot[]): void => {
      for (const s of samples) {
        worst.right = Math.max(worst.right, s.handGripError.right);
        worst.left = Math.max(worst.left, s.handGripError.left);
      }
    };

    track(await recordFrames(page, 20));

    await page.keyboard.down("w");
    await frames(page, 25);
    track(await recordFrames(page, 24));

    await page.keyboard.down("Shift");
    await frames(page, 25);
    track(await recordFrames(page, 24));
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await frames(page, 30);

    await page.mouse.down({ button: "right" });
    await page.keyboard.down("w");
    await frames(page, 25);
    track(await recordFrames(page, 24));
    await page.keyboard.up("w");

    await page.keyboard.down("s");
    await frames(page, 25);
    track(await recordFrames(page, 24));
    await page.keyboard.up("s");

    await page.keyboard.down("d");
    await frames(page, 25);
    track(await recordFrames(page, 24));
    await page.keyboard.up("d");
    await page.mouse.up({ button: "right" });

    // The locomotion clips write the arm bones too; the weapon pose runs after
    // the mixer and must win every time, or the rifle drifts out of the hands.
    expect(worst.right, "trigger hand").toBeLessThan(0.05);
    expect(worst.left, "support hand").toBeLessThan(0.08);
    expect(watcher.errors).toEqual([]);
  });

  test("backpedalling still does not spin the character", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await settleAt(page);

    const before = await snapshot(page);
    await page.mouse.down({ button: "right" });
    await page.keyboard.down("s");
    await frames(page, 70);
    const during = await snapshot(page);
    await page.keyboard.up("s");
    await page.mouse.up({ button: "right" });

    expect(Math.abs(during.yaw - before.yaw)).toBeLessThan(0.25);
    expect(during.position.z).toBeGreaterThan(before.position.z + 1);
  });
});
