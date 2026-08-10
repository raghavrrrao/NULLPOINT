import type * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
  ASSAULT_RIFLE,
  applySpread,
  applyShotRecoil,
  createRandom,
  createRecoilState,
  createWeaponInput,
  createWeaponRuntime,
  damageAtDistance,
  recoverRecoil,
  spreadFor,
  stepWeapon,
  type Damageable,
  type HitInfo,
  type Random,
  type RecoilState,
  type Vec3,
  type WeaponDefinition,
  type WeaponInput,
  type WeaponRuntime,
} from "@nullpoint/shared";

import { GameSound, type AudioSystem } from "../audio/AudioSystem.ts";
import { PhysicsWorld, type RayHit } from "../physics/PhysicsWorld.ts";
import type { DamageableRegistry } from "./DamageableRegistry.ts";
import { ImpactEffects } from "./ImpactEffects.ts";
import { MuzzleFlash } from "./MuzzleFlash.ts";
import { createRifleModel, type RifleModel } from "./RifleModel.ts";

/** What the most recent shot did. Drives the HUD and the debug readout. */
export interface ShotOutcome {
  hit: boolean;
  /** True when the thing hit was damageable. */
  onTarget: boolean;
  targetId: string;
  damage: number;
  distance: number;
  killed: boolean;
}

export interface WeaponSystemOptions {
  /** Joint the weapon is parented to. */
  readonly attachTo: THREE.Object3D;
  /** Collider to ignore when tracing — the shooter's own capsule. */
  readonly ignoreCollider: RAPIER.Collider;
  readonly definition?: WeaponDefinition;
  /** Seed for spread and recoil variation. Fixed so runs are reproducible. */
  readonly seed?: number;
}

/**
 * Resolves firing: input in, hitscan and feedback out.
 *
 * The *rules* — fire rate, ammunition, reload, state transitions, damage — all
 * live in `@nullpoint/shared`. This class only connects them to the physics
 * world and the renderer, which is what will let the same rules move behind
 * server authority in a later phase without being rewritten
 * (Phase 2 brief §30).
 */
export class WeaponSystem {
  readonly definition: WeaponDefinition;
  readonly runtime: WeaponRuntime;
  readonly recoil: RecoilState;

  private readonly physics: PhysicsWorld;
  private readonly damageables: DamageableRegistry;
  private readonly audio: AudioSystem;
  private readonly ignoreCollider: RAPIER.Collider;

  private readonly model: RifleModel;
  private readonly muzzleFlash: MuzzleFlash;
  readonly effects: ImpactEffects;

  private readonly random: Random;

  // Scratch objects, reused every shot. Nothing here is allocated while firing.
  private readonly rayHit: RayHit = PhysicsWorld.createRayHit();
  private readonly aimHit: RayHit = PhysicsWorld.createRayHit();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly muzzleWorld = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();
  private readonly shotDirection: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly spreadDirection: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly hitInfo: { point: Vec3; normal: Vec3; distance: number; sourceId: string } = {
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: 0,
    sourceId: "LOCAL_PLAYER",
  };

  private readonly weaponInput: WeaponInput = createWeaponInput();
  private readonly lastShot: ShotOutcome = {
    hit: false,
    onTarget: false,
    targetId: "",
    damage: 0,
    distance: 0,
    killed: false,
  };

  /** Set on a damaging hit, consumed by the HUD to show the marker. */
  private hitMarkerPending = false;
  private killPending = false;
  /** Name of whatever the aim ray is currently over. Debug readout only. */
  private aimTargetId = "";

  private kickBack = 0;

  constructor(
    physics: PhysicsWorld,
    damageables: DamageableRegistry,
    audio: AudioSystem,
    options: WeaponSystemOptions,
  ) {
    this.physics = physics;
    this.damageables = damageables;
    this.audio = audio;
    this.ignoreCollider = options.ignoreCollider;
    this.definition = options.definition ?? ASSAULT_RIFLE;

    this.runtime = createWeaponRuntime(this.definition);
    this.recoil = createRecoilState();
    this.random = createRandom(options.seed ?? 0x5eed);

    this.model = createRifleModel();
    options.attachTo.add(this.model.root);

    this.muzzleFlash = new MuzzleFlash();
    this.model.muzzle.add(this.muzzleFlash.object);

    this.effects = new ImpactEffects();
  }

  /** Hand targets on the weapon, for the character's arm IK. */
  get grips(): { right: THREE.Object3D; left: THREE.Object3D } {
    return { right: this.model.gripRight, left: this.model.gripLeft };
  }

