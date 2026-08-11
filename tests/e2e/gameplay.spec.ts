import { CAMERA_CONFIG } from "../../packages/shared/src/constants/camera.ts";

import { expect, test } from "@playwright/test";

import {
  ConsoleWatcher,
  applyMouseDelta,
  expectEventually,
  frames,
  holdKey,
  horizontalDistance,
  recordFrames,
  settle,
  snapshot,
  startGame,
  teleport,
} from "./helpers.ts";

test.describe("gravity and ground", () => {
  test("falls to the floor and becomes grounded", async ({ page }) => {
    await startGame(page);
    const state = await snapshot(page);

    expect(state.grounded).toBe(true);
    expect(state.position.y).toBeLessThan(0.05);
    expect(state.position.y).toBeGreaterThan(-0.05);
    expect(state.movementState).toBe("IDLE");
  });

  test("falls off an edge and lands on the floor below", async ({ page }) => {
    await startGame(page);

    // Drop from above the elevated platform. Recorded in-page: a fixed frame
    // count is not a fixed amount of simulated time, and the fall can complete
    // between two sampled frames on a slow renderer.
    const recording = recordFrames(page, 40);
    await teleport(page, -14, 8, -14);
    const samples = await recording;

    const falling = samples.filter((s) => !s.grounded && s.velocity.y < 0);
    expect(falling.length, "expected frames descending in mid-air").toBeGreaterThan(0);
    expect(falling.every((s) => s.movementState === "FALL" || s.movementState === "JUMP")).toBe(true);

    await settle(page, 300);
    const landed = await snapshot(page);
    expect(landed.grounded).toBe(true);
    // The platform top is at y = 3.
    expect(landed.position.y).toBeGreaterThan(2.9);
    expect(landed.position.y).toBeLessThan(3.1);
  });
});

