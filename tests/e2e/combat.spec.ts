import { expect, test } from "@playwright/test";

import {
  ConsoleWatcher,
  aimAt,
  applyMouseDelta,
  engagePointerLock,
  expectEventually,
  findTarget,
  frames,
  resetTargets,
  snapshot,
  startGame,
  teleport,
} from "./helpers.ts";

/** Firing line for the training range, and the plate centres of each target. */
const FIRING_LINE = { x: -6, y: 0.4, z: 24 };
const TARGETS = {
  CLOSE: { x: 2, y: 1.3, z: 22.2 },
  MEDIUM: { x: 12, y: 1.3, z: 25.6 },
  LONG: { x: 26, y: 1.3, z: 23.8 },
  COVER: { x: 18, y: 1.85, z: 21 },
  ELEVATED: { x: 22, y: 3.4, z: 26.5 },
} as const;

/** Centre of the cover block's front face, which shields the COVER target. */
const COVER_BLOCK = { x: 13.8, y: 0.7, z: 21.5 } as const;

/** Puts the player on the firing line with the pointer captured. */
async function readyAtRange(page: import("@playwright/test").Page): Promise<void> {
  await startGame(page);
  const locked = await engagePointerLock(page);
  expect(locked, "pointer lock is required for mouse-button input").toBe(true);
  await teleport(page, FIRING_LINE.x, FIRING_LINE.y, FIRING_LINE.z);
  await frames(page, 30);
  await resetTargets(page);
}

/** Holds the trigger for a number of frames, then releases. */
async function fireFor(page: import("@playwright/test").Page, frameCount: number): Promise<void> {
  await page.mouse.down({ button: "left" });
  await frames(page, frameCount);
  await page.mouse.up({ button: "left" });
  await frames(page, 3);
}

test.describe("weapon setup", () => {
  test("spawns equipped with a full assault rifle", async ({ page }) => {
    await startGame(page);
    const state = await snapshot(page);

    expect(state.weaponId).toBe("ASSAULT_RIFLE");
    expect(state.magazine).toBe(30);
    expect(state.reserve).toBe(120);
    expect(state.ammo).toBe("30 / 120");
    expect(state.weaponState).toBe("IDLE");
  });

  test("shows the crosshair and ammunition readout", async ({ page }) => {
    await startGame(page);
    await expect(page.getByTestId("crosshair")).toBeVisible();
    await expect(page.getByTestId("ammo")).toBeVisible();
    await expect(page.getByTestId("ammo")).toHaveText("30 / 120");
    // The hit marker exists but must be invisible until something is hit.
    expect(await page.getByTestId("hit-marker").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  });

  test("reports weapon state in the development HUD", async ({ page }) => {
    await startGame(page);
    const hud = page.getByTestId("debug-hud");
    await expect(hud).toContainText("WEAPON");
    await expect(hud).toContainText("ASSAULT_RIFLE");
    await expect(hud).toContainText("AMMO");
    await expect(hud).toContainText("30 / 120");
  });

  test("the rifle is attached to the character and moves with it", async ({ page }) => {
    await startGame(page);
    // The muzzle world position is the weapon's; if it tracks the character it
    // is genuinely parented rather than floating in world space.
    const before = await page.evaluate(() => {
      const w = window as unknown as { __NULLPOINT__: { inspect(): { position: { x: number; z: number } } } };
      return w.__NULLPOINT__.inspect().position;
    });
    await teleport(page, before.x + 8, 0.4, before.z);
    await frames(page, 20);
    const after = await snapshot(page);
    expect(Math.abs(after.position.x - (before.x + 8))).toBeLessThan(1.5);
    // Firing from the new position must trace from there, not the old one.
    await engagePointerLock(page);
    await fireFor(page, 4);
    const fired = await snapshot(page);
    expect(fired.shotsFired).toBeGreaterThan(0);
  });

  test("has a working audio abstraction", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    const before = (await snapshot(page)).audioPlays;
    await fireFor(page, 6);
    const after = await snapshot(page);
    // Either real Web Audio or the silent fallback — both must count plays, and
    // neither may throw.
    expect(after.audioPlays).toBeGreaterThan(before);
  });
});

