import {
  CAMERA_CONFIG,
  PLAYER_CONFIG,
  createLogger,
  createMoveIntent,
  formatAmmo,
  vec3,
  wrapAngle,
  type MoveIntent,
} from "@nullpoint/shared";

import * as THREE from "three";

import { createAudioSystem, type AudioSystem } from "../audio/AudioSystem.ts";
import { loadCharacterAsset, type CharacterAsset } from "../character/CharacterAsset.ts";
import { CombatBot } from "../entities/CombatBot.ts";
import { PlayerCombatant, PLAYER_COMBAT_DEFAULTS } from "../entities/PlayerCombatant.ts";
import { DamageableRegistry } from "../combat/DamageableRegistry.ts";
import { WeaponSystem } from "../combat/WeaponSystem.ts";
import { FpsMeter } from "../debug/FpsMeter.ts";
import { Player } from "../entities/Player.ts";
import { InputAction, InputManager } from "../input/InputManager.ts";
import { CombatHud } from "../ui/CombatHud.ts";
import { PhysicsWorld } from "../physics/PhysicsWorld.ts";
import { Renderer } from "../render/Renderer.ts";
import { createSceneEnvironment, type SceneEnvironment } from "../render/SceneEnvironment.ts";
import { ThirdPersonCamera } from "../render/ThirdPersonCamera.ts";
import { DebugHud } from "../ui/DebugHud.ts";
import { Arena } from "../world/Arena.ts";
import { SPAWN_POSITION } from "../world/arenaLayout.ts";
import { BOT_SPAWNS } from "../world/trainingRange.ts";
import { GameLoop } from "./GameLoop.ts";

const log = createLogger("game");

export interface GameElements {
  readonly container: HTMLElement;
  readonly hud: HTMLElement;
  readonly lockOverlay: HTMLElement;
  readonly crosshair: HTMLElement;
  readonly hitMarker: HTMLElement;
  readonly ammo: HTMLElement;
}

/**
 * Wires the prototype together and owns the frame loop.
 *
 * Composition only — no gameplay rules live here. Every subsystem is constructed
 * with its dependencies passed in, per `ARCHITECTURE.md` §6's ban on global
 * mutable singletons.
 */
export class Game {
  private readonly elements: GameElements;
  private readonly renderer: Renderer;
  private readonly environment: SceneEnvironment;
  private readonly physics: PhysicsWorld;
  private readonly arena: Arena;
  private readonly player: Player;
  private readonly camera: ThirdPersonCamera;
  private readonly input: InputManager;
  private readonly hud: DebugHud;
  private readonly hudBody: HTMLElement;
  private readonly loop: GameLoop;
  private readonly fps = new FpsMeter();

  private readonly damageables = new DamageableRegistry();
  private readonly combatant: PlayerCombatant;
  private readonly bots: readonly CombatBot[];
  private readonly audio: AudioSystem;
  private readonly weapon: WeaponSystem;
  private readonly combatHud: CombatHud;
  private readonly cameraWorldPosition = new THREE.Vector3();
  private readonly cameraWorldDirection = new THREE.Vector3();

  private readonly intent: MoveIntent = createMoveIntent();
  private readonly mouseDelta = { x: 0, y: 0 };
  private physicsMs = 0;
  private readonly characterSource: string;

