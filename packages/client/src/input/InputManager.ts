import { createLogger, createMoveIntent, type MoveIntent } from "@nullpoint/shared";

const log = createLogger("input");

/** Logical actions, kept separate from the physical keys bound to them. */
export const InputAction = {
  MoveForward: "MoveForward",
  MoveBack: "MoveBack",
  MoveLeft: "MoveLeft",
  MoveRight: "MoveRight",
  Sprint: "Sprint",
  Walk: "Walk",
  Jump: "Jump",
  Crouch: "Crouch",
  Fire: "Fire",
  Aim: "Aim",
  Reload: "Reload",
} as const;

export type InputAction = (typeof InputAction)[keyof typeof InputAction];

/**
 * Default bindings, keyed by `KeyboardEvent.code` so they are layout-independent
 * — `KeyW` is the same physical key on AZERTY.
 *
 * Bindings are data so that Phase 9's rebinding UI has something to edit; the UI
 * itself is out of Phase 1 scope.
 */
export const DEFAULT_BINDINGS: Readonly<Record<string, InputAction>> = {
  KeyW: InputAction.MoveForward,
  ArrowUp: InputAction.MoveForward,
  KeyS: InputAction.MoveBack,
  ArrowDown: InputAction.MoveBack,
  KeyA: InputAction.MoveLeft,
  ArrowLeft: InputAction.MoveLeft,
  KeyD: InputAction.MoveRight,
  ArrowRight: InputAction.MoveRight,
  ShiftLeft: InputAction.Sprint,
  ShiftRight: InputAction.Sprint,
  AltLeft: InputAction.Walk,
  AltRight: InputAction.Walk,
  Space: InputAction.Jump,
  ControlLeft: InputAction.Crouch,
  ControlRight: InputAction.Crouch,
  KeyC: InputAction.Crouch,
  KeyR: InputAction.Reload,
};

/**
 * Mouse buttons, by `MouseEvent.button`.
 *
 * Bound through the same action table as the keyboard so gameplay code never
 * asks "was it a mouse button or a key" — it asks whether an action is held.
 */
export const DEFAULT_MOUSE_BINDINGS: Readonly<Record<number, InputAction>> = {
  0: InputAction.Fire,
  2: InputAction.Aim,
};

export interface PointerLockState {
  readonly locked: boolean;
}

/**
 * The single place the browser's keyboard and mouse are read.
 *
 * Gameplay systems ask this for a `MoveIntent` and a mouse delta; none of them
 * touch `KeyboardEvent` directly. That indirection is what will let a gamepad or
 * a replayed input stream drive the character later without changes elsewhere
 * (Phase 1 brief §16) — no gamepad support is implemented now.
 */
export class InputManager {
  private readonly element: HTMLElement;
  private readonly bindings: Record<string, InputAction>;
  private readonly mouseBindings: Record<number, InputAction> = { ...DEFAULT_MOUSE_BINDINGS };
  private readonly held = new Set<InputAction>();
  /** Actions pressed since the last consume — survives a sub-tick tap. */
  private readonly pressed = new Set<InputAction>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private locked = false;
  private lockChangeHandlers: Array<(state: PointerLockState) => void> = [];

  constructor(element: HTMLElement, bindings: Record<string, InputAction> = { ...DEFAULT_BINDINGS }) {
    this.element = element;
    this.bindings = bindings;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    element.addEventListener("mousemove", this.onMouseMove);
    element.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    // Right-click is the aim button; without this the browser context menu
    // opens over the game on every aim.
    element.addEventListener("contextmenu", this.onContextMenu);
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  onPointerLockChanged(handler: (state: PointerLockState) => void): void {
    this.lockChangeHandlers.push(handler);
  }

  requestPointerLock(): void {
    if (this.locked) return;
    // Chromium returns a promise here and rejects if the gesture is stale;
    // an unhandled rejection would show up as a console error.
    const result = this.element.requestPointerLock() as unknown;
    if (result instanceof Promise) {
      result.catch((error: unknown) => log.warn("pointer lock request rejected", error));
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement !== null) document.exitPointerLock();
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    // The first click is spent capturing the pointer, not firing.
    if (!this.locked) {
      this.requestPointerLock();
      return;
    }
    const action = this.mouseBindings[event.button];
    if (action === undefined) return;
    event.preventDefault();
    this.held.add(action);
    this.pressed.add(action);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    const action = this.mouseBindings[event.button];
    if (action === undefined) return;
    this.held.delete(action);
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      // Dropping lock (Esc, alt-tab) must not leave keys stuck down.
      this.held.clear();
      this.pressed.clear();
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
    }
    for (const handler of this.lockChangeHandlers) handler({ locked: this.locked });
  };

  private readonly onPointerLockError = (): void => {
    log.warn("pointer lock error");
    this.locked = false;
    for (const handler of this.lockChangeHandlers) handler({ locked: false });
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = this.bindings[event.code];
    if (action === undefined) return;
    // Space and the arrows scroll the page; Ctrl combinations open browser UI.
    event.preventDefault();
    if (event.repeat) return;
    this.held.add(action);
    this.pressed.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = this.bindings[event.code];
    if (action === undefined) return;
    event.preventDefault();
    this.held.delete(action);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.pressed.clear();
  };

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  /**
   * Fills `out` with this tick's intent.
   *
   * `jump` is edge-triggered: it reports true once per physical press, so
   * holding the key does not produce a jump every tick.
   */
  sampleIntent(cameraYaw: number, out: MoveIntent = createMoveIntent()): MoveIntent {
    const forward = (this.isHeld(InputAction.MoveForward) ? 1 : 0) - (this.isHeld(InputAction.MoveBack) ? 1 : 0);
    const right = (this.isHeld(InputAction.MoveRight) ? 1 : 0) - (this.isHeld(InputAction.MoveLeft) ? 1 : 0);

    out.forward = forward;
    out.right = right;
    out.cameraYaw = cameraYaw;
    out.sprint = this.isHeld(InputAction.Sprint);
    out.walk = this.isHeld(InputAction.Walk);
    out.crouch = this.isHeld(InputAction.Crouch);
    out.aim = this.isHeld(InputAction.Aim);
    out.jump = this.pressed.has(InputAction.Jump);
    return out;
  }

  /** True only on the tick the action went down. */
  wasPressed(action: InputAction): boolean {
    return this.pressed.has(action);
  }

  /** Clears edge-triggered state. Called once per simulation tick, after sampling. */
  endTick(): void {
    this.pressed.clear();
  }

  /** Returns and clears the accumulated mouse movement, in pixels. */
  consumeMouseDelta(out: { x: number; y: number }): { x: number; y: number } {
    out.x = this.mouseDeltaX;
    out.y = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return out;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    this.element.removeEventListener("mousemove", this.onMouseMove);
    this.element.removeEventListener("mousedown", this.onMouseDown);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.lockChangeHandlers = [];
  }
}