test.describe("movement", () => {
  test("WASD moves the character", async ({ page }) => {
    await startGame(page);
    const before = await snapshot(page);

    await holdKey(page, "w", 45);
    await frames(page, 5);
    const after = await snapshot(page);

    expect(horizontalDistance(before, after)).toBeGreaterThan(1.5);
  });

  test("movement is camera-relative", async ({ page }) => {
    await startGame(page);

    // Camera at default yaw 0 looks along −Z, so forward must reduce z.
    const start = await snapshot(page);
    await holdKey(page, "w", 40);
    await frames(page, 5);
    const north = await snapshot(page);

    const dzNorth = north.position.z - start.position.z;
    const dxNorth = north.position.x - start.position.x;
    expect(dzNorth).toBeLessThan(-1.0);
    expect(Math.abs(dxNorth)).toBeLessThan(0.6);

    // Rotate the camera a quarter turn, then press forward again. The character
    // must now travel along a different world axis.
    await settle(page);
    const beforeTurn = await snapshot(page);
    await applyMouseDelta(page, Math.PI / 2 / 0.0022, 0);
    await frames(page, 3);

    const turned = await snapshot(page);
    expect(Math.abs(turned.cameraYaw - beforeTurn.cameraYaw)).toBeGreaterThan(1.4);

    await holdKey(page, "w", 40);
    await frames(page, 5);
    const east = await snapshot(page);

    const dxEast = east.position.x - turned.position.x;
    const dzEast = east.position.z - turned.position.z;
    expect(Math.abs(dxEast)).toBeGreaterThan(1.0);
    expect(Math.abs(dxEast)).toBeGreaterThan(Math.abs(dzEast));
  });

  test("the character turns to face the direction of travel", async ({ page }) => {
    await startGame(page);

    await holdKey(page, "w", 30);
    const forward = await snapshot(page);
    expect(Math.abs(forward.yaw)).toBeLessThan(0.25);

    // Strafing turns the character into its run.
    await settle(page);
    await page.keyboard.down("d");
    const strafing = await expectEventually(
      page,
      "character turned into the strafe",
      (st) => Math.abs(Math.abs(st.yaw) - Math.PI / 2) < 0.3,
      300,
    );
    await page.keyboard.up("d");
    expect(Math.abs(Math.abs(strafing.yaw) - Math.PI / 2)).toBeLessThan(0.3);
  });

  test("backing up walks backward instead of turning the character around", async ({ page }) => {
    await startGame(page);
    await settle(page);
    const before = await snapshot(page);

    // Deliberate third-person behaviour: holding S must retreat, not spin the
    // character 180° and sprint it away from the camera.
    await page.keyboard.down("s");
    await frames(page, 90);
    const during = await snapshot(page);
    await page.keyboard.up("s");

    expect(Math.abs(during.yaw - before.yaw), "the character must not turn around").toBeLessThan(0.25);
    // Facing −Z, backing up increases z.
    expect(during.position.z).toBeGreaterThan(before.position.z + 1);
  });

  test("sprint is faster than the default run", async ({ page }) => {
    await startGame(page);

    // Compare terminal speeds while the keys are held. Comparing distance over a
    // frame count is unreliable: a frame is not a fixed amount of simulated time.
    await page.keyboard.down("w");
    const running = await expectEventually(page, "run speed reached", (s) => s.movementState === "RUN");
    await page.keyboard.down("Shift");
    const sprinting = await expectEventually(page, "sprint speed reached", (s) => s.movementState === "SPRINT");
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");

    expect(sprinting.speed).toBeGreaterThan(running.speed * 1.15);
    expect(sprinting.speed).toBeGreaterThan(6.5);
  });

  test("the walk modifier is slower than the default run", async ({ page }) => {
    await startGame(page);

    await page.keyboard.down("Alt");
    await page.keyboard.down("w");
    // Sample while the keys are still held; after release the character
    // decelerates into IDLE within a frame or two.
    const walking = await expectEventually(page, "walk state reached", (s) => s.movementState === "WALK" && s.speed > 1.5);
    await page.keyboard.up("w");
    await page.keyboard.up("Alt");

    expect(walking.speed).toBeLessThan(3.0);
  });

  test("comes to a complete stop when input is released", async ({ page }) => {
    await startGame(page);

    await holdKey(page, "w", 40);
    await frames(page, 40);
    const stopped = await snapshot(page);

    expect(stopped.speed).toBeLessThan(0.02);
    expect(stopped.movementState).toBe("IDLE");
  });

  test("survives movement held for an extended period", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);

    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await frames(page, 420);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");

    const state = await snapshot(page);
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.z)).toBe(true);
    // Still inside the arena: the perimeter walls held.
    expect(Math.abs(state.position.x)).toBeLessThan(30);
    expect(Math.abs(state.position.z)).toBeLessThan(30);
    expect(watcher.errors).toEqual([]);
  });
});

