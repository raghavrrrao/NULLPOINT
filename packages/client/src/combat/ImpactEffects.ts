import * as THREE from "three";

/**
 * Impact marks and tracers, drawn from fixed-size pools.
 *
 * Both pools are allocated once at construction and recycled oldest-first. That
 * caps the cost and the object count no matter how long the trigger is held —
 * the Phase 2 brief bans unbounded allocation and leaked hit markers.
 */

const IMPACT_POOL_SIZE = 24;
const TRACER_POOL_SIZE = 12;

const IMPACT_LIFETIME = 0.65;
const TRACER_LIFETIME = 0.055;

interface PooledImpact {
  readonly mesh: THREE.Mesh;
  remaining: number;
}

interface PooledTracer {
  readonly line: THREE.Mesh;
  remaining: number;
}

export class ImpactEffects {
  readonly group = new THREE.Group();

  private readonly impacts: PooledImpact[] = [];
  private readonly tracers: PooledTracer[] = [];
  private nextImpact = 0;
  private nextTracer = 0;

  private readonly impactGeometry: THREE.PlaneGeometry;
  private readonly tracerGeometry: THREE.BoxGeometry;
  private readonly surfaceMaterial: THREE.MeshBasicMaterial;
  private readonly targetMaterial: THREE.MeshBasicMaterial;
  private readonly tracerMaterial: THREE.MeshBasicMaterial;

  private readonly normalTarget = new THREE.Vector3();

  constructor() {
    this.group.name = "impact-effects";

    this.impactGeometry = new THREE.PlaneGeometry(0.13, 0.13);
    // Two shared materials rather than one per mark: environment hits read grey,
    // target hits read hot, so a player can tell at a glance whether it counted.
    this.surfaceMaterial = new THREE.MeshBasicMaterial({
      color: 0x11141a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.targetMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd08a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    for (let i = 0; i < IMPACT_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.impactGeometry, this.surfaceMaterial);
      mesh.visible = false;
      this.group.add(mesh);
      this.impacts.push({ mesh, remaining: 0 });
    }

    this.tracerGeometry = new THREE.BoxGeometry(0.018, 0.018, 1);
    this.tracerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const line = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial);
      line.visible = false;
      this.group.add(line);
      this.tracers.push({ line, remaining: 0 });
    }
  }

  /**
   * Places an impact mark, oriented to the surface it struck.
   *
   * @param onTarget True when the thing hit was damageable, which selects the
   *                 brighter material.
   */
  spawnImpact(
    point: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    onTarget: boolean,
  ): void {
    const slot = this.impacts[this.nextImpact];
    if (slot === undefined) return;
    this.nextImpact = (this.nextImpact + 1) % this.impacts.length;

    // Lifted slightly off the surface; coplanar geometry z-fights even with a
    // polygon offset.
    slot.mesh.position.set(
      point.x + normal.x * 0.012,
      point.y + normal.y * 0.012,
      point.z + normal.z * 0.012,
    );
    this.normalTarget.set(
      point.x + normal.x,
      point.y + normal.y,
      point.z + normal.z,
    );
    slot.mesh.lookAt(this.normalTarget);
    slot.mesh.material = onTarget ? this.targetMaterial : this.surfaceMaterial;
    slot.mesh.scale.setScalar(onTarget ? 1.35 : 1);
    slot.mesh.visible = true;
    slot.remaining = IMPACT_LIFETIME;
  }

  /** Draws a brief streak from the muzzle to the impact point. */
  spawnTracer(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): void {
    const slot = this.tracers[this.nextTracer];
    if (slot === undefined) return;
    this.nextTracer = (this.nextTracer + 1) % this.tracers.length;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.05) return;

    slot.line.position.set(from.x + dx * 0.5, from.y + dy * 0.5, from.z + dz * 0.5);
    this.normalTarget.set(to.x, to.y, to.z);
    slot.line.lookAt(this.normalTarget);
    // The box is a unit length along Z; scaling it is cheaper than rebuilding it.
    slot.line.scale.set(1, 1, length);
    slot.line.visible = true;
    slot.remaining = TRACER_LIFETIME;
  }

  /** @param dt Real frame delta, seconds. */
  update(dt: number): void {
    for (const slot of this.impacts) {
      if (slot.remaining <= 0) continue;
      slot.remaining -= dt;
      if (slot.remaining <= 0) {
        slot.remaining = 0;
        slot.mesh.visible = false;
      }
    }

    for (const slot of this.tracers) {
      if (slot.remaining <= 0) continue;
      slot.remaining -= dt;
      if (slot.remaining <= 0) {
        slot.remaining = 0;
        slot.line.visible = false;
      }
    }
  }

  /** Number of currently visible marks. Development hook. */
  get activeCount(): number {
    let count = 0;
    for (const slot of this.impacts) if (slot.remaining > 0) count++;
    for (const slot of this.tracers) if (slot.remaining > 0) count++;
    return count;
  }

  dispose(): void {
    this.impactGeometry.dispose();
    this.tracerGeometry.dispose();
    this.surfaceMaterial.dispose();
    this.targetMaterial.dispose();
    this.tracerMaterial.dispose();
  }
}
