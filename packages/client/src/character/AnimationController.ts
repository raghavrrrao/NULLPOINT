import * as THREE from "three";

import { MovementState, clamp, createLogger } from "@nullpoint/shared";

import { CLIP_REFERENCE_SPEED } from "./clips.ts";
import type { CharacterAsset } from "./CharacterAsset.ts";

const log = createLogger("animation");

/**
 * If a state has no clip, try these instead, in order.
 *
 * The Phase 1 brief requires missing animations to degrade gracefully rather
 * than produce broken references — a GLB with only idle/walk/run is a normal
 * thing to be handed, and it should still play.
 */
const FALLBACK_CHAIN: Readonly<Record<MovementState, readonly MovementState[]>> = {
  [MovementState.Idle]: [],
  [MovementState.Walk]: [MovementState.Run, MovementState.Idle],
  [MovementState.Run]: [MovementState.Walk, MovementState.Idle],
  [MovementState.Sprint]: [MovementState.Run, MovementState.Walk, MovementState.Idle],
  [MovementState.Jump]: [MovementState.Fall, MovementState.Idle],
  [MovementState.Fall]: [MovementState.Jump, MovementState.Idle],
  [MovementState.Crouch]: [MovementState.Walk, MovementState.Idle],
};

/** States played once and held on the last frame rather than looped. */
const ONE_SHOT_STATES: ReadonlySet<MovementState> = new Set([MovementState.Jump]);

const DEFAULT_FADE = 0.18;
/** Airborne transitions are snappier; a slow fade reads as floating. */
const AIRBORNE_FADE = 0.1;

const MIN_TIME_SCALE = 0.55;
const MAX_TIME_SCALE = 1.9;

/**
 * Plays locomotion clips in response to movement state.
 *
 * Transitions are driven purely by the character's actual state — never by
 * timers — and locomotion playback rate follows real horizontal speed so the
 * feet do not skate.
 */
export class AnimationController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<MovementState, THREE.AnimationAction>();
  private readonly resolved = new Map<MovementState, MovementState>();
  private current: MovementState | null = null;

  constructor(asset: CharacterAsset) {
    this.mixer = new THREE.AnimationMixer(asset.root);

    for (const [state, clip] of asset.clips) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT_STATES.has(state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }

    // Resolve each state to something playable once, up front, so the per-frame
    // path never has to walk the fallback chain.
    for (const state of Object.keys(FALLBACK_CHAIN) as MovementState[]) {
      const target = this.resolveState(state);
      if (target === null) continue;
      this.resolved.set(state, target);
      if (target !== state) {
        log.warn(`no clip for ${state}; falling back to ${target}`);
      }
    }

    if (this.actions.size === 0) {
      log.error("character has no animation clips at all; the character will not animate");
    }
  }

  private resolveState(state: MovementState): MovementState | null {
    if (this.actions.has(state)) return state;
    for (const fallback of FALLBACK_CHAIN[state]) {
      if (this.actions.has(fallback)) return fallback;
    }
    // Last resort: anything at all, so the character is never frozen in T-pose.
    const first = this.actions.keys().next();
    return first.done === true ? null : first.value;
  }

  /**
   * @param state       Current locomotion state.
   * @param horizontalSpeed Ground speed in m/s, used to scale playback rate.
   * @param dt          Frame delta in seconds (render time, not the fixed tick).
   */
  update(state: MovementState, horizontalSpeed: number, dt: number): void {
    const target = this.resolved.get(state) ?? null;

    if (target !== null && target !== this.current) {
      this.play(target, state);
      this.current = target;
    }

    if (target !== null) {
      const action = this.actions.get(target);
      if (action !== undefined) {
        action.timeScale = this.timeScaleFor(target, horizontalSpeed);
      }
    }

    this.mixer.update(dt);
  }

  private timeScaleFor(state: MovementState, horizontalSpeed: number): number {
    const reference = CLIP_REFERENCE_SPEED[state];
    if (reference === undefined || reference <= 0) return 1;
    return clamp(horizontalSpeed / reference, MIN_TIME_SCALE, MAX_TIME_SCALE);
  }

  private play(target: MovementState, requested: MovementState): void {
    const next = this.actions.get(target);
    if (next === undefined) return;

    const airborne = requested === MovementState.Jump || requested === MovementState.Fall;
    const fade = airborne ? AIRBORNE_FADE : DEFAULT_FADE;

    next.enabled = true;
    next.setEffectiveWeight(1);
    if (ONE_SHOT_STATES.has(target)) next.reset();

    if (this.current === null) {
      next.play();
      return;
    }

    const previous = this.actions.get(this.current);
    if (previous === undefined || previous === next) {
      next.play();
      return;
    }

    next.play();
    previous.crossFadeTo(next, fade, false);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.actions.clear();
  }
}