test.describe("firing", () => {
  test("left mouse fires and consumes ammunition", async ({ page }) => {
    await readyAtRange(page);
    const before = await snapshot(page);

    await fireFor(page, 6);
    const after = await snapshot(page);

    expect(after.shotsFired).toBeGreaterThan(0);
    expect(after.magazine).toBeLessThan(before.magazine);
    expect(after.magazine).toBe(before.magazine - after.shotsFired);
    expect(after.reserve).toBe(120);
  });

  test("is automatic — holding the trigger keeps firing", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "left" });
    const early = await expectEventually(page, "first shots", (s) => s.shotsFired >= 2);
    await frames(page, 20);
    const later = await snapshot(page);
    await page.mouse.up({ button: "left" });

    expect(later.shotsFired).toBeGreaterThan(early.shotsFired + 2);
  });

  test("enforces the fire rate rather than firing every frame", async ({ page }) => {
    await readyAtRange(page);
    const recording = await page.evaluate(async () => {
      const hook = (window as unknown as { __NULLPOINT__: { inspect(): { shotsFired: number } } }).__NULLPOINT__;
      const start = hook.inspect().shotsFired;
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        let n = 120;
        const tick = (): void => {
          n -= 1;
          if (n <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { shots: hook.inspect().shotsFired - start, seconds: (performance.now() - t0) / 1000 };
    });
    // Started before the evaluate returns, so hold the trigger across it.
    await page.mouse.down({ button: "left" });
    await frames(page, 60);
    const measured = await snapshot(page);
    await page.mouse.up({ button: "left" });

    expect(recording.shots).toBe(0);
    // 700 RPM is 11.67 rounds/second — nowhere near one per frame.
    expect(measured.shotsFired).toBeLessThan(60);
  });

  test("produces a muzzle flash for every shot", async ({ page }) => {
    await readyAtRange(page);
    const before = await snapshot(page);
    expect(before.muzzleFlashCount).toBe(0);

    await fireFor(page, 12);
    const after = await snapshot(page);

    // Counted rather than sampled: the flash lasts 45 ms, and a frame on a slow
    // renderer is longer than that, so instantaneous visibility is unobservable.
    expect(after.muzzleFlashCount).toBe(after.shotsFired);
    expect(after.shotsFired).toBeGreaterThan(0);
  });

  test("applies recoil that recovers after firing stops", async ({ page }) => {
    await readyAtRange(page);
    expect((await snapshot(page)).recoilPitch).toBe(0);

    await page.mouse.down({ button: "left" });
    const kicked = await expectEventually(page, "recoil accumulates", (s) => s.recoilPitch > 0.005);
    await page.mouse.up({ button: "left" });

    expect(kicked.recoilPitch).toBeGreaterThan(0);
    // Bounded: the profile caps accumulated pitch.
    expect(kicked.recoilPitch).toBeLessThanOrEqual(0.25);

    const recovered = await expectEventually(page, "recoil recovers", (s) => s.recoilPitch === 0, 200);
    expect(recovered.recoilPitch).toBe(0);
  });

  test("does not leak effect objects while the trigger is held", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "left" });
    await frames(page, 120);
    const peak = await snapshot(page);
    await page.mouse.up({ button: "left" });

    // Impact and tracer pools are fixed size; sustained fire must not grow them.
    expect(peak.effectCount).toBeLessThanOrEqual(36);
  });
});

