import { expect, test, type Page } from "@playwright/test";

import { MAP01_METRICS } from "../../packages/client/src/map/map01.ts";

import {
  ConsoleWatcher,
  aimAt,
  damagePlayer,
  engagePointerLock,
  expectEventually,
  findBot,
  findTarget,
  frames,
  healPlayer,
  recordFrames,
  snapshot,
  startGame,
  teleport,
} from "./helpers.ts";

/**
 * MAP 01 — "Substation".
 *
 * These assert that the map is *playable*, not that it looks a particular way:
 * the climbs are climbable, the boundary holds, the spawns are on solid ground,
 * and the existing camera, combat and bot systems work inside it.
 *
 * Every test loads the map explicitly rather than relying on the default, so a
 * future change of default cannot quietly turn these into tests of something
 * else. One test does the opposite on purpose, and checks the default is MAP01.
 */

const MAP = "MAP01";
const BOT = "BOT_ALPHA";

/** Camera yaw 0 looks along −Z, so this is "face north". */
async function faceNorth(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const state = await snapshot(page);
    const delta = Math.atan2(Math.sin(state.cameraYaw), Math.cos(state.cameraYaw));
    if (Math.abs(delta) < 0.01) break;
    await page.evaluate((dx) => {
      (
        window as unknown as { __NULLPOINT__: { applyMouseDelta(a: number, b: number): void } }
      ).__NULLPOINT__.applyMouseDelta(dx as number, 0);
    }, delta / 0.0022);
    await frames(page, 3);
  }
}

/** Holds forward for `count` frames and reports the highest point reached. */
async function walkNorth(page: Page, count: number): Promise<number> {
  await faceNorth(page);
  await page.keyboard.down("w");
  const samples = await recordFrames(page, count);
  await page.keyboard.up("w");
  await frames(page, 15);
  return Math.max(...samples.map((s) => s.position.y));
}

test.describe("map 01 loads", () => {
  test("is the game default and loads without errors", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);

    // No `?map=` — this is what a player gets on opening the game.
    await page.goto("/");
    await page.waitForFunction(
      () => (window as unknown as { __NULLPOINT__?: { ready?: boolean } }).__NULLPOINT__?.ready === true,
      undefined,
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      (window as unknown as { __NULLPOINT__: { hideOverlay(): void } }).__NULLPOINT__.hideOverlay();
    });
    await frames(page, 30);

    const state = await snapshot(page);
    expect(state.mapId).toBe("MAP01");
    expect(state.mapName).toBe("Substation");
    expect(watcher.errors, `console errors: ${watcher.errors.join(" | ")}`).toEqual([]);
    expect(watcher.failedRequests).toEqual([]);
  });

  test("spawns the player on solid ground rather than inside geometry", async ({ page }) => {
    await startGame(page, MAP);
    const state = await snapshot(page);

    expect(state.spawnCount).toBeGreaterThanOrEqual(4);
    expect(state.grounded).toBe(true);
    expect(state.position.y).toBeLessThan(0.2);

    // Spawned inside a wall, the controller ejects the capsule and the player
    // ends up somewhere the map never asked for.
    const spawn = state.spawns.find((s) => s.id === state.spawnId);
    expect(spawn).toBeDefined();
    if (spawn !== undefined) {
      expect(
        Math.hypot(state.position.x - spawn.position.x, state.position.z - spawn.position.z),
      ).toBeLessThan(1);
    }
  });

  test("every spawn point stands on open floor", async ({ page }) => {
    await startGame(page, MAP);
    const { spawns } = await snapshot(page);
    expect(spawns.length).toBeGreaterThanOrEqual(4);

    for (const spawn of spawns) {
      await teleport(page, spawn.position.x, spawn.position.y, spawn.position.z);
      await frames(page, 30);
      const state = await snapshot(page);

      expect(state.grounded, `${spawn.id} should be standing`).toBe(true);
      expect(state.position.y, `${spawn.id} should be at floor level`).toBeLessThan(0.3);
      expect(
        Math.hypot(state.position.x - spawn.position.x, state.position.z - spawn.position.z),
        `${spawn.id} should not be inside geometry`,
      ).toBeLessThan(1);
    }
  });

  test("loads its targets and its bot", async ({ page }) => {
    await startGame(page, MAP);
    const state = await snapshot(page);

    for (const id of ["M01_CLOSE", "M01_MID", "M01_LONG", "M01_HIGH", "M01_COVER", "M01_FLANK", "M01_MOVER"]) {
      const target = findTarget(state, id);
      expect(target.health, `${id} should load at full health`).toBe(target.maxHealth);
    }
    expect(findTarget(state, "M01_MOVER").moving).toBe(true);

    const bot = findBot(state, BOT);
    expect(bot.alive).toBe(true);
    expect(bot.health).toBe(bot.maxHealth);
  });
});

