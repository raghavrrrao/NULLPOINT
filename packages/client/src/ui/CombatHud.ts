import { WeaponState, clamp, type WeaponRuntime } from "@nullpoint/shared";

/**
 * The player-facing combat HUD: crosshair, hit marker, ammunition.
 *
 * Deliberately separate from `DebugHud`. That one is a development readout that
 * gets deleted; this one is the beginning of the real game HUD, and the Phase 2
 * brief requires the two to stay distinct.
 *
 * Kept in the DOM rather than drawn in the scene — it is 2D, it needs crisp
 * text, and a screen-space overlay costs no draw calls.
 */

/** How long the hit marker stays visible, seconds. */
const HIT_MARKER_SECONDS = 0.18;
/** How long the kill marker stays visible, seconds. */
const KILL_MARKER_SECONDS = 0.4;

export interface CombatHudElements {
  readonly crosshair: HTMLElement;
  readonly hitMarker: HTMLElement;
  readonly ammo: HTMLElement;
}

export class CombatHud {
  private readonly elements: CombatHudElements;
  private hitRemaining = 0;
  private killRemaining = 0;
  private markers = 0;
  private lastAmmoText = "";
  private lastStateClass = "";
  private visible = true;

  constructor(elements: CombatHudElements) {
    this.elements = elements;
    this.elements.hitMarker.style.opacity = "0";
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    const display = visible ? "" : "none";
    this.elements.crosshair.style.display = display;
    this.elements.ammo.style.display = display;
    this.elements.hitMarker.style.display = display;
  }

  /**
   * Hit markers shown since construction.
   *
   * Observable where the DOM opacity is not: the marker lasts 180 ms, which a
   * test sampling over a round trip on a slow renderer can step straight over.
   */
  get markerCount(): number {
    return this.markers;
  }

  showHitMarker(killed: boolean): void {
    this.markers += 1;
    this.hitRemaining = HIT_MARKER_SECONDS;
    if (killed) this.killRemaining = KILL_MARKER_SECONDS;
  }

  /**
   * @param runtime  Current weapon state.
   * @param aimBlend 0 = hip, 1 = aimed. Tightens the reticle.
   * @param dt       Real frame delta, seconds.
   */
  update(runtime: WeaponRuntime, aimBlend: number, dt: number): void {
    if (!this.visible) return;

    this.hitRemaining = Math.max(0, this.hitRemaining - dt);
    this.killRemaining = Math.max(0, this.killRemaining - dt);

    // The reticle closes as the player aims and opens while firing, which is the
    // cheapest honest signal of the weapon's current accuracy.
    const firing = runtime.state === WeaponState.Firing ? 1 : 0;
    const gap = 7 - aimBlend * 3.6 + firing * 2.4;
    this.elements.crosshair.style.setProperty("--gap", `${gap.toFixed(2)}px`);

    const stateClass =
      runtime.state === WeaponState.Reloading
        ? "reloading"
        : runtime.magazine === 0
          ? "empty"
          : "";
    if (stateClass !== this.lastStateClass) {
      this.elements.crosshair.className = stateClass;
      this.elements.ammo.className = stateClass;
      this.lastStateClass = stateClass;
    }

    const marker = this.hitRemaining > 0;
    this.elements.hitMarker.style.opacity = marker
      ? clamp(this.hitRemaining / HIT_MARKER_SECONDS, 0, 1).toFixed(2)
      : "0";
    this.elements.hitMarker.style.color = this.killRemaining > 0 ? "#ff6b6b" : "#f2f6f9";

    // Only touch the DOM when the text actually changes; this runs every frame.
    const ammoText =
      runtime.state === WeaponState.Reloading
        ? `RELOADING · ${runtime.reserve}`
        : `${runtime.magazine} / ${runtime.reserve}`;
    if (ammoText !== this.lastAmmoText) {
      this.elements.ammo.textContent = ammoText;
      this.lastAmmoText = ammoText;
    }
  }
}
