import type { Damageable } from "@nullpoint/shared";

/**
 * Maps Rapier collider handles to the things they represent.
 *
 * Hitscan gets a collider handle back from the physics world and needs to know
 * whether it belongs to something that can be hurt. A registry keeps that lookup
 * out of the physics layer, which should not know what a "target" is, and out of
 * the weapon, which should not know what a collider is.
 */
export class DamageableRegistry {
  private readonly byCollider = new Map<number, Damageable>();

  register(colliderHandle: number, damageable: Damageable): void {
    this.byCollider.set(colliderHandle, damageable);
  }

  unregister(colliderHandle: number): void {
    this.byCollider.delete(colliderHandle);
  }

  /** Returns the damageable for a collider, or null if it is plain geometry. */
  find(colliderHandle: number): Damageable | null {
    return this.byCollider.get(colliderHandle) ?? null;
  }

  get size(): number {
    return this.byCollider.size;
  }

  clear(): void {
    this.byCollider.clear();
  }
}
