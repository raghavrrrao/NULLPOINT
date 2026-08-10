import * as THREE from "three";

/**
 * Muzzle flash.
 *
 * A single reused mesh rather than a per-shot object: at 700 RPM anything
 * allocated per shot is allocated a dozen times a second, and the Phase 2 brief
 * bans that. Firing again simply restarts the timer.
 *
 * Deliberately not a particle system — the brief rules out building a VFX
 * framework for this.
 */
export class MuzzleFlash {
  readonly object: THREE.Object3D;

  private readonly cone: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly coneMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly coneGeometry: THREE.ConeGeometry;
  private readonly glowTexture: THREE.Texture;

  private remaining = 0;
  private duration = 0.05;
  private triggers = 0;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "muzzle-flash";
    this.object.visible = false;

    this.coneGeometry = new THREE.ConeGeometry(0.05, 0.22, 6, 1, true);
    this.coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.cone = new THREE.Mesh(this.coneGeometry, this.coneMaterial);
    // The cone is built along +Y; rotate it to point down the barrel (−Z).
    this.cone.rotation.x = -Math.PI / 2;
    this.cone.position.z = -0.11;
    this.object.add(this.cone);

    this.glowTexture = createRadialTexture();
    this.glowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffc46b,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.scale.setScalar(0.34);
    this.object.add(this.glow);
  }

  /** Restarts the flash. Called once per shot. */
  trigger(duration: number): void {
    this.triggers += 1;
    this.duration = Math.max(0.001, duration);
    this.remaining = this.duration;
    this.object.visible = true;
    // A little variation so sustained fire does not strobe identically.
    this.object.rotation.z = Math.random() * Math.PI;
  }

  /** @param dt Real frame delta, seconds. */
  update(dt: number): void {
    if (this.remaining <= 0) return;

    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.object.visible = false;
      return;
    }

    const t = this.remaining / this.duration;
    this.coneMaterial.opacity = t;
    this.glowMaterial.opacity = t * 0.85;
    const scale = 0.75 + t * 0.45;
    this.cone.scale.setScalar(scale);
    this.glow.scale.setScalar(0.28 + t * 0.22);
  }

  get isVisible(): boolean {
    return this.remaining > 0;
  }

  /**
   * Flashes produced since construction.
   *
   * Observable where `isVisible` is not: the flash lasts 45 ms, so a test
   * sampling once per frame on a slow renderer can step straight over it.
   */
  get triggerCount(): number {
    return this.triggers;
  }

  dispose(): void {
    this.coneGeometry.dispose();
    this.coneMaterial.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
  }
}

/** Small radial-gradient texture for the additive glow sprite. */
function createRadialTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (context !== null) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,210,140,0.75)");
    gradient.addColorStop(1, "rgba(255,180,80,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