  /** Impact marks live in world space, so they hang off the scene, not the gun. */
  get effectsGroup(): THREE.Object3D {
    return this.effects.group;
  }

  get lastShotOutcome(): Readonly<ShotOutcome> {
    return this.lastShot;
  }

  get currentAimTargetId(): string {
    return this.aimTargetId;
  }


  /** True once, for the frame after a damaging hit. */
  consumeHitMarker(): boolean {
    const pending = this.hitMarkerPending;
    this.hitMarkerPending = false;
    return pending;
  }

  consumeKillMarker(): boolean {
    const pending = this.killPending;
    this.killPending = false;
    return pending;
  }

  /**
   * Advances the weapon one fixed tick.
   *
   * `cameraPosition` and `cameraDirection` describe the crosshair ray — the
   * player aims with the camera, not with the character's facing.
   */
  fixedUpdate(
    firePressed: boolean,
    fireHeld: boolean,
    reloadPressed: boolean,
    aimHeld: boolean,
    cameraPosition: THREE.Vector3,
    cameraDirection: THREE.Vector3,
    dt: number,
  ): void {
    this.weaponInput.firePressed = firePressed;
    this.weaponInput.fireHeld = fireHeld;
    this.weaponInput.reloadPressed = reloadPressed;
    this.weaponInput.aimHeld = aimHeld;

    recoverRecoil(this.recoil, this.definition.recoil, dt);
    this.kickBack = Math.max(0, this.kickBack - dt * 6);

    // Resolve what the crosshair is over before firing, so the HUD can name it
    // even when the trigger is not down.
    this.resolveAimPoint(cameraPosition, cameraDirection);

    const result = stepWeapon(this.runtime, this.weaponInput, dt, this.definition);

    if (result.reloadStarted) this.audio.play(GameSound.ReloadStart);
    if (result.reloadCompleted) this.audio.play(GameSound.ReloadEnd);
    if (result.dryFired) this.audio.play(GameSound.WeaponDryFire);

    for (let i = 0; i < result.shotsFired; i++) {
      this.resolveShot();
    }
  }

  /**
   * Casts the crosshair ray and records where it lands.
   *
   * This is the point the muzzle is aimed at (Phase 2 brief §8). Firing straight
   * down the character's forward vector, or straight down the camera ray from the
   * camera's own position, both put shots visibly off from the crosshair because
   * the camera sits behind and to the side of the weapon.
   */
  private resolveAimPoint(cameraPosition: THREE.Vector3, cameraDirection: THREE.Vector3): void {
    this.rayOrigin.x = cameraPosition.x;
    this.rayOrigin.y = cameraPosition.y;
    this.rayOrigin.z = cameraPosition.z;
    this.rayDirection.x = cameraDirection.x;
    this.rayDirection.y = cameraDirection.y;
    this.rayDirection.z = cameraDirection.z;

    const hit = this.physics.castRay(
      this.rayOrigin,
      this.rayDirection,
      this.definition.range,
      this.aimHit,
      this.ignoreCollider,
    );

    if (hit === null) {
      // Nothing out there: aim at a point on the far edge of the weapon's range.
      this.aimPoint.set(
        cameraPosition.x + cameraDirection.x * this.definition.range,
        cameraPosition.y + cameraDirection.y * this.definition.range,
        cameraPosition.z + cameraDirection.z * this.definition.range,
      );
      this.aimTargetId = "";
      return;
    }

    this.aimPoint.set(hit.point.x, hit.point.y, hit.point.z);
    const damageable = this.damageables.find(hit.colliderHandle);
    this.aimTargetId = damageable !== null ? damageable.damageableId : "";
  }

  /** Fires one round: trace from the muzzle toward the aim point, then feedback. */
  private resolveShot(): void {
    this.model.muzzle.getWorldPosition(this.muzzleWorld);

    // Direction from the muzzle to where the crosshair is pointing, so the
    // tracer and the hit agree with what the player sees.
    let dx = this.aimPoint.x - this.muzzleWorld.x;
    let dy = this.aimPoint.y - this.muzzleWorld.y;
    let dz = this.aimPoint.z - this.muzzleWorld.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) {
      dx = 0;
      dy = 0;
      dz = -1;
    } else {
      dx /= length;
      dy /= length;
      dz /= length;
    }
    this.shotDirection.x = dx;
    this.shotDirection.y = dy;
    this.shotDirection.z = dz;

