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

  // --- Combat (Phase 2) ---
  readonly weaponName: string;
  readonly magazine: number;
  readonly reserve: number;
  readonly weaponState: string;
  readonly aiming: boolean;
  /** Damageable currently under the crosshair, empty when none. */
  readonly aimTarget: string;
  readonly lastDamage: number;
  readonly lastTarget: string;

  // --- Combat sandbox (Phase 3B) ---
  readonly health: number;
  readonly maxHealth: number;
  /** Seconds until respawn; zero while alive. */
  readonly respawnIn: number;
  readonly bots: readonly BotHudRow[];
}

export interface BotHudRow {
  readonly id: string;
  readonly state: string;
  readonly health: number;
  readonly distance: number;
  readonly lineOfSight: boolean;
  readonly cooldown: number;
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
      "",
      `WEAPON    ${snapshot.weaponName}`,
      `AMMO      ${snapshot.magazine} / ${snapshot.reserve}`,
      `STATE     ${snapshot.weaponState}${snapshot.aiming ? " (AIM)" : ""}`,
      `AIM       ${snapshot.aiming ? "YES" : "NO"}`,
      `TARGET    ${snapshot.aimTarget === "" ? "-" : snapshot.aimTarget}`,
      `DAMAGE    ${
        snapshot.lastDamage > 0
          ? `${fixed(snapshot.lastDamage, 0)} -> ${snapshot.lastTarget}`
          : "-"
      }`,
      "",
      `HEALTH    ${fixed(snapshot.health, 0)} / ${snapshot.maxHealth}${
        snapshot.respawnIn > 0 ? `   DEAD  RESPAWN ${fixed(snapshot.respawnIn, 1)} s` : ""
      }`,
      ...snapshot.bots.map(
        (bot) =>
          `${bot.id.padEnd(10)}${bot.state.padEnd(7)} HP ${fixed(bot.health, 0).padStart(3)}` +
          `  ${fixed(bot.distance, 1).padStart(5)} m  ${bot.lineOfSight ? "LOS" : "---"}` +
          `  CD ${fixed(bot.cooldown, 1)}`,
      ),
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
