import { expect, test } from "@playwright/test";

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
 * The combat sandbox: moving targets, the training bot, and player health.
 *
 * The bot spawns at (−14, −25), far enough from both the player spawn and the
 * range firing line that it never wanders into either. Every test here puts the
 * player somewhere deliberate rather than relying on it coming to them.
 */

const BOT = "BOT_ALPHA";
/** Open ground beside the bot, clear line of sight, inside engage range. */
const IN_FRONT_OF_BOT = { x: -14, y: 0.6, z: -29 };
/**
 * Fourteen metres from the bot along clear ground, for shooting back at it.
 *
 * Standing 4 m away is no good for that: the third-person boom puts the camera
 * roughly where the bot is standing, so "aim at the bot" has no meaning.
 */
const DUEL_RANGE = { x: 0, y: 0.6, z: -25 };
/** North of the elevated platform, which stands between here and the bot. */
const BEHIND_COVER = { x: -14, y: 0.6, z: -2 };
/** Far from the bot — outside its detection radius. */
const FAR_AWAY = { x: 0, y: 0.6, z: 12 };

test.describe("moving targets", () => {
  test("travel, and their colliders travel with them", async ({ page }) => {
    await startGame(page);

    const first = await snapshot(page);
    expect(findTarget(first, "MOVER_H").moving).toBe(true);
    expect(findTarget(first, "MOVER_V").moving).toBe(true);

    const samples = await recordFrames(page, 60);
    const horizontal = samples.map((s) => findTarget(s, "MOVER_H").position.z);
    const vertical = samples.map((s) => findTarget(s, "MOVER_V").position.y);

    expect(Math.max(...horizontal) - Math.min(...horizontal), "MOVER_H should travel in z").toBeGreaterThan(0.3);
    expect(Math.max(...vertical) - Math.min(...vertical), "MOVER_V should travel in y").toBeGreaterThan(0.3);
  });

  test("a moving target can still be hit and damaged", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await teleport(page, -6, 0.4, 24);
    await frames(page, 25);

    const before = findTarget(await snapshot(page), "MOVER_H");

    // Re-acquire before each burst rather than firing once: the plate is moving,
    // and the whole point is that its collider travels with its mesh.
    await page.mouse.down({ button: "right" });
    for (let i = 0; i < 8; i++) {
      const live = findTarget(await snapshot(page), "MOVER_H");
      await aimAt(page, live.position.x, live.position.y, live.position.z);
      if ((await snapshot(page)).aimTargetId !== "MOVER_H") continue;
      await page.mouse.down({ button: "left" });
      await frames(page, 4);
      await page.mouse.up({ button: "left" });
      if (findTarget(await snapshot(page), "MOVER_H").health < before.health) break;
    }
    await page.mouse.up({ button: "right" });

    const after = findTarget(await snapshot(page), "MOVER_H");
    expect(after.health, "a tracked moving plate should take damage").toBeLessThan(before.health);
  });

  test("the static range targets are unaffected by the new movers", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await teleport(page, -6, 0.4, 24);
    await frames(page, 25);

    // The movers were placed off every static sight line; prove it for the one
    // that runs the full length of the range.
    await page.mouse.down({ button: "right" });
    await aimAt(page, 26, 1.3, 23.8);
    expect((await snapshot(page)).aimTargetId).toBe("LONG");
    await page.mouse.up({ button: "right" });
  });
});

