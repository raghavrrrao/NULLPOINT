import { expect, test } from "@playwright/test";

import { ConsoleWatcher, snapshot, startGame } from "./helpers.ts";

test.describe("startup", () => {
  test("loads, renders a canvas, and shows the development HUD", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    const size = await canvas.boundingBox();
    expect(size?.width ?? 0).toBeGreaterThan(100);
    expect(size?.height ?? 0).toBeGreaterThan(100);

    await expect(page.getByTestId("debug-hud")).toContainText("NULLPOINT");
    await expect(page.getByTestId("debug-hud")).toContainText("STATE");
    await expect(page.getByTestId("controls-hint")).toBeVisible();
    await expect(page.getByTestId("fatal")).toBeHidden();

    expect(watcher.errors, `console errors: ${watcher.errors.join(" | ")}`).toEqual([]);
    expect(watcher.failedRequests, `failed requests: ${watcher.failedRequests.join(" | ")}`).toEqual([]);
  });

  test("initialises the WebGL2 context and draws geometry", async ({ page }) => {
    await startGame(page);

    const state = await snapshot(page);
    expect(state.drawCalls).toBeGreaterThan(0);

    const hasWebgl2 = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas !== null && canvas.getContext("webgl2") !== null;
    });
    expect(hasWebgl2).toBe(true);
  });

  test("renders a non-empty frame", async ({ page }) => {
    await startGame(page);

    // Guards against the "everything initialised but the screen is black" class
    // of failure that no state assertion would catch.
    const distinctColours = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) return 0;
      const gl = canvas.getContext("webgl2");
      if (gl === null) return 0;
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const seen = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4 * 97) {
        seen.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0));
      }
      return seen.size;
    });
    expect(distinctColours).toBeGreaterThan(8);
  });

  test("uses the documented placeholder character", async ({ page }) => {
    await startGame(page);
    const state = await snapshot(page);
    // Phase 1 ships a placeholder; this assertion is expected to change when a
    // licensed GLB is supplied (see ASSET_CREDITS.md).
    expect(state.characterSource).toContain("PLACEHOLDER");
  });

  test("survives a viewport resize", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);

    await page.setViewportSize({ width: 640, height: 480 });
    await expect(page.locator("canvas")).toBeVisible();
    let box = await page.locator("canvas").boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(640);

    await page.setViewportSize({ width: 1600, height: 900 });
    box = await page.locator("canvas").boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(1600);

    const state = await snapshot(page);
    expect(state.fps).toBeGreaterThan(0);
    expect(watcher.errors).toEqual([]);
  });

  test("keeps running after pointer lock is lost and re-requested", async ({ page }) => {
    const watcher = new ConsoleWatcher(page);
    await startGame(page);

    await page.locator("canvas").click();
    await page.keyboard.press("Escape");
    await page.locator("canvas").click();

    const state = await snapshot(page);
    expect(state.fps).toBeGreaterThan(0);
    // A rejected pointer-lock request in headless is tolerated, but it must not
    // become an uncaught error.
    expect(watcher.errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });
});
