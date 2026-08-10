import type { ConsoleMessage, Page } from "@playwright/test";

export interface GameSnapshot {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  movementState: string;
  grounded: boolean;
  crouching: boolean;
  speed: number;
  yaw: number;
  cameraYaw: number;
  cameraPitch: number;
  /** Boom length in metres after collision resolution. */
  cameraBoom: number;
  /** Extra pitch added by collision, radians. */
  cameraLift: number;
  cameraPosition: [number, number, number];
  fps: number;
  drawCalls: number;
  characterSource: string;
  standHeight: number;

  // --- Combat (Phase 2) ---
  aiming: boolean;
  aimAmount: number;
  fov: number;
  weaponId: string;
  weaponState: string;
  magazine: number;
  reserve: number;
  ammo: string;
  shotsFired: number;
  recoilPitch: number;
  muzzleFlashVisible: boolean;
  muzzleFlashCount: number;
  effectCount: number;
  aimTargetId: string;
  lastShot: {
    hit: boolean;
    onTarget: boolean;
    targetId: string;
    damage: number;
    distance: number;
    killed: boolean;
  };
  hitMarkerCount: number;
  /** Distance from each hand to its grip on the weapon, metres. */
  handGripError: { right: number; left: number };
  /** World direction the barrel points. */
  weaponForward: [number, number, number];
  /** Chest, head and spine X rotations, radians. Positive leans backward. */
  poseAngles: { torso: number; head: number; spine: number };
  audioReady: boolean;
  audioPlays: number;
  targets: Array<{ id: string; health: number; maxHealth: number; alive: boolean }>;
}

/** Mouse sensitivity from `CAMERA_CONFIG`, needed to convert angles to pixels. */
export const MOUSE_SENSITIVITY = 0.0022;

/** Collects console errors and page exceptions for the lifetime of a test. */
export class ConsoleWatcher {
  readonly errors: string[] = [];
  readonly failedRequests: string[] = [];

  constructor(page: Page) {
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") this.errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      this.errors.push(`pageerror: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      this.failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        this.failedRequests.push(`${response.url()} — HTTP ${response.status()}`);
      }
    });
  }
}

/** Loads the game and waits until the frame loop is running. */
export async function startGame(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as { __NULLPOINT__?: { ready?: boolean } }).__NULLPOINT__?.ready === true,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    (window as unknown as { __NULLPOINT__: { hideOverlay(): void } }).__NULLPOINT__.hideOverlay();
  });
  // Let the character settle on the ground before any test asserts on movement.
  await settle(page);
}

export async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(
    () => (window as unknown as { __NULLPOINT__: { inspect(): GameSnapshot } }).__NULLPOINT__.inspect() as GameSnapshot,
  );
}

export async function applyMouseDelta(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(
    ([x, y]) => {
      (window as unknown as { __NULLPOINT__: { applyMouseDelta(a: number, b: number): void } }).__NULLPOINT__.applyMouseDelta(
        x as number,
        y as number,
      );
    },
    [dx, dy],
  );
}

export async function teleport(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([px, py, pz]) => {
      (window as unknown as { __NULLPOINT__: { teleport(a: number, b: number, c: number): void } }).__NULLPOINT__.teleport(
        px as number,
        py as number,
        pz as number,
      );
    },
    [x, y, z],
  );
}

/**
 * Waits for a number of animation frames.
 *
 * Frame-driven rather than `waitForTimeout`, so the simulation genuinely
 * advances instead of the test hoping enough wall-clock passed
 * (`CLAUDE.md` §9: tests must not depend on wall-clock timing).
 */
export async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    await new Promise<void>((resolve) => {
      let remaining = n;
      const tick = (): void => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, count);
}

/**
 * Polls the game state, one frame at a time, until `predicate` holds.
 *
 * Frame counts are not a usable unit of simulated time here: under headless
 * software WebGL a frame can carry several fixed ticks, so a test written as
 * "wait 8 frames then assert airborne" passes on a fast machine and fails on a
 * slow one. Waiting on the condition itself removes the timing dependence
 * entirely (`CLAUDE.md` §9).
 *
 * @returns the first snapshot satisfying the predicate, or null if it never did.
 */
