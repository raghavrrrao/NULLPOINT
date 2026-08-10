import type * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
  BOT_CONFIG,
  BotState,
  PLAYER_CONFIG,
  applyDamage,
  capsuleHalfHeight,
  commitMovementResult,
  createBotBrain,
  createCharacterSimState,
  createMoveIntent,
  damageAtDistance,
  damp,
  stepBotBrain,
  stepCharacterMovement,
  vec3,
  wrapAngle,
  type BotBrain,
  type Damageable,
  type DamageResult,
  type HitInfo,
  type MoveIntent,
  type Vec3,
  type WeaponDefinition,
} from "@nullpoint/shared";

import type { DamageableRegistry } from "../combat/DamageableRegistry.ts";
import { PhysicsWorld } from "../physics/PhysicsWorld.ts";

/**
 * A training bot: something that moves, shoots back, dies and respawns.
 *
 * Reuses the player's machinery deliberately. Movement runs through the same
 * `stepCharacterMovement` and the same Rapier kinematic capsule, so the bot
 * cannot accelerate impossibly, walk through walls or teleport; damage runs
 * through the same `Damageable` contract and the same falloff curve, so there is
 * exactly one set of combat rules in the project.
 *
 * Its decisions come from `stepBotBrain` in the shared package, which knows
 * nothing about Rapier or Three.js.
 */

const BOT_HEIGHT = 1.8;
const BOT_RADIUS = PLAYER_CONFIG.radius;
const BOT_HALF_HEIGHT = capsuleHalfHeight(BOT_HEIGHT, BOT_RADIUS);
const BOT_MAX_HEALTH = 150;

/** Height above the feet the bot's shots leave from, m. */
const MUZZLE_HEIGHT = 1.45;
/** Height above the feet the bot aims at, m — centre mass, not the feet. */
const AIM_HEIGHT = 1.15;

/** How fast the bot turns toward its target, rad/s. */
const TURN_RATE = 6;

const ALIVE_COLOUR = 0xb4553f;
const HURT_COLOUR = 0xd6a53c;
const DEAD_COLOUR = 0x3a3f45;

export interface CombatBotOptions {
  readonly id: string;
  readonly spawn: Vec3;
  /** Weapon the bot's shots are resolved with — the falloff curve comes from it. */
  readonly weapon: WeaponDefinition;
  /** Damage per hit before falloff. Lower than the player's, deliberately. */
  readonly damage: number;
}

export interface BotShot {
  readonly origin: Vec3;
  readonly hitPoint: Vec3;
  readonly hitPlayer: boolean;
  readonly damage: number;
}

export class CombatBot implements Damageable {
  readonly damageableId: string;
  readonly maxHealth = BOT_MAX_HEALTH;
  readonly group = new THREE.Group();

  private readonly physics: PhysicsWorld;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly registry: DamageableRegistry;

  private readonly state = createCharacterSimState(vec3());
  private readonly brain: BotBrain = createBotBrain();
  private readonly intent: MoveIntent = createMoveIntent();
  private readonly requested: Vec3 = vec3();
  private readonly applied: Vec3 = vec3();
  private readonly spawn: Vec3;
  private readonly options: CombatBotOptions;

  private currentHealth = BOT_MAX_HEALTH;
  private flash = 0;
  private distanceToPlayer = Number.POSITIVE_INFINITY;
  private lineOfSight = false;

  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly visor: THREE.Mesh;
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly rayHit = PhysicsWorld.createRayHit();
  private readonly origin = vec3();
  private readonly direction = vec3();
  private readonly aimPoint = vec3();
  private lastShot: BotShot | null = null;
  private shotsFired = 0;

