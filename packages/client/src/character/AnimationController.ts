import * as THREE from "three";

import { MovementState, clamp, createLogger } from "@nullpoint/shared";

import { CLIP_FOR_STATE, CLIP_REFERENCE_SPEED, LocomotionClip } from "./clips.ts";
import type { CharacterAsset } from "./CharacterAsset.ts";

const log = createLogger("animation");

/**
 * If a clip is missing, try these instead, in order.
 *
 * A GLB with only idle/walk/run is a normal thing to be handed, and it should
 * still play rather than produce broken references or a frozen T-pose.
 */
const FALLBACK_CHAIN: Readonly<Record<LocomotionClip, readonly LocomotionClip[]>> = {
  [LocomotionClip.Idle]: [],
  [LocomotionClip.Walk]: [LocomotionClip.Run, LocomotionClip.Idle],
  [LocomotionClip.Run]: [LocomotionClip.Walk, LocomotionClip.Idle],
  [LocomotionClip.Sprint]: [LocomotionClip.Run, LocomotionClip.Walk, LocomotionClip.Idle],
  [LocomotionClip.Jump]: [LocomotionClip.Fall, LocomotionClip.Idle],
  [LocomotionClip.Fall]: [LocomotionClip.Jump, LocomotionClip.Idle],
  [LocomotionClip.Land]: [LocomotionClip.CrouchIdle, LocomotionClip.Idle],
  [LocomotionClip.CrouchIdle]: [LocomotionClip.CrouchMove, LocomotionClip.Idle],
  [LocomotionClip.CrouchMove]: [LocomotionClip.CrouchIdle, LocomotionClip.Walk, LocomotionClip.Idle],
};

/** Played once and held on the last frame rather than looped. */
const ONE_SHOT: ReadonlySet<LocomotionClip> = new Set([LocomotionClip.Jump, LocomotionClip.Land]);

const DEFAULT_FADE = 0.18;
/** Airborne transitions are snappier; a slow fade reads as floating. */
const AIRBORNE_FADE = 0.1;
const LAND_FADE = 0.07;

const MIN_TIME_SCALE = 0.55;
const MAX_TIME_SCALE = 1.9;

/**
 * Below this ground speed a crouch is treated as stationary, m/s. Above the
 * character's crouch speed by enough that stick drift does not flicker it.
 */
const CROUCH_MOVE_THRESHOLD = 0.35;

/** How long the landing compression owns the pose before locomotion resumes, s. */
const LAND_DURATION = 0.3;

/**
 * Plays locomotion clips in response to movement state.
 *
 * Selection is driven purely by the character's actual simulated state — never
 * by timers — and playback rate follows real measured speed, so the feet do not
 * skate. **Nothing here writes simulation state or moves the character**: the
 * mixer poses bones beneath the character root, and the root itself is placed by
 * the physics step. There is no root motion.
 */
export class AnimationController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<LocomotionClip, THREE.AnimationAction>();
  private readonly resolved = new Map<LocomotionClip, LocomotionClip>();
  private current: LocomotionClip | null = null;

  private wasAirborne = false;
  private landRemaining = 0;

  constructor(asset: CharacterAsset) {
    this.mixer = new THREE.AnimationMixer(asset.root);

    for (const [clip, animation] of asset.clips) {
      const action = this.mixer.clipAction(animation);
      if (ONE_SHOT.has(clip)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip, action);
    }

    // Resolve every clip to something playable once, up front, so the per-frame
    // path never walks the fallback chain.
    for (const clip of Object.values(LocomotionClip)) {
      const target = this.resolveClip(clip);
      if (target === null) continue;
      this.resolved.set(clip, target);
      if (target !== clip) log.warn(`no ${clip} clip; falling back to ${target}`);
    }

    if (this.actions.size === 0) {
      log.warn("character has no animation clips; the pose system drives it alone");
    }
  }

  private resolveClip(clip: LocomotionClip): LocomotionClip | null {
    if (this.actions.has(clip)) return clip;
    for (const fallback of FALLBACK_CHAIN[clip]) {
      if (this.actions.has(fallback)) return fallback;
    }
    const first = this.actions.keys().next();
    return first.done === true ? null : first.value;
  }

  /** The clip currently playing. Development hook. */
  get currentClip(): LocomotionClip | null {
    return this.current;
  }

  /**
   * @param state           Current locomotion state, from the simulation.
   * @param horizontalSpeed Measured ground speed, m/s. Scales playback rate.
   * @param dt              Real frame delta, seconds.
   */
  update(state: MovementState, horizontalSpeed: number, dt: number): void {
    const wanted = this.select(state, horizontalSpeed, dt);
    const target = this.resolved.get(wanted) ?? null;

    if (target !== null && target !== this.current) {
      this.play(target, wanted);
      this.current = target;
    }

    if (target !== null) {
      const action = this.actions.get(target);
      if (action !== undefined) action.timeScale = this.timeScaleFor(target, horizontalSpeed);
    }

    this.mixer.update(dt);
  }

  /**
   * Chooses the clip for this frame, including the two cases the movement state
   * machine does not distinguish: a crouch that is not moving, and touchdown.
   */
  private select(state: MovementState, horizontalSpeed: number, dt: number): LocomotionClip {
    const airborne = state === MovementState.Jump || state === MovementState.Fall;

    if (this.wasAirborne && !airborne) this.landRemaining = LAND_DURATION;
    this.wasAirborne = airborne;

    if (this.landRemaining > 0) {
      this.landRemaining -= dt;
      // A jump or a fall out-ranks the tail of a landing, so a second jump reads
      // immediately instead of waiting for the compression to finish.
      if (!airborne) return LocomotionClip.Land;
      this.landRemaining = 0;
    }

    if (state === MovementState.Crouch) {
      return horizontalSpeed < CROUCH_MOVE_THRESHOLD ? LocomotionClip.CrouchIdle : LocomotionClip.CrouchMove;
    }

    return CLIP_FOR_STATE[state];
  }

  private timeScaleFor(clip: LocomotionClip, horizontalSpeed: number): number {
    const reference = CLIP_REFERENCE_SPEED[clip];
    if (reference === undefined || reference <= 0) return 1;
    return clamp(horizontalSpeed / reference, MIN_TIME_SCALE, MAX_TIME_SCALE);
  }

  private play(target: LocomotionClip, requested: LocomotionClip): void {
    const next = this.actions.get(target);
    if (next === undefined) return;

    const airborne = requested === LocomotionClip.Jump || requested === LocomotionClip.Fall;
    const fade = requested === LocomotionClip.Land ? LAND_FADE : airborne ? AIRBORNE_FADE : DEFAULT_FADE;

    next.enabled = true;
    next.setEffectiveWeight(1);
    if (ONE_SHOT.has(target)) next.reset();

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
