import { LogLevel, createLogger, setLogLevel } from "@nullpoint/shared";

import { Game } from "./core/Game.ts";

const log = createLogger("boot");

setLogLevel(import.meta.env.DEV ? LogLevel.Debug : LogLevel.Warn);

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing required element #${id}`);
  return element;
}

function showFatal(message: string, error: unknown): void {
  const panel = document.getElementById("fatal");
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (panel !== null) {
    panel.hidden = false;
    panel.textContent = `NULLPOINT failed to start\n\n${message}\n\n${detail}`;
  }
  log.error(message, error);
}

async function bootstrap(): Promise<void> {
  const container = requireElement("app");
  const hud = requireElement("debug-hud");
  const lockOverlay = requireElement("lock-overlay");

  const game = await Game.create({ container, hud, lockOverlay });
  game.start();

  if (import.meta.env.DEV) {
    // Development-only automation surface. `import.meta.env.DEV` is statically
    // false in a production build, so this block is dropped entirely
    // (`ARCHITECTURE.md` §10: test hooks are stripped from production builds).
    Object.defineProperty(window, "__NULLPOINT__", {
      value: {
        ready: true,
        inspect: () => game.inspect(),
        applyMouseDelta: (dx: number, dy: number) => game.applyMouseDelta(dx, dy),
        teleport: (x: number, y: number, z: number) => game.teleport(x, y, z),
        hideOverlay: () => game.hideOverlay(),
      },
      configurable: true,
    });
  }
}

bootstrap().catch((error: unknown) => {
  showFatal("An error occurred during startup.", error);
});

// A WebGL or WASM failure inside the frame loop would otherwise be invisible
// except in the console; surface it the same way as a startup failure.
window.addEventListener("error", (event) => {
  log.error("uncaught error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  log.error("unhandled rejection", event.reason);
});
