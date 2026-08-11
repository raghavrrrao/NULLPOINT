import { expect, test, type Page } from "@playwright/test";

import {
  ConsoleWatcher,
  engagePointerLock,
  expectEventually,
  frames,
  snapshot,
  startGame,
  teleport,
  type GameSnapshot,
} from "./helpers.ts";

/**
 * Mouse-look and camera continuity.
 *
 * Everything here drives the **real pointer-lock path**: synthetic `mousemove`
 * events carrying `movementX`/`movementY`, which is byte-for-byte what the
 * browser delivers to a locked page. Nothing reads the cursor's screen position,
 * which is the point — a locked cursor does not move, so a position-based camera
 * would stop turning after the first few pixels.
 *
 * Continuity is measured by unwrapping the camera's heading frame by frame. A
 * ±π seam, a reset after a full turn or a snap all show up the same way: one
 * frame whose step is wildly larger than its neighbours'.
 */

const OPEN_GROUND = { x: 0, y: 0.6, z: 6 };

/**
 * Pixels per mouse-move event, and how many such events make one full turn.
 *
 * Sized from the configured sensitivity (~0.0022 rad/px): 40 px is ~0.087 rad,
 * so ~72 events sweep 360°. Deliberately coarse — a headless frame costs ~75 ms,
 * and driving a triple rotation in 2 px steps takes longer than the test budget
 * allows while proving nothing extra.
 */
const STEP_PX = 40;
const EVENTS_PER_TURN = 80;

interface LookRun {
  /** Total rotation swept, radians, sign-preserving and unbounded. */
  readonly total: number;
  /** Per-frame steps, radians, already unwrapped. */
  readonly steps: number[];
  /** Camera yaw reported by the game on the final frame. */
  readonly finalYaw: number;
}

/**
 * Drives `count` mouse-move events of `dx` pixels and records the camera's
 * heading each frame.
 *
 * Runs entirely inside the page: a round trip per event would take minutes and
 * would also let the game run unobserved between samples, which is precisely
 * where a snap could hide.
 */
async function drag(page: Page, count: number, dx: number, dy = 0): Promise<LookRun> {
  return page.evaluate(
    async ([n, deltaX, deltaY]) => {
      const hook = (window as unknown as { __NULLPOINT__: { inspect(): GameSnapshot } }).__NULLPOINT__;
      const canvas = document.querySelector("canvas");
      if (canvas === null) throw new Error("no canvas");

      const yaws: number[] = [];
      for (let i = 0; i < (n as number); i++) {
        canvas.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            movementX: deltaX as number,
            movementY: deltaY as number,
          }),
        );
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        yaws.push(hook.inspect().cameraYaw);
      }

      const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
      const steps: number[] = [];
      let total = 0;
      for (let i = 1; i < yaws.length; i++) {
        const step = wrap((yaws[i] ?? 0) - (yaws[i - 1] ?? 0));
        steps.push(step);
        total += step;
      }
      return { total, steps, finalYaw: yaws[yaws.length - 1] ?? 0 };
    },
    [count, dx, dy] as const,
  );
}