export async function waitFor(
  page: Page,
  predicate: (state: GameSnapshot) => boolean,
  maxFrames = 400,
): Promise<GameSnapshot | null> {
  for (let i = 0; i < maxFrames; i++) {
    const state = await snapshot(page);
    if (predicate(state)) return state;
    await frames(page, 1);
  }
  return null;
}

/** Like {@link waitFor} but fails the calling test if the condition never holds. */
export async function expectEventually(
  page: Page,
  description: string,
  predicate: (state: GameSnapshot) => boolean,
  maxFrames = 400,
): Promise<GameSnapshot> {
  const state = await waitFor(page, predicate, maxFrames);
  if (state === null) {
    const last = await snapshot(page);
    throw new Error(`timed out waiting for: ${description}\nlast state: ${JSON.stringify(last)}`);
  }
  return state;
}

/**
 * Samples the game state once per animation frame, entirely inside the page.
 *
 * Polling from the test side costs a round trip per sample, which is enough to
 * step straight over a short event — a jump arc lasts well under a second. This
 * captures every frame in one call. Start it, drive input while it runs, then
 * await the result:
 *
 * ```ts
 * const recording = recordFrames(page, 40);
 * await page.keyboard.press("Space");
 * const samples = await recording;
 * ```
 */
export function recordFrames(page: Page, count: number): Promise<GameSnapshot[]> {
  return page.evaluate(async (n) => {
    const hook = (window as unknown as { __NULLPOINT__: { inspect(): GameSnapshot } }).__NULLPOINT__;
    const samples: GameSnapshot[] = [];
    await new Promise<void>((resolve) => {
      let remaining = n;
      const tick = (): void => {
        samples.push(hook.inspect());
        remaining -= 1;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return samples;
  }, count);
}

/** Runs frames until the character is grounded and still, or the budget runs out. */
export async function settle(page: Page, maxFrames = 240): Promise<void> {
  await frames(page, 2);
  await waitFor(page, (s) => s.grounded && s.speed < 0.05, maxFrames);
}

/** Holds a key for `frameCount` frames, then releases it. */
export async function holdKey(page: Page, key: string, frameCount: number): Promise<void> {
  await page.keyboard.down(key);
  await frames(page, frameCount);
  await page.keyboard.up(key);
}

export function horizontalDistance(a: GameSnapshot, b: GameSnapshot): number {
  return Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Points the crosshair at a world position by moving the mouse.
 *
 * Solves for the yaw and pitch that put screen centre on the point, then feeds
 * the difference in as a mouse delta — the same path a player's input takes.
 * Iterated a few times because the camera position itself moves as it turns.
 */
export async function aimAt(page: Page, x: number, y: number, z: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const state = await snapshot(page);
    const [cx, cy, cz] = state.cameraPosition;
    let dx = x - cx;
    let dy = y - cy;
    let dz = z - cz;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return;
    dx /= length;
    dy /= length;
    dz /= length;

    // Matches the camera's own convention: forward is (−sin yaw, −cos yaw) and
    // positive pitch looks down.
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = -Math.asin(Math.max(-1, Math.min(1, dy)));
    const deltaYaw = wrap(wantYaw - state.cameraYaw);
    const deltaPitch = wantPitch - state.cameraPitch;
    if (Math.abs(deltaYaw) < 1e-4 && Math.abs(deltaPitch) < 1e-4) break;

    await applyMouseDelta(page, -deltaYaw / MOUSE_SENSITIVITY, deltaPitch / MOUSE_SENSITIVITY);
    await frames(page, 2);
  }
  await frames(page, 3);
}

/** Restores every training target to full health. */
export async function resetTargets(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __NULLPOINT__: { resetTargets(): void } }).__NULLPOINT__.resetTargets();
  });
  await frames(page, 2);
}

/** Engages pointer lock, which mouse-button input requires. */
export async function engagePointerLock(page: Page): Promise<boolean> {
  await page.locator("canvas").click();
  await frames(page, 6);
  return page.evaluate(() => document.pointerLockElement !== null);
}

export function findTarget(state: GameSnapshot, id: string): { id: string; health: number; maxHealth: number; alive: boolean } {
  const target = state.targets.find((t) => t.id === id);
  if (target === undefined) throw new Error(`no training target named ${id}`);
  return target;
}
