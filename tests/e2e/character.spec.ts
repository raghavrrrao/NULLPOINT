import { expect, test } from "@playwright/test";

import {
  ConsoleWatcher,
  applyMouseDelta,
  engagePointerLock,
  expectEventually,
  frames,
  snapshot,
  startGame,
  teleport,
} from "./helpers.ts";

/**
 * Integration checks for the real humanoid character.
 *
 * Behavioural assertions rather than pixel comparisons: the questions that
 * matter are whether the skeleton mapped, whether the character is the right
 * size and the right way round, and whether the hands still reach the weapon.
 */

const FIRING_LINE = { x: -6, y: 0.4, z: 24 };

test.describe("character asset", () => {
  test("loads the rigged glTF with no missing resources", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);

    const state = await snapshot(page);
    expect(state.characterSource, "the real character should load, not the placeholder").toBe("GLB");

    expect(watcher.errors, `console errors: ${watcher.errors.join(" | ")}`).toEqual([]);
    expect(
      watcher.failedRequests,
      `the glTF's buffer and textures must all resolve: ${watcher.failedRequests.join(" | ")}`,
    ).toEqual([]);
  });

  test("normalises to the gameplay character height", async ({ page }) => {
    await startGame(page);
    const state = await snapshot(page);

    // The source model is 1.8196 m; the collider expects 1.8 m.
    expect(state.standHeight).toBeCloseTo(1.8, 5);
    expect(state.characterHeight, "rendered height should match the collider").toBeCloseTo(1.8, 2);
  });

  test("stands with its feet on the ground", async ({ page }) => {
    await startGame(page);
    const state = await snapshot(page);

    expect(state.grounded).toBe(true);
    // The ankle joint sits naturally about 0.1 m above the sole; what matters is
    // that the character is neither floating nor sunk.
    expect(state.footHeight.right).toBeGreaterThan(0);
    expect(state.footHeight.right).toBeLessThan(0.2);
    expect(state.footHeight.left).toBeCloseTo(state.footHeight.right, 2);
  });

  test("faces the direction the character is facing, not the model's authored front", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);

    // The glTF specification puts an asset's front on +Z and this project uses
    // −Z, so the model carries a half-turn correction. If it were missing or
    // doubled, walking "forward" would move the character backwards on screen.
    const before = await snapshot(page);
    await page.keyboard.down("w");
    await frames(page, 60);
    const after = await snapshot(page);
    await page.keyboard.up("w");

    // Camera at default yaw 0 looks along −Z, so forward must reduce z.
    expect(after.position.z).toBeLessThan(before.position.z - 1);
    // And the body should be facing that way too.
    expect(Math.abs(after.yaw)).toBeLessThan(0.3);
  });
});

test.describe("character skeleton", () => {
  test("both hands reach the weapon grips", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await teleport(page, FIRING_LINE.x, FIRING_LINE.y, FIRING_LINE.z);
    await frames(page, 30);

    const hip = await snapshot(page);
    expect(hip.handGripError.right, "trigger hand should be on the grip").toBeLessThan(0.02);
    expect(hip.handGripError.left, "support hand should be near the handguard").toBeLessThan(0.08);

    await page.mouse.down({ button: "right" });
    const aimed = await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);
    await page.mouse.up({ button: "right" });

    // Shouldered, both hands should be exactly on the weapon.
    expect(aimed.handGripError.right).toBeLessThan(0.01);
    expect(aimed.handGripError.left).toBeLessThan(0.02);
  });

  test("arm IK holds through a full 360° sweep", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await teleport(page, FIRING_LINE.x, FIRING_LINE.y, FIRING_LINE.z);
    await frames(page, 20);

    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);

    let worstGrip = 0;
    let worstAim = 0;
    for (let i = 0; i < 24; i++) {
      await applyMouseDelta(page, 300, 0);
      await frames(page, 3);
      const s = await snapshot(page);
      worstGrip = Math.max(worstGrip, s.handGripError.right, s.handGripError.left);

      const heading = Math.atan2(-s.weaponForward[0], -s.weaponForward[2]);
      const delta = Math.atan2(Math.sin(heading - s.cameraYaw), Math.cos(heading - s.cameraYaw));
      worstAim = Math.max(worstAim, Math.abs(delta));
    }
    await page.mouse.up({ button: "right" });

    // A rest-direction or gimbal error shows up as a spike somewhere on the sweep.
    expect(worstGrip, "hands must stay on the grips all the way round").toBeLessThan(0.05);
    expect(worstAim, "barrel must stay on the aim heading").toBeLessThan(0.2);
  });

  test("keeps the weapon attached while crouched, jumping and sprinting", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await teleport(page, FIRING_LINE.x, FIRING_LINE.y, FIRING_LINE.z);
    await frames(page, 20);

    await page.keyboard.down("Control");
    const crouched = await expectEventually(page, "crouched", (s) => s.crouching, 200);
    expect(crouched.handGripError.right).toBeLessThan(0.05);
    await page.keyboard.up("Control");
    await frames(page, 30);

    await page.mouse.down({ button: "right" });
    await page.keyboard.press("Space");
    const airborne = await expectEventually(page, "airborne", (s) => !s.grounded);
    expect(airborne.handGripError.right).toBeLessThan(0.05);
    expect(airborne.handGripError.left).toBeLessThan(0.05);
    await page.mouse.up({ button: "right" });
    await expectEventually(page, "landed", (s) => s.grounded, 300);

    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    const sprinting = await expectEventually(page, "sprinting", (s) => s.movementState === "SPRINT");
    expect(sprinting.handGripError.right).toBeLessThan(0.05);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
  });

  test("vertical aim is not inverted on the real skeleton", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);

    await applyMouseDelta(page, 0, -450);
    await frames(page, 6);
    const up = await snapshot(page);
    expect(up.cameraPitch).toBeLessThan(-0.4);
    expect(up.weaponForward[1], "barrel up").toBeGreaterThan(0.2);
    expect(up.poseAngles.torso, "torso leans back").toBeGreaterThan(0.02);

    await applyMouseDelta(page, 0, 900);
    await frames(page, 6);
    const down = await snapshot(page);
    expect(down.cameraPitch).toBeGreaterThan(0.4);
    expect(down.weaponForward[1], "barrel down").toBeLessThan(-0.2);
    expect(down.poseAngles.torso, "torso folds forward").toBeLessThan(-0.02);

    await page.mouse.up({ button: "right" });
  });

  test("backing up while aiming does not spin the character", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    const before = await snapshot(page);

    await page.mouse.down({ button: "right" });
    await page.keyboard.down("s");
    await frames(page, 80);
    const during = await snapshot(page);
    await page.keyboard.up("s");
    await page.mouse.up({ button: "right" });

    expect(Math.abs(during.yaw - before.yaw)).toBeLessThan(0.25);
    expect(during.position.z).toBeGreaterThan(before.position.z + 1);
    expect(during.handGripError.right).toBeLessThan(0.05);
  });
});
