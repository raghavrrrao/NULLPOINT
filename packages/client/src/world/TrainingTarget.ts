import * as THREE from "three";

import type * as RAPIER from "@dimforge/rapier3d-compat";

import { applyDamage, clamp, damp, type Damageable, type DamageResult, type HitInfo } from "@nullpoint/shared";

import type { PhysicsWorld } from "../physics/PhysicsWorld.ts";

/**
 * A training target.
 *
 * The simplest thing that satisfies the `Damageable` contract: health, a
 * collider, a mesh, and readable feedback. No AI.
 *
 * A target may optionally travel along a straight line (see {@link TargetMotion}).
 * A moving target sits on a **kinematic** body rather than a static one, so its
 * collider travels with its mesh — a plate whose visual moves while its collider
 * stays put is a target you cannot hit where you can see it.
 */

/**
 * Straight-line oscillation, `centre ± amplitude` along one axis.
 *
 * Phase-offset so several targets on the same period do not move in lockstep,
 * which is much less useful to shoot at.
 */
export interface TargetMotion {
  readonly axis: "x" | "y" | "z";
  /** Half the travel, m. */
  readonly amplitude: number;
  /** Seconds for one full there-and-back cycle. */
  readonly period: number;
  /** Starting phase, 0..1 of a cycle. */
  readonly phase?: number;
}

export interface TrainingTargetOptions {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly health: number;
  /** Plate width and height, m. */
  readonly size: readonly [number, number];
  /** Rotation about Y so the plate faces the firing line, radians. */
  readonly facing: number;
  /**
   * Length of the supporting post below the plate, m.
   *
   * Given rather than derived from the plate height, so a target standing on a
   * raised block does not sprout a post that reaches down through it to y = 0.
   */
  readonly postHeight: number;
  /** Absent for a stationary target. */
  readonly motion?: TargetMotion;
}

const HEALTHY_COLOUR = new THREE.Color(0x3f9d6d);
const HURT_COLOUR = new THREE.Color(0xd6a53c);
const CRITICAL_COLOUR = new THREE.Color(0xc4503f);
const DEAD_COLOUR = new THREE.Color(0x33383e);
const FLASH_COLOUR = new THREE.Color(0xffffff);

/** Seconds the white impact flash stays at full strength. */
const FLASH_DECAY_RATE = 9;
/** How far the plate tips back when destroyed, radians. */
const DEAD_TILT = -Math.PI / 2.2;

export class TrainingTarget implements Damageable {
  readonly damageableId: string;
  readonly maxHealth: number;
  readonly group = new THREE.Group();

  private currentHealth: number;
  private readonly plate: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly healthBar: THREE.Mesh;
  private readonly healthBarMaterial: THREE.MeshBasicMaterial;
  private readonly collider: RAPIER.Collider;
  private readonly colliderHandle: number;
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly motion: TargetMotion | null;
  private readonly body: RAPIER.RigidBody | null;
  private readonly origin: THREE.Vector3;
  private readonly nextTranslation = { x: 0, y: 0, z: 0 };
  private elapsed = 0;

  private flash = 0;
  private tilt = 0;
  /** Set on hit, decays — drives the recoil-like plate kick. */
  private kick = 0;