test.describe("jump", () => {
  test("leaves the ground, rises, falls, and lands", async ({ page }) => {
    await startGame(page);

    // Recorded in-page: the whole arc is under a second, and sampling it over
    // the test-to-browser round trip drops frames.
    const recording = recordFrames(page, 60);
    await page.keyboard.press("Space");
    const samples = await recording;

    const rising = samples.filter((s) => !s.grounded && s.velocity.y > 0);
    const falling = samples.filter((s) => !s.grounded && s.velocity.y < 0);

    expect(rising.length, "expected frames rising off the ground").toBeGreaterThan(0);
    expect(falling.length, "expected frames descending").toBeGreaterThan(0);
    expect(rising.every((s) => s.movementState === "JUMP")).toBe(true);
    expect(falling.some((s) => s.movementState === "FALL")).toBe(true);

    const landed = await expectEventually(page, "landed again", (s) => s.grounded);
    expect(landed.position.y).toBeLessThan(0.05);
  });

  test("reaches roughly the configured jump height", async ({ page }) => {
    await startGame(page);
    const ground = await snapshot(page);

    const recording = recordFrames(page, 60);
    await page.keyboard.press("Space");
    const samples = await recording;

    const peak = Math.max(...samples.map((s) => s.position.y));

    // jumpVelocity² / (2 × gravity) = 7.6² / 48 ≈ 1.20 m. The window is wide
    // because a frame can straddle the apex.
    expect(peak - ground.position.y).toBeGreaterThan(0.8);
    expect(peak - ground.position.y).toBeLessThan(1.6);
  });

  test("cannot jump again while airborne", async ({ page }) => {
    await startGame(page);

    const recording = recordFrames(page, 45);
    await page.keyboard.press("Space");
    // Spam jump during the arc. Every press after the first must be ignored
    // until the character is back on the ground.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Space");
    const samples = await recording;

    // Examine only the first airborne window. Beyond it the character has
    // landed, and jumping again there is correct, not a double jump.
    //
    // The window ends on either the grounded flag or a return to floor height:
    // one sampled frame can span several simulation ticks, so a landing and an
    // immediate re-jump can both happen between two samples and the flag alone
    // would never show it.
    const start = samples.findIndex((s) => !s.grounded);
    expect(start, "expected the character to leave the ground").toBeGreaterThanOrEqual(0);

    const airborne: typeof samples = [];
    for (let i = start; i < samples.length; i++) {
      const sample = samples[i];
      if (sample === undefined || sample.grounded || sample.position.y < 0.08) break;
      airborne.push(sample);
    }

    let sawDescent = false;
    let roseAfterDescent = false;
    for (const s of airborne) {
      if (s.velocity.y < -1) sawDescent = true;
      else if (sawDescent && s.velocity.y > 1) roseAfterDescent = true;
    }

    expect(sawDescent, "expected the character to start descending").toBe(true);
    expect(roseAfterDescent, "character gained height again without landing").toBe(false);
  });
});

test.describe("crouch", () => {
  test("crouching changes state and reduces speed", async ({ page }) => {
    await startGame(page);

    await page.keyboard.down("Control");
    await frames(page, 10);
    const crouched = await snapshot(page);
    expect(crouched.crouching).toBe(true);
    expect(crouched.movementState).toBe("CROUCH");

    await holdKey(page, "w", 40);
    const moving = await snapshot(page);
    expect(moving.speed).toBeLessThan(2.2);
    await page.keyboard.up("Control");

    await frames(page, 10);
    const standing = await snapshot(page);
    expect(standing.crouching).toBe(false);
  });

  test("cannot stand up under a low beam", async ({ page }) => {
    await startGame(page);

    // The crouch gate's beam underside sits at y = 1.4.
    await page.keyboard.down("Control");
    await frames(page, 10);
    await teleport(page, 0, 0, -18);
    await frames(page, 20);

    const under = await snapshot(page);
    expect(under.crouching).toBe(true);

    await page.keyboard.up("Control");
    await frames(page, 20);
    const stillCrouched = await snapshot(page);
    expect(stillCrouched.crouching).toBe(true);

    // Move clear of the beam; standing must then be allowed again.
    await teleport(page, 0, 0, -12);
    await frames(page, 25);
    const cleared = await snapshot(page);
    expect(cleared.crouching).toBe(false);
  });
});