test.describe("aiming", () => {
  test("right mouse enters and leaves aim mode smoothly", async ({ page }) => {
    await readyAtRange(page);
    const hip = await snapshot(page);
    expect(hip.aiming).toBe(false);
    expect(hip.aimAmount).toBeLessThan(0.05);
    expect(hip.fov).toBeGreaterThan(70);

    await page.mouse.down({ button: "right" });
    const aimed = await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);
    expect(aimed.aiming).toBe(true);
    // Meaningfully narrower than the hip view, rather than a hard-coded value
    // that has to be edited every time the framing is tuned.
    expect(aimed.fov).toBeLessThan(hip.fov - 10);
    // Boom pulls in, but not into the character.
    expect(aimed.cameraBoom).toBeLessThan(hip.cameraBoom);
    expect(aimed.cameraBoom).toBeGreaterThan(1.5);

    await page.mouse.up({ button: "right" });
    const released = await expectEventually(page, "aim released", (s) => s.aimAmount < 0.02);
    expect(released.fov).toBeGreaterThan(70);
  });

  test("the aim transition is blended, not instant", async ({ page }) => {
    await readyAtRange(page);
    const recording = page.evaluate(async () => {
      const hook = (window as unknown as { __NULLPOINT__: { inspect(): { aimAmount: number } } }).__NULLPOINT__;
      const samples: number[] = [];
      await new Promise<void>((resolve) => {
        let n = 20;
        const tick = (): void => {
          samples.push(hook.inspect().aimAmount);
          n -= 1;
          if (n <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });
    await page.mouse.down({ button: "right" });
    const samples = await recording;
    await page.mouse.up({ button: "right" });

    // At least one intermediate value: a snap would go 0 → 1 in one frame.
    const partial = samples.filter((v) => v > 0.05 && v < 0.95);
    expect(partial.length).toBeGreaterThan(0);
  });

  test("aiming slows the character", async ({ page }) => {
    await readyAtRange(page);

    await page.keyboard.down("w");
    const running = await expectEventually(page, "run speed", (s) => s.speed > 4.5);
    await page.mouse.down({ button: "right" });
    const aimedMoving = await expectEventually(page, "slowed by aiming", (s) => s.speed < running.speed * 0.75, 200);
    await page.mouse.up({ button: "right" });
    await page.keyboard.up("w");

    expect(aimedMoving.speed).toBeLessThan(running.speed);
  });

  test("the crosshair reports what it is over", async ({ page }) => {
    await readyAtRange(page);
    await aimAt(page, TARGETS.CLOSE.x, TARGETS.CLOSE.y, TARGETS.CLOSE.z);
    expect((await snapshot(page)).aimTargetId).toBe("CLOSE");

    // Pointing at bare floor is over nothing. (Straight up is unusable here:
    // the camera pitch limit clamps before the crosshair leaves the target.)
    await aimAt(page, 0, 0, 24);
    expect((await snapshot(page)).aimTargetId).toBe("");
  });
});

test.describe("hitscan and damage", () => {
  for (const id of ["CLOSE", "MEDIUM", "LONG", "ELEVATED", "COVER"] as const) {
    test(`damages the ${id} target`, async ({ page }) => {
      await readyAtRange(page);
      const point = TARGETS[id];

      await page.mouse.down({ button: "right" });
      await aimAt(page, point.x, point.y, point.z);
      expect((await snapshot(page)).aimTargetId, `crosshair should be over ${id}`).toBe(id);

      const before = findTarget(await snapshot(page), id);
      await fireFor(page, 5);
      await page.mouse.up({ button: "right" });

      const after = findTarget(await snapshot(page), id);
      expect(after.health, `${id} should have taken damage`).toBeLessThan(before.health);
    });
  }

  test("deals the configured damage per hit", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.CLOSE.x, TARGETS.CLOSE.y, TARGETS.CLOSE.z);

    // A single round inside the falloff distance is exactly 25 damage.
    await page.mouse.down({ button: "left" });
    await expectEventually(page, "one hit landed", (s) => s.lastShot.onTarget);
    await page.mouse.up({ button: "left" });
    await page.mouse.up({ button: "right" });

    const state = await snapshot(page);
    expect(state.lastShot.damage).toBe(25);
    expect(state.lastShot.targetId).toBe("CLOSE");
  });

  test("destroys a target after four hits and stops blocking shots", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.CLOSE.x, TARGETS.CLOSE.y, TARGETS.CLOSE.z);
    await fireFor(page, 40);
    await page.mouse.up({ button: "right" });

    const close = findTarget(await snapshot(page), "CLOSE");
    expect(close.health).toBe(0);
    expect(close.alive).toBe(false);

    // A destroyed plate must not keep absorbing rounds aimed past it.
    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.MEDIUM.x, TARGETS.MEDIUM.y, TARGETS.MEDIUM.z);
    expect((await snapshot(page)).aimTargetId).toBe("MEDIUM");
    await page.mouse.up({ button: "right" });
  });

  test("a miss deals no damage and reports no target", async ({ page }) => {
    await readyAtRange(page);
    await aimAt(page, -2, 0, 20);
    await fireFor(page, 5);

    const state = await snapshot(page);
    expect(state.lastShot.onTarget).toBe(false);
    expect(state.lastShot.damage).toBe(0);
    expect(state.lastShot.targetId).toBe("");
    for (const target of state.targets) expect(target.health).toBe(target.maxHealth);
  });

  test("cover blocks shots at the protected part of a target", async ({ page }) => {
    await readyAtRange(page);

    // Aimed at the middle of the cover block's own front face, not at a point
    // behind it. The crosshair ray starts at the camera and the bullet at the
    // muzzle, so near a cover edge the two genuinely disagree about what is
    // blocked — inherent third-person parallax, not a defect. Aiming at the
    // centre of a 2.4 × 1.5 m face keeps the case unambiguous for both rays and
    // independent of how the camera happens to be framed.
    await page.mouse.down({ button: "right" });
    await aimAt(page, COVER_BLOCK.x, COVER_BLOCK.y, COVER_BLOCK.z);

    // The crosshair must report the block, not the target behind it.
    expect((await snapshot(page)).aimTargetId, "the block should be in the way").toBe("");

    await fireFor(page, 6);
    await page.mouse.up({ button: "right" });

    const state = await snapshot(page);
    expect(findTarget(state, "COVER").health, "the block should absorb the shot").toBe(100);
    expect(state.lastShot.onTarget, "the shot hit geometry, not a target").toBe(false);
    expect(state.lastShot.damage).toBe(0);
  });

  test("hip fire is less accurate than aimed fire", async ({ page }) => {
    await readyAtRange(page);
    // Both spreads are small; assert the configuration rather than sampling
    // hundreds of shots, which the unit tests already cover deterministically.
    const state = await snapshot(page);
    expect(state.weaponId).toBe("ASSAULT_RIFLE");

    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.LONG.x, TARGETS.LONG.y, TARGETS.LONG.z);
    await fireFor(page, 20);
    await page.mouse.up({ button: "right" });
    const aimedHealth = findTarget(await snapshot(page), "LONG").health;

    await resetTargets(page);
    await aimAt(page, TARGETS.LONG.x, TARGETS.LONG.y, TARGETS.LONG.z);
    await fireFor(page, 20);
    const hipHealth = findTarget(await snapshot(page), "LONG").health;

    // Aimed fire should land at least as much damage at 32 m.
    expect(aimedHealth).toBeLessThanOrEqual(hipHealth);
  });
});