    applySpread(
      this.shotDirection,
      spreadFor(this.definition, this.runtime.aiming),
      this.random,
      this.spreadDirection,
    );

    this.rayOrigin.x = this.muzzleWorld.x;
    this.rayOrigin.y = this.muzzleWorld.y;
    this.rayOrigin.z = this.muzzleWorld.z;
    this.rayDirection.x = this.spreadDirection.x;
    this.rayDirection.y = this.spreadDirection.y;
    this.rayDirection.z = this.spreadDirection.z;

    const hit = this.physics.castRay(
      this.rayOrigin,
      this.rayDirection,
      this.definition.range,
      this.rayHit,
      this.ignoreCollider,
    );

    this.muzzleFlash.trigger(this.definition.muzzleFlashSeconds);
    this.kickBack = 1;
    applyShotRecoil(this.recoil, this.definition.recoil, this.random);
    this.audio.play(GameSound.WeaponFire);

    this.lastShot.hit = hit !== null;
    this.lastShot.onTarget = false;
    this.lastShot.targetId = "";
    this.lastShot.damage = 0;
    this.lastShot.killed = false;
    this.lastShot.distance = hit !== null ? hit.distance : this.definition.range;

    if (hit === null) {
      // A clean miss into open space still deserves a tracer, so the shot reads.
      this.effects.spawnTracer(this.muzzleWorld, {
        x: this.muzzleWorld.x + this.spreadDirection.x * this.definition.range,
        y: this.muzzleWorld.y + this.spreadDirection.y * this.definition.range,
        z: this.muzzleWorld.z + this.spreadDirection.z * this.definition.range,
      });
      return;
    }

    const damageable: Damageable | null = this.damageables.find(hit.colliderHandle);
    const onTarget = damageable !== null && damageable.isAlive;

    this.effects.spawnTracer(this.muzzleWorld, hit.point);
    this.effects.spawnImpact(hit.point, hit.normal, onTarget);

    if (damageable === null) return;

    this.lastShot.targetId = damageable.damageableId;
    if (!damageable.isAlive) return;

    this.hitInfo.point.x = hit.point.x;
    this.hitInfo.point.y = hit.point.y;
    this.hitInfo.point.z = hit.point.z;
    this.hitInfo.normal.x = hit.normal.x;
    this.hitInfo.normal.y = hit.normal.y;
    this.hitInfo.normal.z = hit.normal.z;
    this.hitInfo.distance = hit.distance;

    const damage = damageAtDistance(this.definition, hit.distance);
    const result = damageable.takeDamage(damage, this.hitInfo as HitInfo);

    this.lastShot.onTarget = result.applied > 0;
    this.lastShot.damage = result.applied;
    this.lastShot.killed = result.killed;

    if (result.applied > 0) {
      // Only a hit that actually removed health shows a marker — the brief is
      // explicit that a miss must not.
      this.hitMarkerPending = true;
      this.audio.play(GameSound.TargetHit);
    }
    if (result.killed) {
      this.killPending = true;
      this.audio.play(GameSound.TargetDestroyed);
    }
  }

  /** @param dt Real frame delta, seconds. */
  render(dt: number): void {
    this.muzzleFlash.update(dt);
    this.effects.update(dt);
    // Weapon recoils backward along its own axis and tips up with the kick.
    this.model.root.position.z = this.kickBack * this.definition.recoil.kickBack;
    this.model.root.rotation.x = this.kickBack * 0.16;
  }

  get muzzleFlashVisible(): boolean {
    return this.muzzleFlash.isVisible;
  }

  get muzzleFlashCount(): number {
    return this.muzzleFlash.triggerCount;
  }

  /**
   * The direction the barrel points, in world space.
   *
   * The model is built along −Z (`CLAUDE.md` §5), so this is −Z through the
   * weapon's world rotation. Used by the aim-orientation regression test.
   */
  weaponForward(out: THREE.Vector3): THREE.Vector3 {
    this.model.root.getWorldQuaternion(this.scratchQuaternion);
    return out.set(0, 0, -1).applyQuaternion(this.scratchQuaternion);
  }

  /** Muzzle position in world space. Development hook for placement checks. */
  muzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.model.muzzle.getWorldPosition(out);
  }

  /** Weapon origin (the grip) in world space. Development hook. */
  gripWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.model.root.getWorldPosition(out);
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
    this.muzzleFlash.dispose();
    this.effects.dispose();
  }
}