  private constructor(elements: GameElements, physics: PhysicsWorld, asset: CharacterAsset) {
    this.elements = elements;
    this.physics = physics;
    this.characterSource = asset.source === "placeholder" ? "PLACEHOLDER (procedural)" : "GLB";

    this.renderer = new Renderer(elements.container);
    this.environment = createSceneEnvironment();
    this.arena = new Arena(physics, this.damageables);
    this.environment.scene.add(this.arena.group);

    this.player = new Player(
      physics,
      asset,
      vec3(SPAWN_POSITION[0], SPAWN_POSITION[1], SPAWN_POSITION[2]),
    );
    this.environment.scene.add(this.player.object);

    this.camera = new ThirdPersonCamera(this.renderer.camera, physics);
    // Without this the camera collides with the character it is following: the
    // boom sweep starts at the pivot, which sits inside the player's capsule.
    this.camera.ignoreCollider(this.player.characterCollider);
    this.camera.snapTo(
      SPAWN_POSITION[0],
      SPAWN_POSITION[1],
      SPAWN_POSITION[2],
      CAMERA_CONFIG.pivotHeight,
    );

    this.audio = createAudioSystem();
    this.weapon = new WeaponSystem(physics, this.damageables, this.audio, {
      // Parented to the right hand so the rifle inherits the character's
      // movement, rotation and animation without any per-frame bookkeeping.
      attachTo: this.player.weaponAttachment,
      ignoreCollider: this.player.characterCollider,
    });
    // Impact marks and tracers are world-space, so they hang off the scene
    // rather than the weapon — otherwise they would follow the gun around.
    this.environment.scene.add(this.weapon.effectsGroup);
    // The arms are solved onto these, so the grip is correct by construction.
    this.player.setWeaponGrips(this.weapon.grips);

    // The player is damageable through the same contract as everything else, so
    // the bot's hitscan resolves against it by the identical path.
    this.combatant = new PlayerCombatant({
      maxHealth: PLAYER_COMBAT_DEFAULTS.maxHealth,
      respawnDelay: PLAYER_COMBAT_DEFAULTS.respawnDelay,
      spawn: vec3(SPAWN_POSITION[0], SPAWN_POSITION[1], SPAWN_POSITION[2]),
    });
    this.damageables.register(this.player.characterCollider.handle, this.combatant);

    this.bots = BOT_SPAWNS.map(
      (spawn) =>
        new CombatBot(physics, this.damageables, {
          id: spawn.id,
          spawn: vec3(spawn.position[0], spawn.position[1], spawn.position[2]),
          weapon: this.weapon.definition,
          damage: spawn.damage,
        }),
    );
    for (const bot of this.bots) this.environment.scene.add(bot.group);

    this.input = new InputManager(this.renderer.domElement);
    this.input.onPointerLockChanged(({ locked }) => {
      elements.lockOverlay.hidden = locked;
      // Browsers only allow audio to start from a user gesture.
      if (locked) this.audio.resume();
    });
    elements.lockOverlay.addEventListener("click", () => {
      this.input.requestPointerLock();
      this.audio.resume();
    });

    this.combatHud = new CombatHud({
      crosshair: elements.crosshair,
      hitMarker: elements.hitMarker,
      ammo: elements.ammo,
    });

    this.hudBody = DebugHud.mountTitle(elements.hud);
    this.hud = new DebugHud(this.hudBody);
    window.addEventListener("keydown", this.onDebugKey);

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });
  }

  static async create(elements: GameElements): Promise<Game> {
    const physics = await PhysicsWorld.create();
    const asset = await loadCharacterAsset();
    const game = new Game(elements, physics, asset);
    log.info("game ready");
    return game;
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  private readonly onDebugKey = (event: KeyboardEvent): void => {
    if (event.code === "F3") {
      event.preventDefault();
      this.hud.toggle();
    }
  };

  private fixedUpdate(dt: number): void {
    const started = performance.now();

    this.input.sampleIntent(this.camera.viewYaw, this.intent);
    // Aiming slows the character. The multiplier rides on the intent so the
    // movement simulation never has to know a weapon exists.
    this.intent.speedMultiplier = this.intent.aim
      ? this.weapon.definition.aimMoveSpeedMultiplier
      : 1;

    // Dead players do not drive. The intent is blanked rather than the
    // simulation skipped, so gravity, collision and settling still run.
    const dead = this.combatant.isDead;
    if (dead) {
      this.intent.forward = 0;
      this.intent.right = 0;
      this.intent.sprint = false;
      this.intent.jump = false;
      this.intent.aim = false;
    }

    this.player.fixedUpdate(this.intent, dt);

    if (this.combatant.fixedUpdate(dt)) {
      const spawn = this.combatant.spawnPoint;
      this.teleport(spawn.x, spawn.y, spawn.z);
    }

    // Refreshes the query pipeline the camera, headroom and hitscan read from.
    // Stepped before the weapon so shots trace against this tick's positions.
    this.physics.step();

    this.renderer.camera.getWorldPosition(this.cameraWorldPosition);
    this.renderer.camera.getWorldDirection(this.cameraWorldDirection);
    for (const bot of this.bots) {
      bot.fixedUpdate(this.player.position, !dead, this.player.characterCollider, dt);
    }

    this.weapon.fixedUpdate(
      // Firing is disabled while dead. Reloading is too, so the player does not
      // respawn mid-reload.
      !dead && this.input.wasPressed(InputAction.Fire),
      !dead && this.input.isHeld(InputAction.Fire),
      !dead && this.input.wasPressed(InputAction.Reload),
      this.intent.aim,
      this.cameraWorldPosition,
      this.cameraWorldDirection,
      dt,
    );

    this.input.endTick();

    this.physicsMs = performance.now() - started;
  }

  private render(alpha: number, dt: number): void {
    this.fps.sample(dt);

    this.input.consumeMouseDelta(this.mouseDelta);
    this.camera.applyMouseDelta(this.mouseDelta.x, this.mouseDelta.y);
    this.camera.setAiming(this.intent.aim);
    // Recoil is a view offset that decays, so the shot climbs and settles back
    // instead of permanently re-aiming the player.
    this.camera.setRecoil(this.weapon.recoil.pitch, this.weapon.recoil.yaw);

    this.player.render(alpha, dt);
    // Applied after the animation mixer so the weapon pose wins on the bones it
    // touches, leaving legs and hips entirely to the locomotion clips.
    this.player.applyWeaponPose(
      {
        aiming: this.intent.aim,
        sprinting: this.intent.sprint && !this.intent.aim,
        aimYaw: this.camera.viewYaw,
        aimPitch: this.camera.viewPitch,
        bodyYaw: this.player.state.yaw,
        recoilPitch: this.weapon.recoil.pitch,
        crouchBlend: this.player.crouchBlend,
      },
      dt,
    );
    this.weapon.render(dt);
    this.arena.update(dt);
    for (const bot of this.bots) bot.render(dt);

    const p = this.player.object.position;
    this.camera.update(
      p.x,
      p.y,
      p.z,
      this.player.pivotHeight(CAMERA_CONFIG.pivotHeight, CAMERA_CONFIG.crouchPivotHeight),
      dt,
    );
    this.environment.update(p.x, p.z);

    this.renderer.render(this.environment.scene);

    if (this.weapon.consumeHitMarker()) {
      this.combatHud.showHitMarker(this.weapon.consumeKillMarker());
    }
    this.combatHud.update(this.weapon.runtime, this.camera.aimAmount, dt);

    this.hud.update(
      {
        fps: this.fps.fps,
        frameTimeMs: this.fps.frameTimeMs,
        worstFrameTimeMs: this.fps.worstFrameTimeMs,
        state: this.player.movementState,
        grounded: this.player.grounded,
        position: this.player.position,
        velocity: this.player.velocity,
        speed: this.player.horizontalSpeed,
        drawCalls: this.renderer.drawCalls,
        triangles: this.renderer.triangles,
        physicsMs: this.physicsMs,
        characterSource: this.characterSource,
        weaponName: this.weapon.definition.id,
        magazine: this.weapon.runtime.magazine,
        reserve: this.weapon.runtime.reserve,
        weaponState: this.weapon.runtime.state,
        aiming: this.weapon.runtime.aiming,
        aimTarget: this.weapon.currentAimTargetId,
        lastDamage: this.weapon.lastShotOutcome.damage,
        lastTarget: this.weapon.lastShotOutcome.targetId,
        health: this.combatant.health,
        maxHealth: this.combatant.maxHealth,
        respawnIn: this.combatant.timeToRespawn,
        bots: this.bots.map((bot) => ({
          id: bot.damageableId,
          state: bot.botState,
          health: bot.health,
          distance: bot.distance,
          lineOfSight: bot.hasLineOfSight,
          cooldown: bot.fireCooldown,
        })),
      },
      performance.now(),
    );
  }

  /**
   * Read-only view of the running game, for the development test hooks.
   * Not part of the production bundle — see `main.ts`.
   */
  inspect(): Record<string, unknown> {
    return {
      position: { ...this.player.position },
      velocity: { ...this.player.velocity },
      movementState: this.player.movementState,
      grounded: this.player.grounded,
      crouching: this.player.isCrouching,
      speed: this.player.horizontalSpeed,
      yaw: this.player.state.yaw,
      cameraYaw: this.camera.yaw,
      cameraPitch: this.camera.pitch,
      cameraBoom: this.camera.boomDistance,
      cameraLift: this.camera.lift,
      cameraPosition: this.renderer.camera.position.toArray(),
      fps: this.fps.fps,
      drawCalls: this.renderer.drawCalls,
      characterSource: this.characterSource,
      standHeight: PLAYER_CONFIG.standHeight,
      characterHeight: this.player.characterHeight,

      aiming: this.weapon.runtime.aiming,
      aimAmount: this.camera.aimAmount,
      bodyYaw: this.player.state.yaw,
      bodyYawOffset: wrapAngle(this.camera.viewYaw - this.player.state.yaw),
      poseAimBlend: this.player.aimBlend,
      handGripError: this.player.handGripError(),
      poseAngles: this.player.poseAngles(),
      footHeight: this.player.footHeight(),
      footPositions: this.player.footPositions(),
      animationClip: this.player.animationClip,
      groundingOffset: this.player.groundingOffset,
      weaponForward: this.weapon.weaponForward(this.cameraWorldDirection.clone()).toArray(),
      fov: this.renderer.camera.fov,
      weaponId: this.weapon.definition.id,
      weaponState: this.weapon.runtime.state,
      magazine: this.weapon.runtime.magazine,
      reserve: this.weapon.runtime.reserve,
      ammo: formatAmmo(this.weapon.runtime),
      shotsFired: this.weapon.runtime.shotsFired,
      recoilPitch: this.weapon.recoil.pitch,
      muzzle: this.weapon.muzzleWorldPosition(this.cameraWorldPosition.clone()).toArray(),
      grip: this.weapon.gripWorldPosition(this.cameraWorldPosition.clone()).toArray(),
      muzzleFlashVisible: this.weapon.muzzleFlashVisible,
      muzzleFlashCount: this.weapon.muzzleFlashCount,
      effectCount: this.weapon.effects.activeCount,
      aimTargetId: this.weapon.currentAimTargetId,
      lastShot: { ...this.weapon.lastShotOutcome },
      hitMarkerCount: this.combatHud.markerCount,
      audioReady: this.audio.isReady,
      audioPlays: this.audio.playCount,
      targets: this.arena.targets.map((target) => ({
        id: target.damageableId,
        health: target.health,
        maxHealth: target.maxHealth,
        alive: target.isAlive,
        moving: target.isMoving,
        position: target.worldPosition,
      })),

      playerHealth: this.combatant.health,
      playerMaxHealth: this.combatant.maxHealth,
      playerAlive: this.combatant.isAlive,
      playerDeaths: this.combatant.deathCount,
      playerRespawnIn: this.combatant.timeToRespawn,
      bots: this.bots.map((bot) => ({
        id: bot.damageableId,
        state: bot.botState,
        health: bot.health,
        maxHealth: bot.maxHealth,
        alive: bot.isAlive,
        distance: bot.distance,
        lineOfSight: bot.hasLineOfSight,
        cooldown: bot.fireCooldown,
        respawnIn: bot.respawnCountdown,
        shotsFired: bot.shotCount,
        lastShotHitPlayer: bot.lastShotFired?.hitPlayer ?? false,
        position: { ...bot.position },
      })),
    };
  }

  /** Development hook: restores every training target to full health. */
  resetTargets(): void {
    this.arena.resetTargets();
  }

  /** Development hook: restores the player to full health immediately. */
  healPlayer(): void {
    this.combatant.reset();
  }

  /** Development hook: applies damage directly, without needing a bot to land it. */
  damagePlayer(amount: number): void {
    this.combatant.takeDamage(amount, {
      point: { ...this.player.position },
      normal: { x: 0, y: 1, z: 0 },
      distance: 0,
      sourceId: "DEBUG",
    });
  }

  /** Development hook: pointer lock cannot be driven from an automated test. */
  applyMouseDelta(deltaX: number, deltaY: number): void {
    this.camera.applyMouseDelta(deltaX, deltaY);
  }

  /** Development hook: places the player, e.g. to test a specific obstacle. */
  teleport(x: number, y: number, z: number): void {
    this.player.state.position.x = x;
    this.player.state.position.y = y;
    this.player.state.position.z = z;
    this.player.state.velocity.x = 0;
    this.player.state.velocity.y = 0;
    this.player.state.velocity.z = 0;
  }

  hideOverlay(): void {
    this.elements.lockOverlay.hidden = true;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("keydown", this.onDebugKey);
    this.input.dispose();
    this.weapon.dispose();
    this.audio.dispose();
    this.player.dispose();
    this.arena.dispose();
    this.renderer.dispose();
    this.physics.dispose();
  }
}