test.describe("training bot", () => {
  test("spawns idle and ignores a distant player", async ({ page }) => {
    await startGame(page);
    await teleport(page, FAR_AWAY.x, FAR_AWAY.y, FAR_AWAY.z);
    await frames(page, 40);

    const bot = findBot(await snapshot(page), BOT);
    expect(bot.alive).toBe(true);
    expect(bot.health).toBe(bot.maxHealth);
    expect(bot.state).toBe("IDLE");
    expect(bot.distance).toBeGreaterThan(30);
    expect(bot.shotsFired).toBe(0);
  });

  test("will not shoot the player through cover", async ({ page }) => {
    await startGame(page);
    await healPlayer(page);
    await teleport(page, BEHIND_COVER.x, BEHIND_COVER.y, BEHIND_COVER.z);
    await frames(page, 60);

    const before = findBot(await snapshot(page), BOT).shotsFired;
    const health = (await snapshot(page)).playerHealth;

    await frames(page, 90);

    const after = await snapshot(page);
    const bot = findBot(after, BOT);
    // Inside detection range but with the platform in the way.
    expect(bot.distance).toBeLessThan(30);
    expect(bot.lineOfSight, "the platform must block the shot").toBe(false);
    expect(bot.shotsFired, "no line of sight, no rounds").toBe(before);
    expect(after.playerHealth).toBe(health);
  });

  test("engages a visible player and damages them", async ({ page }) => {
    await startGame(page);
    await healPlayer(page);
    await teleport(page, IN_FRONT_OF_BOT.x, IN_FRONT_OF_BOT.y, IN_FRONT_OF_BOT.z);

    const engaged = await expectEventually(
      page,
      "bot engages",
      (s) => findBot(s, BOT).state === "ENGAGE" && findBot(s, BOT).lineOfSight,
      200,
    );
    expect(engaged.playerHealth).toBeGreaterThan(0);

    const hurt = await expectEventually(page, "player takes damage", (s) => s.playerHealth < s.playerMaxHealth, 300);
    expect(hurt.playerHealth).toBeLessThan(hurt.playerMaxHealth);
    expect(findBot(hurt, BOT).shotsFired).toBeGreaterThan(0);
  });

  test("fires on a cooldown rather than every frame", async ({ page }) => {
    await startGame(page);
    await healPlayer(page);
    await teleport(page, IN_FRONT_OF_BOT.x, IN_FRONT_OF_BOT.y, IN_FRONT_OF_BOT.z);
    await expectEventually(page, "bot engages", (s) => findBot(s, BOT).state === "ENGAGE", 200);

    const samples = await recordFrames(page, 60);
    const first = findBot(samples[0] ?? (await snapshot(page)), BOT).shotsFired;
    const last = findBot(samples[samples.length - 1] ?? (await snapshot(page)), BOT).shotsFired;

    // Whatever the frame rate, a 0.85 s interval cannot produce a shot per frame.
    expect(last - first).toBeLessThan(samples.length / 4);
  });

  test("moves toward the player instead of teleporting", async ({ page }) => {
    await startGame(page);
    await healPlayer(page);
    // Beyond engage range but within detection, with a clear line.
    await teleport(page, -14, 0.6, -12);

    const samples = await recordFrames(page, 90);
    const positions = samples.map((s) => findBot(s, BOT).position);

    let largestStep = 0;
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1];
      const b = positions[i];
      if (a === undefined || b === undefined) continue;
      largestStep = Math.max(largestStep, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }

    // A frame at this speed cannot legitimately move the bot a metre; anything
    // larger means it was placed rather than moved.
    expect(largestStep, "the bot must never teleport").toBeLessThan(1);
  });

  test("takes the player's fire, dies, and respawns", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await healPlayer(page);
    await teleport(page, DUEL_RANGE.x, DUEL_RANGE.y, DUEL_RANGE.z);
    await frames(page, 20);

    const start = findBot(await snapshot(page), BOT);
    await page.mouse.down({ button: "right" });
    await aimAt(page, start.position.x, start.position.y + 1.1, start.position.z);
    expect((await snapshot(page)).aimTargetId).toBe(BOT);

    // The bot closes while being shot at, so re-acquire between bursts.
    await page.mouse.down({ button: "left" });
    for (let i = 0; i < 10; i++) {
      if (!findBot(await snapshot(page), BOT).alive) break;
      await frames(page, 12);
      const live = findBot(await snapshot(page), BOT);
      if (!live.alive) break;
      await aimAt(page, live.position.x, live.position.y + 1.1, live.position.z);
    }
    await page.mouse.up({ button: "left" });
    await page.mouse.up({ button: "right" });

    const dead = findBot(await snapshot(page), BOT);
    expect(dead.health).toBe(0);
    expect(dead.state).toBe("DEAD");

    const revived = await expectEventually(page, "bot respawns", (s) => findBot(s, BOT).alive, 600);
    expect(findBot(revived, BOT).health).toBe(findBot(revived, BOT).maxHealth);
  });
});

test.describe("player health", () => {
  test("takes damage, dies, and respawns at the spawn point", async ({ page }) => {
    await startGame(page);
    await healPlayer(page);
    await teleport(page, FAR_AWAY.x, FAR_AWAY.y, FAR_AWAY.z);
    await frames(page, 20);

    const healthy = await snapshot(page);
    expect(healthy.playerHealth).toBe(healthy.playerMaxHealth);
    expect(healthy.playerAlive).toBe(true);

    await damagePlayer(page, 30);
    const hurt = await snapshot(page);
    expect(hurt.playerHealth).toBe(healthy.playerMaxHealth - 30);
    expect(hurt.playerAlive).toBe(true);

    const deathsBefore = hurt.playerDeaths;
    await damagePlayer(page, 999);
    const dead = await snapshot(page);
    expect(dead.playerHealth).toBe(0);
    expect(dead.playerAlive).toBe(false);
    expect(dead.playerDeaths).toBe(deathsBefore + 1);
    expect(dead.playerRespawnIn).toBeGreaterThan(0);

    const respawned = await expectEventually(page, "player respawns", (s) => s.playerAlive, 600);
    expect(respawned.playerHealth).toBe(respawned.playerMaxHealth);
    // Back at the arena spawn, not where they died.
    expect(Math.hypot(respawned.position.x - 0, respawned.position.z - 12)).toBeLessThan(3);
  });

  test("suppresses firing and movement while dead", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);
    await engagePointerLock(page);
    await healPlayer(page);
    await teleport(page, FAR_AWAY.x, FAR_AWAY.y, FAR_AWAY.z);
    await frames(page, 20);

    await damagePlayer(page, 999);
    const dead = await snapshot(page);
    expect(dead.playerAlive).toBe(false);

    const shotsBefore = dead.shotsFired;
    await page.mouse.down({ button: "left" });
    await page.keyboard.down("w");
    await frames(page, 12);
    const during = await snapshot(page);
    await page.keyboard.up("w");
    await page.mouse.up({ button: "left" });

    // Only meaningful while still dead; the respawn delay is comfortably longer.
    if (!during.playerAlive) {
      expect(during.shotsFired, "a dead player cannot shoot").toBe(shotsBefore);
      expect(during.speed, "a dead player does not run").toBeLessThan(0.5);
    }

    await expectEventually(page, "player respawns", (s) => s.playerAlive, 600);
    expect(watcher.errors).toEqual([]);
  });

  test("can shoot again after respawning", async ({ page }) => {
    await startGame(page);
    await engagePointerLock(page);
    await healPlayer(page);
    await teleport(page, FAR_AWAY.x, FAR_AWAY.y, FAR_AWAY.z);
    await frames(page, 20);

    await damagePlayer(page, 999);
    await expectEventually(page, "player respawns", (s) => s.playerAlive, 600);
    await frames(page, 20);

    const before = (await snapshot(page)).shotsFired;
    await page.mouse.down({ button: "left" });
    const fired = await expectEventually(page, "weapon fires again", (s) => s.shotsFired > before, 200);
    await page.mouse.up({ button: "left" });

    expect(fired.shotsFired).toBeGreaterThan(before);
  });
});