test.describe("collision", () => {
  test("a wall stops the character", async ({ page }) => {
    await startGame(page);

    // Face the south perimeter wall (z = +30) and run at it.
    await teleport(page, 0, 0, 26);
    await applyMouseDelta(page, Math.PI / 0.0022, 0);
    await frames(page, 5);

    await page.keyboard.down("w");
    await frames(page, 120);
    await page.keyboard.up("w");

    const state = await snapshot(page);
    // Wall inner face is at z = 29.5; the capsule radius keeps the centre back.
    expect(state.position.z).toBeLessThan(29.5);
  });

  test("climbs stairs that are within the step height", async ({ page }) => {
    await startGame(page);

    await teleport(page, 13, 0.3, -5);
    await settle(page);
    const before = await snapshot(page);
    expect(before.position.y).toBeLessThan(0.1);

    // Face −Z, into the staircase, and walk up.
    await page.keyboard.down("w");
    const climbed = await expectEventually(
      page,
      "climbed the staircase",
      (s) => s.position.y > before.position.y + 0.9,
      300,
    );
    await page.keyboard.up("w");

    expect(climbed.grounded).toBe(true);
  });

  test("walks up the ramp to the elevated platform", async ({ page }) => {
    await startGame(page);

    await teleport(page, -14, 0.3, 3.0);
    await settle(page);
    const bottom = await snapshot(page);

    // Keep walking all the way onto the platform. The ramp tops out at y = 3 and
    // the platform's near edge meets it there; an earlier layout left a gap the
    // player fell through, so this asserts the join, not just the climb.
    await page.keyboard.down("w");
    const onPlatform = await expectEventually(
      page,
      "reached the platform at the top of the ramp",
      (s) => s.position.y > 2.95 && s.grounded,
      400,
    );
    await page.keyboard.up("w");

    expect(onPlatform.position.y).toBeGreaterThan(bottom.position.y + 2.9);
    expect(onPlatform.position.z).toBeLessThan(-5.5);
  });
});

test.describe("camera", () => {
  test("orbits with mouse movement and clamps pitch", async ({ page }) => {
    await startGame(page);
    const start = await snapshot(page);

    await applyMouseDelta(page, 400, 0);
    await frames(page, 3);
    const yawed = await snapshot(page);
    expect(yawed.cameraYaw).not.toBeCloseTo(start.cameraYaw, 3);

    // Drive pitch far past its limit in both directions.
    await applyMouseDelta(page, 0, 100000);
    await frames(page, 3);
    const maxPitch = (await snapshot(page)).cameraPitch;
    expect(maxPitch).toBeLessThanOrEqual((66 * Math.PI) / 180 + 1e-6);

    await applyMouseDelta(page, 0, -200000);
    await frames(page, 3);
    const minPitch = (await snapshot(page)).cameraPitch;
    expect(minPitch).toBeGreaterThanOrEqual((-58 * Math.PI) / 180 - 1e-6);
  });

  test("stays behind the character at the configured distance", async ({ page }) => {
    await startGame(page);
    await frames(page, 30);
    const state = await snapshot(page);

    const [cx, cy, cz] = state.cameraPosition;
    const pivotY = state.position.y + CAMERA_CONFIG.pivotHeight;
    const distance = Math.hypot(cx - state.position.x, cy - pivotY, cz - state.position.z);

    // Open ground: the boom should be at or near its full nominal length. Taken
    // from the config rather than restated, so tuning the framing does not mean
    // editing a number in two places and getting one of them wrong.
    expect(distance).toBeGreaterThan(CAMERA_CONFIG.distance * 0.85);
    expect(distance).toBeLessThan(CAMERA_CONFIG.distance * 1.2);
  });

  test("does not pull in when the player jumps on open ground", async ({ page }) => {
    await startGame(page);
    await frames(page, 30);

    const standing = await snapshot(page);
    expect(standing.cameraBoom).toBeGreaterThan(CAMERA_CONFIG.distance * 0.98);

    // Regression: the camera sweep used to include the player's own capsule.
    // Rising made the lagging pivot sit at torso height, where the capsule is at
    // full radius, so the sweep reported an immediate hit and the boom collapsed
    // to its floor for the whole ascent — with no obstacle anywhere near.
    const recording = recordFrames(page, 45);
    await page.keyboard.press("Space");
    const samples = await recording;

    expect(samples.some((s) => !s.grounded), "expected the character to leave the ground").toBe(true);

    const minBoom = Math.min(...samples.map((s) => s.cameraBoom));
    expect(minBoom).toBeGreaterThan(CAMERA_CONFIG.distance * 0.9);
    expect(Math.max(...samples.map((s) => s.cameraLift))).toBeLessThan(0.01);
  });

  test("keeps its distance while sprinting across open ground", async ({ page }) => {
    await startGame(page);

    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await expectEventually(page, "sprinting", (s) => s.movementState === "SPRINT");
    const samples = await recordFrames(page, 25);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");

    expect(Math.min(...samples.map((s) => s.cameraBoom))).toBeGreaterThan(CAMERA_CONFIG.distance * 0.9);
  });

  test("never places the camera beyond an obstruction, even when cornered", async ({ page }) => {
    await startGame(page);

    // Walk backwards into the south wall until the capsule is flush against it.
    await teleport(page, 0, 0, 26);
    await frames(page, 10);
    await page.keyboard.down("s");
    await frames(page, 60);
    await page.keyboard.up("s");
    await frames(page, 20);

    const cornered = await snapshot(page);
    expect(cornered.position.z).toBeGreaterThan(28.5);

    // Regression: minDistance used to be applied as a lower clamp on the sweep
    // result, so a boom shorter than the floor was extended back out — through
    // the wall the sweep had just found. The wall's inner face is at z = 29.5.
    expect(cornered.cameraPosition[2]).toBeLessThan(29.5);

    // Cornered, the boom lifts over the character instead of jamming into the
    // back of their head at eye level.
    expect(cornered.cameraLift).toBeGreaterThan(0.3);
    expect(cornered.cameraPosition[1]).toBeGreaterThan(cornered.position.y + 1.62);

    // Looking up while cornered points the unlifted boom into the floor behind
    // the player; the lift must still clear the wall.
    await applyMouseDelta(page, 0, -400);
    await frames(page, 25);
    const lookingUp = await snapshot(page);
    expect(lookingUp.cameraPosition[2]).toBeLessThan(29.5);
  });

  test("pulls in rather than clipping through a wall", async ({ page }) => {
    await startGame(page);

    await frames(page, 30);
    const open = await snapshot(page);
    const openDistance = Math.hypot(
      open.cameraPosition[0] - open.position.x,
      open.cameraPosition[2] - open.position.z,
    );

    // Back the character up against the south wall. At the default camera yaw the
    // boom points toward +Z, so the wall at z = 30 is directly behind the camera's
    // desired position — do NOT rotate here, or the boom swings into open ground
    // and the test passes without ever exercising collision.
    await teleport(page, 0, 0, 28.6);
    await frames(page, 40);

    const against = await snapshot(page);
    const closeDistance = Math.hypot(
      against.cameraPosition[0] - against.position.x,
      against.cameraPosition[2] - against.position.z,
    );

    // The boom must be pulled in substantially, not merely a little.
    expect(closeDistance).toBeLessThan(openDistance * 0.6);
    // And it must not end up inside or on the far side of the wall (face z = 29.5).
    expect(against.cameraPosition[2]).toBeLessThan(29.5);
  });
});