test.describe("map 01 traversal", () => {
  test("the east stairs can be walked and sprinted up", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    await teleport(page, 13, 0.6, 2);
    await frames(page, 25);
    expect(await walkNorth(page, 130), "walking should reach the deck").toBeGreaterThan(
      MAP01_METRICS.deckHeight - 0.2,
    );

    await teleport(page, 13, 0.6, 3);
    await frames(page, 25);
    await faceNorth(page);
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    const samples = await recordFrames(page, 130);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");

    expect(
      Math.max(...samples.map((s) => s.position.y)),
      "sprinting should reach the deck too",
    ).toBeGreaterThan(MAP01_METRICS.deckHeight - 0.2);
  });

  test("the west ramp can be walked up", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    await teleport(page, -13, 0.6, 2);
    await frames(page, 25);
    expect(await walkNorth(page, 130)).toBeGreaterThan(MAP01_METRICS.deckHeight - 0.2);
  });

  test("the player can cross the map, jumping and crouching on the way", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    await teleport(page, 0, 0.6, 16);
    await frames(page, 25);
    const start = await snapshot(page);

    await faceNorth(page);
    await page.keyboard.down("w");
    // Sampled across the run, not at one instant: the entry band has cover in
    // it, so whether the character is still moving at any chosen frame depends
    // on where it happens to have got to.
    const crossing = await recordFrames(page, 50);
    expect(
      crossing.some((s) => s.movementState === "RUN" || s.movementState === "WALK"),
      "the player should get moving",
    ).toBe(true);

    await page.keyboard.press("Space");
    const airborne = await expectEventually(page, "airborne", (s) => !s.grounded, 150);
    expect(airborne.position.y).toBeGreaterThan(0.15);
    await expectEventually(page, "landed", (s) => s.grounded, 300);

    await page.keyboard.down("Control");
    await expectEventually(page, "crouched", (s) => s.crouching, 200);
    await page.keyboard.up("Control");
    await page.keyboard.up("w");

    const end = await snapshot(page);
    expect(Math.abs(end.position.z - start.position.z), "should have travelled").toBeGreaterThan(5);
  });

  test("the boundary keeps the player inside the map", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);
    const { mapBounds } = await snapshot(page);

    await teleport(page, 0, 0.6, -16);
    await frames(page, 20);
    await faceNorth(page);
    await page.keyboard.down("w");
    await frames(page, 90);
    await page.keyboard.up("w");

    const state = await snapshot(page);
    expect(state.position.z, "the north wall must hold").toBeGreaterThan(mapBounds.z[0]);
    expect(state.position.x).toBeGreaterThan(mapBounds.x[0]);
    expect(state.position.x).toBeLessThan(mapBounds.x[1]);
  });
});

test.describe("map 01 camera", () => {
  test("holds its distance in the open, compresses at cover, and recovers", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    await teleport(page, 0, 0.6, 8);
    await frames(page, 40);
    const open = await snapshot(page);
    expect(open.cameraBoom).toBeGreaterThan(3.0);
    expect(open.cameraLift).toBeLessThan(0.05);

    // Hard against the full-height entry wall.
    await teleport(page, -14.5, 0.6, 12);
    await frames(page, 45);
    const blocked = await snapshot(page);
    expect(blocked.cameraBoom, "the boom must compress near cover").toBeLessThan(open.cameraBoom);

    await teleport(page, 0, 0.6, 8);
    await frames(page, 70);
    const recovered = await snapshot(page);
    expect(recovered.cameraBoom, "and ease back out").toBeGreaterThan(3.0);
    expect(recovered.cameraLift).toBeLessThan(0.05);
  });

  test("never places the camera outside the boundary", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);
    const { mapBounds } = await snapshot(page);

    await teleport(page, 0, 0.6, 18.6);
    await frames(page, 50);
    const state = await snapshot(page);

    expect(state.cameraPosition[2], "camera must stay inside the south wall").toBeLessThan(
      mapBounds.z[1] + 0.5,
    );
  });

  test("survives the stairs and the deck edge", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page, MAP);
    await engagePointerLock(page);

    await teleport(page, 13, 0.6, 2);
    await frames(page, 25);
    await walkNorth(page, 130);

    const onDeck = await snapshot(page);
    expect(onDeck.position.y).toBeGreaterThan(MAP01_METRICS.deckHeight - 0.2);
    expect(onDeck.cameraBoom, "never fully collapsed").toBeGreaterThan(0.2);
    expect(onDeck.cameraPosition[1], "never underground").toBeGreaterThan(0);
    expect(watcher.errors).toEqual([]);
  });
});