  constructor(physics: PhysicsWorld, registry: DamageableRegistry, options: CombatBotOptions) {
    this.physics = physics;
    this.registry = registry;
    this.options = options;
    this.damageableId = options.id;
    this.spawn = { ...options.spawn };

    this.state.position.x = this.spawn.x;
    this.state.position.y = this.spawn.y;
    this.state.position.z = this.spawn.z;

    const created = physics.createCharacterBody(this.spawn, BOT_HALF_HEIGHT, BOT_RADIUS);
    this.body = created.body;
    this.collider = created.collider;
    this.controller = physics.createCharacterController();

    registry.register(this.collider.handle, this);

    // Placeholder geometry, in the same self-made spirit as the training plates:
    // a capsule so its silhouette reads as a person-sized thing, and a visor so
    // its facing is legible from any angle.
    const bodyGeometry = new THREE.CapsuleGeometry(BOT_RADIUS, BOT_HEIGHT - BOT_RADIUS * 2, 6, 12);
    this.geometries.push(bodyGeometry);
    this.material = new THREE.MeshStandardMaterial({ color: ALIVE_COLOUR, roughness: 0.7 });
    this.mesh = new THREE.Mesh(bodyGeometry, this.material);
    this.mesh.position.y = BOT_HALF_HEIGHT + BOT_RADIUS;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    const visorGeometry = new THREE.BoxGeometry(0.26, 0.1, 0.08);
    this.geometries.push(visorGeometry);
    const visorMaterial = new THREE.MeshStandardMaterial({ color: 0xffd27f, emissive: 0x6b4a12 });
    this.visor = new THREE.Mesh(visorGeometry, visorMaterial);
    this.visor.position.set(0, BOT_HEIGHT - 0.28, -BOT_RADIUS);
    this.group.add(this.visor);

    this.group.name = `bot-${options.id}`;
    this.group.position.set(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  get health(): number {
    return this.currentHealth;
  }

  get isAlive(): boolean {
    return this.currentHealth > 0;
  }

  get botState(): BotState {
    return this.brain.state;
  }

  get position(): Readonly<Vec3> {
    return this.state.position;
  }

  get distance(): number {
    return this.distanceToPlayer;
  }

  get hasLineOfSight(): boolean {
    return this.lineOfSight;
  }

  get fireCooldown(): number {
    return this.brain.fireCooldown;
  }

  get respawnCountdown(): number {
    return this.brain.respawnCountdown;
  }

  get shotCount(): number {
    return this.shotsFired;
  }

  get lastShotFired(): BotShot | null {
    return this.lastShot;
  }

  get botCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Damage taken through the shared contract, exactly as a target does. */
  takeDamage(amount: number, _hit: HitInfo): DamageResult {
    const result = applyDamage(this.currentHealth, this.maxHealth, amount);
    if (result.applied <= 0) return result;

    this.currentHealth = result.remainingHealth;
    this.flash = 1;
    if (result.killed) {
      // A dead bot must stop absorbing rounds aimed past it, and must stop
      // being an obstacle the player collides with.
      this.collider.setEnabled(false);
    }
    return result;
  }

  /**
   * Advances the bot one fixed tick.
   *
   * @param playerFeet  Player position at the feet.
   * @param playerAlive False while the player is dead.
   * @param playerCollider The player's capsule, so line-of-sight can tell the
   *                    player apart from the wall in front of them.
   */
  fixedUpdate(
    playerFeet: Readonly<Vec3>,
    playerAlive: boolean,
    playerCollider: RAPIER.Collider,
    dt: number,
  ): void {
    this.aimPoint.x = playerFeet.x;
    this.aimPoint.y = playerFeet.y + AIM_HEIGHT;
    this.aimPoint.z = playerFeet.z;

    this.origin.x = this.state.position.x;
    this.origin.y = this.state.position.y + MUZZLE_HEIGHT;
    this.origin.z = this.state.position.z;

    const dx = this.aimPoint.x - this.origin.x;
    const dy = this.aimPoint.y - this.origin.y;
    const dz = this.aimPoint.z - this.origin.z;
    this.distanceToPlayer = Math.hypot(dx, dy, dz);
    this.lineOfSight = this.isAlive && this.checkLineOfSight(playerCollider);

    const decision = stepBotBrain(
      this.brain,
      {
        distance: this.distanceToPlayer,
        hasLineOfSight: this.lineOfSight,
        playerAlive,
        alive: this.isAlive,
      },
      dt,
      BOT_CONFIG,
    );

    if (decision.respawn) {
      this.respawn();
      return;
    }

    if (!this.isAlive) {
      // Still stepped so it settles on the ground rather than freezing mid-air.
      this.stepMovement(false, dt);
      return;
    }

    if (decision.face) this.faceTarget(dx, dz, dt);
    this.stepMovement(decision.move, dt);
    if (decision.fire) this.fire(playerCollider);
  }

  /**
   * Turns toward the player at a bounded rate.
   *
   * Rate-limited rather than snapped: an instantly-rotating bot reads as a
   * turret and makes it impossible to tell whether it has actually acquired you.
   */
  private faceTarget(dx: number, dz: number, dt: number): void {
    if (dx === 0 && dz === 0) return;
    // Character forward is −Z, so this is the yaw that points at the player.
    const wanted = Math.atan2(dx, -dz);
    const delta = wrapAngle(wanted - this.state.yaw);
    const step = Math.min(Math.abs(delta), TURN_RATE * dt) * Math.sign(delta);
    this.state.yaw = wrapAngle(this.state.yaw + step);
  }

  private stepMovement(move: boolean, dt: number): void {
    this.intent.forward = move ? 1 : 0;
    this.intent.right = 0;
    // The shared movement resolves input against a camera yaw; the bot's "camera"
    // is simply the direction it faces, so it walks where it looks.
    this.intent.cameraYaw = this.state.yaw;
    this.intent.sprint = false;
    this.intent.walk = false;
    this.intent.crouch = false;
    // Aim mode keeps the body facing its yaw instead of turning into the
    // direction of travel, which is what a bot advancing on a target should do.
    this.intent.aim = true;
    this.intent.jump = false;
    this.intent.speedMultiplier = 1;

    stepCharacterMovement(this.state, this.intent, dt, PLAYER_CONFIG, this.requested);

    this.controller.computeColliderMovement(this.collider, this.requested);
    const movement = this.controller.computedMovement();
    this.applied.x = movement.x;
    this.applied.y = movement.y;
    this.applied.z = movement.z;

    commitMovementResult(
      this.state,
      this.applied,
      this.requested,
      this.controller.computedGrounded(),
      dt,
      PLAYER_CONFIG,
    );

    this.body.setNextKinematicTranslation({
      x: this.state.position.x,
      y: this.state.position.y + BOT_HALF_HEIGHT + BOT_RADIUS,
      z: this.state.position.z,
    });
  }

  /**
   * True when nothing solid stands between the bot's muzzle and the player.
   *
   * The bot's own capsule is excluded, since the ray starts inside it. Anything
   * else the ray reaches first — a wall, a crate, a training plate — means no
   * shot. This is what stops the bot shooting through cover.
   */
  private checkLineOfSight(playerCollider: RAPIER.Collider): boolean {
    if (this.distanceToPlayer <= 0.001) return true;

    this.direction.x = (this.aimPoint.x - this.origin.x) / this.distanceToPlayer;
    this.direction.y = (this.aimPoint.y - this.origin.y) / this.distanceToPlayer;
    this.direction.z = (this.aimPoint.z - this.origin.z) / this.distanceToPlayer;

    const hit = this.physics.castRay(
      this.origin,
      this.direction,
      this.distanceToPlayer + 0.1,
      this.rayHit,
      this.collider,
    );
    return hit !== null && hit.colliderHandle === playerCollider.handle;
  }

  /**
   * Fires one round along the same hitscan path the player's weapon uses.
   *
   * Damage goes through the shared falloff curve and the shared `Damageable`
   * contract; nothing about the arithmetic is duplicated here.
   */
  private fire(playerCollider: RAPIER.Collider): void {
    this.shotsFired += 1;

    const hit = this.physics.castRay(
      this.origin,
      this.direction,
      this.options.weapon.range,
      this.rayHit,
      this.collider,
    );

    if (hit === null) {
      this.lastShot = {
        origin: { ...this.origin },
        hitPoint: { ...this.origin },
        hitPlayer: false,
        damage: 0,
      };
      return;
    }

    const hitPoint = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    const onPlayer = hit.colliderHandle === playerCollider.handle;
    let damage = 0;

    if (onPlayer) {
      const damageable = this.registry.find(hit.colliderHandle);
      if (damageable !== null) {
        const falloff = damageAtDistance(this.options.weapon, hit.distance);
        // The definition's damage is the player's rifle; scale to the bot's.
        damage = (falloff / this.options.weapon.damage) * this.options.damage;
        damageable.takeDamage(damage, {
          point: hitPoint,
          normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
          distance: hit.distance,
          sourceId: this.damageableId,
        });
      }
    }

    this.lastShot = { origin: { ...this.origin }, hitPoint, hitPlayer: onPlayer, damage };
  }

  private respawn(): void {
    this.currentHealth = this.maxHealth;
    this.flash = 0;
    this.collider.setEnabled(true);

    this.state.position.x = this.spawn.x;
    this.state.position.y = this.spawn.y;
    this.state.position.z = this.spawn.z;
    this.state.velocity.x = 0;
    this.state.velocity.y = 0;
    this.state.velocity.z = 0;
    this.state.yaw = 0;

    this.body.setTranslation(
      {
        x: this.spawn.x,
        y: this.spawn.y + BOT_HALF_HEIGHT + BOT_RADIUS,
        z: this.spawn.z,
      },
      true,
    );
  }

  /** Visual update between fixed ticks. */
  render(dt: number): void {
    this.group.position.set(this.state.position.x, this.state.position.y, this.state.position.z);
    this.group.rotation.y = this.state.yaw;

    this.flash = Math.max(0, this.flash - 9 * dt);

    const fraction = this.currentHealth / this.maxHealth;
    const base = !this.isAlive ? DEAD_COLOUR : fraction > 0.45 ? ALIVE_COLOUR : HURT_COLOUR;
    this.material.color.setHex(base);
    this.material.emissive.setRGB(this.flash * 0.6, this.flash * 0.6, this.flash * 0.6);

    // Dropping the capsule below the floor reads as "down" without needing a
    // death animation the placeholder does not have.
    const targetLean = this.isAlive ? 0 : -Math.PI / 2.1;
    this.mesh.rotation.x = damp(this.mesh.rotation.x, targetLean, 10, dt);
    this.visor.visible = this.isAlive;
  }

  dispose(): void {
    this.registry.unregister(this.collider.handle);
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeCollider(this.collider, false);
    this.physics.world.removeRigidBody(this.body);
  }
}
