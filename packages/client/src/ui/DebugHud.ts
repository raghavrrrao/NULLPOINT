import type { MovementState, Vec3 } from "@nullpoint/shared";

export interface DebugHudSnapshot {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly worstFrameTimeMs: number;
  readonly state: MovementState;
  readonly grounded: boolean;
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
  readonly speed: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly physicsMs: number;
  readonly characterSource: string;
}

const UPDATE_INTERVAL_MS = 100;

function fixed(value: number, digits = 2): string {
  // Avoids "-0.00", which flickers against "0.00" and makes the HUD look noisy.
  const rounded = Number(value.toFixed(digits));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits);
}

/**
 * Temporary development HUD.
 *
 * Explicitly not the game HUD (Phase 1 brief §18) — it is one element with one
 * `textContent` write, removable by deleting this class and its two lines in
 * `Game`. Text is rebuilt at 10 Hz rather than every frame; at 144 Hz the string
 * building and layout cost is measurable in the profile and it is unreadable
 * anyway.
 */
export class DebugHud {
  private readonly element: HTMLElement;
  private lastUpdate = 0;
  private visible = true;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "" : "none";
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(snapshot: DebugHudSnapshot, nowMs: number): void {
    if (!this.visible) return;
    if (nowMs - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = nowMs;

    const { position: p, velocity: v } = snapshot;

    this.element.textContent = [
      `FPS       ${snapshot.fps.toFixed(0).padStart(3)}   ${fixed(snapshot.frameTimeMs, 1)} ms`,
      `WORST     ${fixed(snapshot.worstFrameTimeMs, 1)} ms`,
      `PHYSICS   ${fixed(snapshot.physicsMs, 2)} ms`,
      `DRAWS     ${snapshot.drawCalls}   TRIS ${snapshot.triangles}`,
      "",
      `STATE     ${snapshot.state}`,
      `GROUNDED  ${snapshot.grounded ? "YES" : "NO"}`,
      `SPEED     ${fixed(snapshot.speed)} m/s`,
      "",
      `POS  X ${fixed(p.x).padStart(8)}`,
      `     Y ${fixed(p.y).padStart(8)}`,
      `     Z ${fixed(p.z).padStart(8)}`,
      `VEL  X ${fixed(v.x).padStart(8)}`,
      `     Y ${fixed(v.y).padStart(8)}`,
      `     Z ${fixed(v.z).padStart(8)}`,
      "",
      `CHAR      ${snapshot.characterSource}`,
    ].join("\n");
  }

  /** Rebuilds the title element, which `textContent` above would otherwise wipe. */
  static mountTitle(element: HTMLElement): HTMLElement {
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "NULLPOINT";
    const body = document.createElement("span");
    element.replaceChildren(title, body);
    return body;
  }
}