test.describe("map 01 combat", () => {
  test("targets can be engaged at short and long range", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    const cases: Array<[string, { x: number; z: number }]> = [
      ["M01_CLOSE", { x: -6, z: 11 }],
      ["M01_LONG", { x: 0, z: 6 }],
    ];

    for (const [id, from] of cases) {
      await healPlayer(page);
      await teleport(page, from.x, 0.6, from.z);
      await frames(page, 25);

      const before = findTarget(await snapshot(page), id);
      await page.mouse.down({ button: "right" });
      await aimAt(page, before.position.x, before.position.y, before.position.z);
      expect(
        (await snapshot(page)).aimTargetId,
        `${id} should be visible from (${from.x}, ${from.z})`,
      ).toBe(id);

      await page.mouse.down({ button: "left" });
      await frames(page, 8);
      await page.mouse.up({ button: "left" });
      await page.mouse.up({ button: "right" });

      expect(findTarget(await snapshot(page), id).health, `${id} should take damage`).toBeLessThan(
        before.health,
      );
    }
  });

  test("the bot engages the player, and can be shot back at", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);
    await healPlayer(page);

    // The open centre, in front of the bot's spawn.
    await teleport(page, 0, 0.6, 2);
    const engaged = await expectEventually(
      page,
      "bot engages",
      (s) => findBot(s, BOT).state === "ENGAGE" && findBot(s, BOT).lineOfSight,
      300,
    );
    expect(engaged.playerHealth).toBeGreaterThan(0);

    await expectEventually(page, "player takes damage", (s) => s.playerHealth < s.playerMaxHealth, 400);

    const bot = findBot(await snapshot(page), BOT);
    await page.mouse.down({ button: "right" });
    await aimAt(page, bot.position.x, bot.position.y + 1.1, bot.position.z);
    await page.mouse.down({ button: "left" });
    const damaged = await expectEventually(
      page,
      "bot takes damage",
      (s) => findBot(s, BOT).health < findBot(s, BOT).maxHealth,
      300,
    );
    await page.mouse.up({ button: "left" });
    await page.mouse.up({ button: "right" });

    expect(findBot(damaged, BOT).health).toBeLessThan(findBot(damaged, BOT).maxHealth);
  });

  test("the player dies and respawns at a map spawn point", async ({ page }) => {
    await startGame(page, MAP);
    await healPlayer(page);
    await teleport(page, 0, 0.6, 16);
    await frames(page, 25);

    await damagePlayer(page, 999);
    expect((await snapshot(page)).playerAlive).toBe(false);

    const alive = await expectEventually(page, "respawn", (s) => s.playerAlive, 600);
    const spawn = alive.spawns.find((s) => s.id === alive.spawnId);
    expect(spawn).toBeDefined();
    if (spawn !== undefined) {
      expect(
        Math.hypot(alive.position.x - spawn.position.x, alive.position.z - spawn.position.z),
      ).toBeLessThan(3);
    }
  });

  test("does not collapse the frame rate or the draw-call budget", async ({ page }) => {
    await startGame(page, MAP);
    await engagePointerLock(page);

    // The busiest view: centre of the map looking north up the long lane.
    await teleport(page, 0, 0.6, 10);
    await frames(page, 40);
    const samples = await recordFrames(page, 40);

    // Headless software WebGL runs far below the real target, so this guards
    // against a collapse. The 60 FPS figure is measured in real Chrome.
    expect(Math.min(...samples.map((s) => s.fps))).toBeGreaterThan(3);
    expect(samples[samples.length - 1]?.drawCalls ?? 0).toBeLessThan(400);
  });
});
