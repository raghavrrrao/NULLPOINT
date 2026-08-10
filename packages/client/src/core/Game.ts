import {
  CAMERA_CONFIG,
  PLAYER_CONFIG,
  createLogger,
  createMoveIntent,
  vec3,
  type MoveIntent,
} from "@nullpoint/shared";

import { loadCharacterAsset, type CharacterAsset } from "../character/CharacterAsset.ts";
import { FpsMeter } from "../debug/FpsMeter.ts";
import { Player } from "../entities/Player.ts";
import { InputManager } from "../input/InputManager.ts";
import { PhysicsWorld } from "../physics/PhysicsWorld.ts";
import { Renderer } from "../render/Renderer.ts";
import { createSceneEnvironment, type SceneEnvironment } from "../render/SceneEnvironment.ts";
import { ThirdPersonCamera } from "../render/ThirdPersonCamera.ts";
import { DebugHud } from "../ui/DebugHud.ts";
import { Arena } from "../world/Arena.ts";
import { SPAWN_POSITION } from "../world/arenaLayout.ts";
import { GameLoop } from "./GameLoop.ts";

const log = createLogger("game");

export interface GameElements {
  readonly container: HTMLElement;
  readonly hud: HTMLElement;
  readonly lockOverlay: HTMLElement;
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
    this.arena = new Arena(physics);
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

    this.input = new InputManager(this.renderer.domElement);
    this.input.onPointerLockChanged(({ locked }) => {
      elements.lockOverlay.hidden = locked;
    });
    elements.lockOverlay.addEventListener("click", () => this.input.requestPointerLock());

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

    this.input.sampleIntent(this.camera.yaw, this.intent);
    this.player.fixedUpdate(this.intent, dt);
    // Refreshes the query pipeline the camera and headroom sweeps read from.
    this.physics.step();
    this.input.endTick();

    this.physicsMs = performance.now() - started;
  }

  private render(alpha: number, dt: number): void {
    this.fps.sample(dt);

    this.input.consumeMouseDelta(this.mouseDelta);
    this.camera.applyMouseDelta(this.mouseDelta.x, this.mouseDelta.y);

    this.player.render(alpha, dt);

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
    };
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
    this.player.dispose();
    this.arena.dispose();
    this.renderer.dispose();
    this.physics.dispose();
  }
}