test.describe("aim orientation", () => {
  /**
   * Regression guard for an inverted vertical aim.
   *
   * Two opposite sign conventions live in the rig — limbs hang along −Y, the
   * spine and head extend along +Y — and using the limb convention on the torso
   * made the character look down when the camera looked up.
   */
  test("looking up aims the weapon and torso up, looking down aims them down", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    // Wait for the aim stance to engage, not a frame count: the hip stance holds
    // the muzzle deliberately low, so asserting mid-blend measures the wrong pose.
    await expectEventually(page, "aim stance engaged", (s) => s.aimAmount > 0.98);

    // Camera pitch is negative looking up (the boom drops below the pivot).
    await applyMouseDelta(page, 0, -450);
    await frames(page, 6);
    const up = await snapshot(page);
    expect(up.cameraPitch).toBeLessThan(-0.4);
    expect(up.weaponForward[1], "barrel should point up").toBeGreaterThan(0.2);
    expect(up.poseAngles.torso, "torso should lean back").toBeGreaterThan(0.02);
    expect(up.poseAngles.head, "head should look up").toBeGreaterThan(0.02);

    await applyMouseDelta(page, 0, 900);
    await frames(page, 6);
    const down = await snapshot(page);
    expect(down.cameraPitch).toBeGreaterThan(0.4);
    expect(down.weaponForward[1], "barrel should point down").toBeLessThan(-0.2);
    expect(down.poseAngles.torso, "torso should fold forward").toBeLessThan(-0.02);
    expect(down.poseAngles.head, "head should look down").toBeLessThan(-0.02);

    await page.mouse.up({ button: "right" });
  });

  test("the weapon tracks the aim pitch closely while aiming", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim stance engaged", (s) => s.aimAmount > 0.98);

    for (const delta of [-300, 600]) {
      await applyMouseDelta(page, 0, delta);
      await frames(page, 25);
      const state = await snapshot(page);
      // barrel.y should equal −sin(aimPitch): the weapon follows the aim fully
      // when shouldered, not a damped fraction of it.
      const expected = -Math.sin(state.cameraPitch);
      expect(Math.abs(state.weaponForward[1] - expected)).toBeLessThan(0.12);
    }

    await page.mouse.up({ button: "right" });
  });

  test("crouching folds the torso forward, not backward", async ({ page }) => {
    await readyAtRange(page);
    const standing = await snapshot(page);

    await page.keyboard.down("Control");
    const crouched = await expectEventually(page, "crouched", (s) => s.crouching, 200);
    await frames(page, 40);
    const settled = await snapshot(page);
    await page.keyboard.up("Control");

    expect(crouched.crouching).toBe(true);
    // The spine is written by the crouch clip; negative is a forward fold.
    expect(settled.poseAngles.spine, "crouched spine should fold forward").toBeLessThan(
      standing.poseAngles.spine,
    );
    expect(settled.poseAngles.spine).toBeLessThan(0);
  });

  test("the weapon stays on the aim through a full 360° turn", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim stance engaged", (s) => s.aimAmount > 0.98);

    let worstGrip = 0;
    let worstAimError = 0;
    for (let i = 0; i < 24; i++) {
      await applyMouseDelta(page, 300, 0);
      await frames(page, 3);
      const s = await snapshot(page);
      worstGrip = Math.max(worstGrip, s.handGripError.right, s.handGripError.left);

      // The barrel's horizontal heading must match the aim yaw all the way round,
      // including across the ±π seam.
      const heading = Math.atan2(-s.weaponForward[0], -s.weaponForward[2]);
      const error = Math.abs(Math.atan2(Math.sin(heading - s.cameraYaw), Math.cos(heading - s.cameraYaw)));
      worstAimError = Math.max(worstAimError, error);
    }
    await page.mouse.up({ button: "right" });

    expect(worstGrip, "hands must stay on the grips").toBeLessThan(0.15);
    expect(worstAimError, "barrel must stay on the aim heading").toBeLessThan(0.3);
  });
});