/** Largest deviation of any single frame from the median step, radians. */
function worstDeviation(run: LookRun): number {
  if (run.steps.length === 0) return 0;
  const sorted = [...run.steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return Math.max(...run.steps.map((s) => Math.abs(s - median)));
}

async function ready(page: Page): Promise<void> {
  await startGame(page);
  await engagePointerLock(page);
  await teleport(page, OPEN_GROUND.x, OPEN_GROUND.y, OPEN_GROUND.z);
  await frames(page, 20);
}

test.describe("mouse look", () => {
  test("uses relative movement, not cursor position", async ({ page }) => {
    await ready(page);

    // Every event reports the same movementX from the same notional cursor
    // position. A camera driven by cursor position would turn once and stop.
    const before = (await snapshot(page)).cameraYaw;
    const run = await drag(page, 40, 10);
    const after = (await snapshot(page)).cameraYaw;

    expect(Math.abs(after - before), "the camera must keep turning").toBeGreaterThan(0.5);
    expect(run.steps.every((s) => Math.abs(s) > 1e-6), "every event should turn the camera").toBe(true);
  });

  test("turns right for rightward movement and left for leftward", async ({ page }) => {
    await ready(page);

    const right = await drag(page, 30, 12);
    const left = await drag(page, 30, -12);

    // Right is a clockwise turn seen from above, which is negative about +Y.
    expect(right.total).toBeLessThan(0);
    expect(left.total).toBeGreaterThan(0);
    expect(Math.abs(right.total + left.total), "the two should cancel").toBeLessThan(0.01);
  });
});

test.describe("unlimited horizontal rotation", () => {
  for (const turns of [1, 2, 3]) {
    test(`sweeps ${turns * 360}° clockwise without a discontinuity`, async ({ page }) => {
      await ready(page);

      // Sized to comfortably exceed the requested rotation.
      const run = await drag(page, EVENTS_PER_TURN * turns, STEP_PX);

      expect(Math.abs(run.total), `should sweep at least ${turns * 360}°`).toBeGreaterThan(
        turns * 2 * Math.PI,
      );
      // A ±π wrap would show up as a ~2π step on one frame; a reset after a full
      // turn likewise. The tolerance is far below either.
      expect(worstDeviation(run), "no frame may jump").toBeLessThan(0.05);
    });
  }

  test("sweeps 1080° anticlockwise without a discontinuity", async ({ page }) => {
    await ready(page);

    const run = await drag(page, EVENTS_PER_TURN * 3, -STEP_PX);

    expect(run.total).toBeGreaterThan(3 * 2 * Math.PI);
    expect(worstDeviation(run)).toBeLessThan(0.05);
  });

  test("keeps a constant degrees-per-pixel across many turns", async ({ page }) => {
    await ready(page);

    const first = await drag(page, 40, STEP_PX);
    // Now well past a full rotation, where a wrap or reset would live.
    await drag(page, EVENTS_PER_TURN * 2, STEP_PX);
    const later = await drag(page, 40, STEP_PX);

    // Sensitivity must not change with accumulated rotation.
    expect(Math.abs(later.total - first.total)).toBeLessThan(0.01);
  });

  test("crosses the ±π boundary smoothly in both directions", async ({ page }) => {
    await ready(page);

    // Walk to just short of the ±π seam, then step across it a fraction of a
    // degree at a time — the crossing itself is what is under test.
    await drag(page, 35, STEP_PX);
    const across = await drag(page, 60, 2);
    expect(worstDeviation(across), "the ±π seam must not be visible").toBeLessThan(0.02);

    const back = await drag(page, 60, -2);
    expect(worstDeviation(back)).toBeLessThan(0.02);
  });

  test("survives rapid direction reversal", async ({ page }) => {
    await ready(page);

    for (let i = 0; i < 6; i++) {
      const forth = await drag(page, 12, 30);
      const back = await drag(page, 12, -30);
      expect(worstDeviation(forth)).toBeLessThan(0.05);
      expect(worstDeviation(back)).toBeLessThan(0.05);
    }
  });

  test("rotates continuously while walking, sprinting, crouching and airborne", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await ready(page);

    await page.keyboard.down("w");
    await frames(page, 20);
    expect(worstDeviation(await drag(page, 60, 14)), "while running").toBeLessThan(0.05);

    await page.keyboard.down("Shift");
    await frames(page, 20);
    expect(worstDeviation(await drag(page, 60, 14)), "while sprinting").toBeLessThan(0.05);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await frames(page, 20);

    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    expect(worstDeviation(await drag(page, 60, 14)), "while crouched").toBeLessThan(0.05);
    await page.keyboard.up("Control");
    await frames(page, 25);

    await page.keyboard.press("Space");
    expect(worstDeviation(await drag(page, 25, 14)), "while airborne").toBeLessThan(0.05);

    expect(watcher.errors).toEqual([]);
  });
});

test.describe("vertical look", () => {
  test("is clamped and does not wrap", async ({ page }) => {
    await ready(page);

    // Far more input than the pitch range can absorb, in both directions.
    await drag(page, 60, 0, -60);
    const up = await snapshot(page);
    await drag(page, 120, 0, 60);
    const down = await snapshot(page);

    expect(up.cameraPitch).toBeLessThan(0);
    expect(down.cameraPitch).toBeGreaterThan(0);
    // A clamp, not a wrap: past the limit the value must stop, not reappear at
    // the other end.
    expect(Math.abs(up.cameraPitch)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(down.cameraPitch)).toBeLessThan(Math.PI / 2);
  });

  test("is not inverted, and stays that way after full rotations", async ({ page }) => {
    await ready(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);

    // Three full turns first: the vertical sign must not depend on where the
    // horizontal accumulator happens to be.
    await drag(page, EVENTS_PER_TURN * 3, STEP_PX);

    await drag(page, 20, 0, -30);
    const up = await snapshot(page);
    expect(up.cameraPitch, "mouse up should look up").toBeLessThan(-0.3);
    expect(up.weaponForward[1], "and the barrel should follow up").toBeGreaterThan(0.2);

    await drag(page, 40, 0, 30);
    const down = await snapshot(page);
    expect(down.cameraPitch, "mouse down should look down").toBeGreaterThan(0.3);
    expect(down.weaponForward[1], "and the barrel should follow down").toBeLessThan(-0.2);

    await page.mouse.up({ button: "right" });
  });
});