test.describe("animation", () => {
  test("reaches every ground locomotion state", async ({ page }) => {
    await startGame(page);

    // Each of these is a steady state that can be held, so the assertion does
    // not depend on catching a transient between two sampled frames. The
    // acceleration ramp *through* WALK on the way to RUN is covered
    // deterministically by the movement unit tests instead.
    expect((await snapshot(page)).movementState).toBe("IDLE");

    await page.keyboard.down("Alt");
    await page.keyboard.down("w");
    await expectEventually(page, "WALK", (s) => s.movementState === "WALK");

    await page.keyboard.up("Alt");
    await expectEventually(page, "RUN", (s) => s.movementState === "RUN");

    await page.keyboard.down("Shift");
    await expectEventually(page, "SPRINT", (s) => s.movementState === "SPRINT");

    await page.keyboard.down("Control");
    await expectEventually(page, "CROUCH", (s) => s.movementState === "CROUCH");

    await page.keyboard.up("Control");
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await expectEventually(page, "IDLE again", (s) => s.movementState === "IDLE");
  });

  test("does not report a locomotion state while standing still", async ({ page }) => {
    await startGame(page);
    await frames(page, 30);
    const state = await snapshot(page);

    expect(state.movementState).toBe("IDLE");
    expect(state.speed).toBeLessThan(0.02);
  });
});