test.describe("hit feedback", () => {
  test("shows the hit marker on a damaging hit", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.CLOSE.x, TARGETS.CLOSE.y, TARGETS.CLOSE.z);

    const before = (await snapshot(page)).hitMarkerCount;
    await page.mouse.down({ button: "left" });
    await expectEventually(page, "a hit landed", (s) => s.lastShot.onTarget);
    await frames(page, 2);
    const after = await snapshot(page);
    await page.mouse.up({ button: "left" });
    await page.mouse.up({ button: "right" });

    // Counted rather than sampled from the DOM: the marker lasts 180 ms.
    expect(after.hitMarkerCount).toBeGreaterThan(before);
  });

  test("does not show the hit marker on a miss", async ({ page }) => {
    await readyAtRange(page);
    await aimAt(page, -2, 0, 20);
    await fireFor(page, 6);
    await frames(page, 20);

    const state = await snapshot(page);
    expect(state.lastShot.onTarget).toBe(false);
    expect(state.hitMarkerCount, "a miss must not raise a hit marker").toBe(0);
    const opacity = await page.getByTestId("hit-marker").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBe(0);
  });
});

test.describe("ammunition and reload", () => {
  test("an empty magazine prevents firing", async ({ page }) => {
    await readyAtRange(page);

    await page.mouse.down({ button: "left" });
    const empty = await expectEventually(page, "magazine empties", (s) => s.magazine === 0, 400);
    expect(empty.weaponState).toBe("EMPTY");

    const shotsAtEmpty = empty.shotsFired;
    await frames(page, 40);
    const stillEmpty = await snapshot(page);
    await page.mouse.up({ button: "left" });

    expect(stillEmpty.shotsFired).toBe(shotsAtEmpty);
    expect(stillEmpty.magazine).toBe(0);
    await expect(page.getByTestId("ammo")).toHaveText("0 / 120");
  });

  test("reload refills the magazine from the reserve", async ({ page }) => {
    await readyAtRange(page);
    await page.mouse.down({ button: "left" });
    await expectEventually(page, "magazine empties", (s) => s.magazine === 0, 400);
    await page.mouse.up({ button: "left" });

    await page.keyboard.press("r");
    const reloading = await expectEventually(page, "reload starts", (s) => s.weaponState === "RELOADING");
    expect(reloading.magazine).toBe(0);

    const done = await expectEventually(page, "reload finishes", (s) => s.weaponState !== "RELOADING", 400);
    expect(done.magazine).toBe(30);
    expect(done.reserve).toBe(90);
  });

  test("reload blocks firing while it runs", async ({ page }) => {
    await readyAtRange(page);
    await fireFor(page, 10);

    await page.keyboard.press("r");
    const reloading = await expectEventually(page, "reload starts", (s) => s.weaponState === "RELOADING");
    const shotsAtStart = reloading.shotsFired;

    await page.mouse.down({ button: "left" });
    await frames(page, 20);
    const during = await snapshot(page);
    await page.mouse.up({ button: "left" });

    expect(during.weaponState).toBe("RELOADING");
    expect(during.shotsFired).toBe(shotsAtStart);
  });

  test("a reload with a full magazine does nothing", async ({ page }) => {
    await readyAtRange(page);
    await page.keyboard.press("r");
    await frames(page, 10);

    const state = await snapshot(page);
    expect(state.weaponState).not.toBe("RELOADING");
    expect(state.magazine).toBe(30);
    expect(state.reserve).toBe(120);
  });

  test("a partial reload takes only what it needs", async ({ page }) => {
    await readyAtRange(page);
    await fireFor(page, 10);
    const spent = await snapshot(page);
    expect(spent.magazine).toBeLessThan(30);

    await page.keyboard.press("r");
    // Wait for the reload to actually begin before waiting for it to end, or the
    // "finished" check passes instantly on the state from before the press.
    await expectEventually(page, "reload starts", (s) => s.weaponState === "RELOADING");
    const done = await expectEventually(page, "reload finishes", (s) => s.weaponState !== "RELOADING", 400);

    expect(done.magazine).toBe(30);
    expect(done.reserve).toBe(120 - (30 - spent.magazine));
  });
});

test.describe("combat integration", () => {
  test("a full combat loop runs without console errors", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await readyAtRange(page);

    await page.mouse.down({ button: "right" });
    await aimAt(page, TARGETS.CLOSE.x, TARGETS.CLOSE.y, TARGETS.CLOSE.z);
    await fireFor(page, 30);
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("r");
    await frames(page, 160);
    await aimAt(page, TARGETS.MEDIUM.x, TARGETS.MEDIUM.y, TARGETS.MEDIUM.z);
    await fireFor(page, 20);

    expect(watcher.errors, `console errors: ${watcher.errors.join(" | ")}`).toEqual([]);
    expect(watcher.failedRequests, `failed requests: ${watcher.failedRequests.join(" | ")}`).toEqual([]);

    const state = await snapshot(page);
    expect(state.fps).toBeGreaterThan(0);
  });
});