test.describe("weapon aim through rotation", () => {
  test("tracks the camera exactly across 1080°", async ({ page }) => {
    await ready(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);

    const worst = await page.evaluate(async () => {
      const hook = (window as unknown as { __NULLPOINT__: { inspect(): GameSnapshot } }).__NULLPOINT__;
      const canvas = document.querySelector("canvas");
      if (canvas === null) throw new Error("no canvas");

      let worstAim = 0;
      let worstGrip = 0;
      for (let i = 0; i < 240; i++) {
        canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 40, movementY: 0 }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const s = hook.inspect();
        const heading = Math.atan2(-s.weaponForward[0], -s.weaponForward[2]);
        const error = Math.atan2(Math.sin(heading - s.cameraYaw), Math.cos(heading - s.cameraYaw));
        worstAim = Math.max(worstAim, Math.abs(error));
        worstGrip = Math.max(worstGrip, s.handGripError.right, s.handGripError.left);
      }
      return { worstAim, worstGrip };
    });

    await page.mouse.up({ button: "right" });

    // No accumulated error: the barrel is still on the crosshair three turns on.
    expect(worst.worstAim, "barrel must stay on the aim heading").toBeLessThan(0.15);
    expect(worst.worstGrip, "hands must stay on the weapon").toBeLessThan(0.05);
  });

  test("holds the weapon through rotation in every stance", async ({ page }) => {
    await ready(page);

    const sweep = async (label: string): Promise<void> => {
      const worst = await page.evaluate(async () => {
        const hook = (window as unknown as { __NULLPOINT__: { inspect(): GameSnapshot } }).__NULLPOINT__;
        const canvas = document.querySelector("canvas");
        if (canvas === null) throw new Error("no canvas");
        let grip = 0;
        for (let i = 0; i < 70; i++) {
          canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 20, movementY: 0 }));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const s = hook.inspect();
          grip = Math.max(grip, s.handGripError.right, s.handGripError.left);
        }
        return grip;
      });
      expect(worst, label).toBeLessThan(0.08);
    };

    await sweep("hip");

    await page.mouse.down({ button: "right" });
    await sweep("aiming");
    await page.mouse.up({ button: "right" });
    await frames(page, 20);

    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    await sweep("crouched");
    await page.keyboard.up("Control");
    await frames(page, 25);

    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await frames(page, 20);
    await sweep("sprinting");
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
  });
});

test.describe("character rotation stays independent of the camera", () => {
  test("the legs do not track the camera one-to-one", async ({ page }) => {
    await ready(page);

    const before = await snapshot(page);
    // A small turn, well inside the standing deadzone.
    await drag(page, 12, 10);
    const after = await snapshot(page);

    const cameraTurn = Math.abs(after.cameraYaw - before.cameraYaw);
    const bodyTurn = Math.abs(
      Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw)),
    );
    expect(cameraTurn).toBeGreaterThan(0.1);
    expect(bodyTurn, "the deadzone should absorb a small turn").toBeLessThan(cameraTurn * 0.6);
  });

  test("backpedalling while aiming does not spin the character", async ({ page }) => {
    await ready(page);

    const before = await snapshot(page);
    await page.mouse.down({ button: "right" });
    await page.keyboard.down("s");
    await frames(page, 70);
    const during = await snapshot(page);
    await page.keyboard.up("s");
    await page.mouse.up({ button: "right" });

    const spin = Math.abs(
      Math.atan2(Math.sin(during.yaw - before.yaw), Math.cos(during.yaw - before.yaw)),
    );
    expect(spin, "S must not turn the character around").toBeLessThan(0.25);
    expect(during.position.z).toBeGreaterThan(before.position.z + 1);
  });

  test("strafing while aiming holds the aim heading", async ({ page }) => {
    await ready(page);
    await page.mouse.down({ button: "right" });
    await expectEventually(page, "aim engaged", (s) => s.aimAmount > 0.98);

    const before = await snapshot(page);
    await page.keyboard.down("d");
    await frames(page, 45);
    const during = await snapshot(page);
    await page.keyboard.up("d");
    await page.mouse.up({ button: "right" });

    // Moved sideways, but the view heading is unchanged: movement direction and
    // camera yaw are independent.
    expect(Math.hypot(during.position.x - before.position.x, during.position.z - before.position.z))
      .toBeGreaterThan(0.8);
    expect(Math.abs(during.cameraYaw - before.cameraYaw)).toBeLessThan(0.01);
  });
});