  constructor(physics: PhysicsWorld, options: TrainingTargetOptions) {
    this.damageableId = options.id;
    this.maxHealth = options.health;
    this.currentHealth = options.health;

    const [width, height] = options.size;
    const [x, y, z] = options.position;

    this.group.position.set(x, y, z);
    this.group.rotation.y = options.facing;
    this.group.name = `target-${options.id}`;

    // Post, so the plate reads as a standing target rather than a floating slab.
    const postGeometry = new THREE.BoxGeometry(0.12, options.postHeight, 0.12);
    this.geometries.push(postGeometry);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x4a525b, roughness: 0.9 });
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.y = -options.postHeight / 2;
    post.castShadow = true;
    post.receiveShadow = true;
    this.group.add(post);

    const plateGeometry = new THREE.BoxGeometry(width, height, 0.14);
    this.geometries.push(plateGeometry);
    this.material = new THREE.MeshStandardMaterial({ color: HEALTHY_COLOUR.clone(), roughness: 0.65 });
    this.plate = new THREE.Mesh(plateGeometry, this.material);
    this.plate.castShadow = true;
    this.plate.receiveShadow = true;
    this.group.add(this.plate);

    // Health bar above the plate. Scaled on the X axis as health drops.
    const barGeometry = new THREE.PlaneGeometry(width, 0.1);
    this.geometries.push(barGeometry);
    this.healthBarMaterial = new THREE.MeshBasicMaterial({
      color: 0x8ee0b0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.healthBar = new THREE.Mesh(barGeometry, this.healthBarMaterial);
    this.healthBar.position.set(0, height / 2 + 0.16, 0.08);
    this.group.add(this.healthBar);

    // The collider matches the plate only. The post is decoration, so shots that
    // clip the post do not register as target hits.
    const halfExtents = { x: width / 2, y: height / 2, z: 0.07 };
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, options.facing, 0));
    this.motion = options.motion ?? null;
    this.origin = new THREE.Vector3(x, y, z);

    if (this.motion === null) {
      this.body = null;
      this.collider = physics.addStaticBox({ x, y, z }, halfExtents, rotation);
    } else {
      const created = physics.addKinematicBox({ x, y, z }, halfExtents, rotation);
      this.body = created.body;
      this.collider = created.collider;
      this.elapsed = (this.motion.phase ?? 0) * this.motion.period;
    }
    this.colliderHandle = this.collider.handle;
  }

  /** True for a target that travels. Development hook. */
  get isMoving(): boolean {
    return this.motion !== null;
  }

  /** Current world position of the plate. Development hook. */
  get worldPosition(): Readonly<{ x: number; y: number; z: number }> {
    return { x: this.group.position.x, y: this.group.position.y, z: this.group.position.z };
  }

  get colliderId(): number {
    return this.colliderHandle;
  }

  get health(): number {
    return this.currentHealth;
  }

  get isAlive(): boolean {
    return this.currentHealth > 0;
  }

  /**
   * Applies a hit.
   *
   * The arithmetic lives in `applyDamage` in the shared package, so a networked
   * target in a later phase gets the identical clamping and overkill behaviour.
   */
  takeDamage(amount: number, _hit: HitInfo): DamageResult {
    const result = applyDamage(this.currentHealth, this.maxHealth, amount);
    if (result.applied <= 0) return result;

    this.currentHealth = result.remainingHealth;
    this.flash = 1;
    this.kick = 1;
    if (result.killed) {
      this.tilt = DEAD_TILT;
      // A destroyed plate must stop blocking shots. Without this it tips over
      // visually while its collider stays upright, and every round aimed at a
      // target behind it is silently absorbed by something that looks gone.
      this.collider.setEnabled(false);
    }
    return result;
  }

  /** Restores full health and resets the visual state. */
  reset(): void {
    this.currentHealth = this.maxHealth;
    this.flash = 0;
    this.kick = 0;
    this.tilt = 0;
    this.collider.setEnabled(true);
  }

  /** @param dt Real frame delta, seconds. */
  update(dt: number): void {
    this.advanceMotion(dt);
    this.flash = Math.max(0, this.flash - FLASH_DECAY_RATE * dt);
    this.kick = Math.max(0, this.kick - 6 * dt);

    const fraction = this.maxHealth > 0 ? clamp(this.currentHealth / this.maxHealth, 0, 1) : 0;

    let base: THREE.Color;
    if (!this.isAlive) base = DEAD_COLOUR;
    else if (fraction > 0.6) base = HEALTHY_COLOUR;
    else if (fraction > 0.3) base = HURT_COLOUR;
    else base = CRITICAL_COLOUR;

    this.material.color.copy(base).lerp(FLASH_COLOUR, this.flash);
    this.material.emissive.copy(FLASH_COLOUR).multiplyScalar(this.flash * 0.5);

    // Plate rocks backward when struck, and stays down when destroyed.
    this.plate.rotation.x = damp(this.plate.rotation.x, this.tilt - this.kick * 0.18, 12, dt);

    this.healthBar.visible = this.isAlive;
    this.healthBar.scale.x = fraction;
    this.healthBarMaterial.color.setHex(fraction > 0.3 ? 0x8ee0b0 : 0xe08e8e);
  }

  /**
   * Moves a travelling target, mesh and collider together.
   *
   * A sine rather than a triangle wave so the plate eases at each end instead of
   * reversing instantly, which reads as a glitch and is impossible to lead.
   */
  private advanceMotion(dt: number): void {
    const motion = this.motion;
    const body = this.body;
    if (motion === null || body === null || motion.period <= 0) return;

    this.elapsed = (this.elapsed + dt) % motion.period;
    const offset = Math.sin((this.elapsed / motion.period) * Math.PI * 2) * motion.amplitude;

    this.group.position.copy(this.origin);
    if (motion.axis === "x") this.group.position.x += offset;
    else if (motion.axis === "y") this.group.position.y += offset;
    else this.group.position.z += offset;

    this.nextTranslation.x = this.group.position.x;
    this.nextTranslation.y = this.group.position.y;
    this.nextTranslation.z = this.group.position.z;
    // `setTranslation`, not `setNextKinematicTranslation`. The latter is applied
    // by the next `world.step()`, and this runs on the render loop while the
    // step runs on the fixed one — the mesh moved and the collider stayed at
    // its spawn, so the plate could only be hit where it no longer was.
    // A target follows an authored path and never reacts to a collision, so
    // placing it outright is both correct and exactly synchronous with the mesh.
    body.setTranslation(this.nextTranslation, true);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.healthBarMaterial.dispose();
  }
}
