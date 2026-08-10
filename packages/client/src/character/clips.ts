import type * as THREE from "three";

import { MovementState } from "@nullpoint/shared";

import { BoneName, type HumanoidRig } from "./rig.ts";
import { bakeClip, readBindPose, type ClipSpec, type PoseKey } from "./retarget.ts";

/**
 * Hand-authored locomotion, written once and retargeted onto whatever skeleton
 * is loaded.
 *
 * The Quaternius base character ships with no animation clips and no compatibly
 * licensed clip library is in the project (`ASSET_CREDITS.md`), so locomotion is
 * generated rather than imported. These are ordinary `THREE.AnimationClip`s
 * played through an `AnimationMixer` with cross-fades, exactly as clips from a
 * GLB would be, so `AnimationController` neither knows nor cares which source it
 * is driving — and a real clip library can replace them a state at a time.
 *
 * **Every angle below is in character space**, radians, about the character's own
 * axes: +X is the character's right, +Y up, −Z forward (`CLAUDE.md` §5).
 * `retarget.ts` converts them into each skeleton's local bone frames. One
 * consequence is worth stating because it looks like a bug otherwise: a limb
 * hangs *downward*, so swinging it forward is a **positive** rotation about X,
 * while the spine and head point *upward*, so the same positive rotation tips
 * them **backward**. A forward fold of the torso is negative.
 */

/** Clips a rig can provide. A superset of `MovementState`: crouch splits in two. */
export const LocomotionClip = {
  Idle: "IDLE",
  Walk: "WALK",
  Run: "RUN",
  Sprint: "SPRINT",
  /** Crouched and stationary — no stride, or the feet shuffle on the spot. */
  CrouchIdle: "CROUCH_IDLE",
  CrouchMove: "CROUCH_MOVE",
  Jump: "JUMP",
  Fall: "FALL",
  /** One-shot compression played on touchdown. */
  Land: "LAND",
} as const;

export type LocomotionClip = (typeof LocomotionClip)[keyof typeof LocomotionClip];

/**
 * Speed each cycle was authored for, m/s. Playback rate is real speed over this,
 * which is what stops the feet skating.
 */
export const CLIP_REFERENCE_SPEED: Partial<Record<LocomotionClip, number>> = {
  [LocomotionClip.Walk]: 2.0,
  [LocomotionClip.Run]: 5.2,
  [LocomotionClip.Sprint]: 8.0,
  [LocomotionClip.CrouchMove]: 1.7,
};

/**
 * The clip a movement state plays.
 *
 * `CROUCH` maps to the moving variant; `AnimationController` swaps in
 * {@link LocomotionClip.CrouchIdle} once the character is actually stationary,
 * because a shuffle played at zero speed is the classic sliding-feet artefact.
 */
export const CLIP_FOR_STATE: Readonly<Record<MovementState, LocomotionClip>> = {
  [MovementState.Idle]: LocomotionClip.Idle,
  [MovementState.Walk]: LocomotionClip.Walk,
  [MovementState.Run]: LocomotionClip.Run,
  [MovementState.Sprint]: LocomotionClip.Sprint,
  [MovementState.Jump]: LocomotionClip.Jump,
  [MovementState.Fall]: LocomotionClip.Fall,
  [MovementState.Crouch]: LocomotionClip.CrouchMove,
};

type Keys = readonly PoseKey[];

/**
 * Builds a symmetric two-beat gait.
 *
 * Walk, run and sprint differ only in amplitude, lean and duration, so they
 * share one generator rather than three near-identical key tables.
 */
function gait(options: {
  name: LocomotionClip;
  duration: number;
  legSwing: number;
  armSwing: number;
  kneeBend: number;
  lean: number;
  bob: number;
}): ClipSpec {
  const { duration: d, legSwing: L, armSwing: A, kneeBend: K, lean, bob } = options;

  const thighL: Keys = [[L, 0, 0], [0, 0, 0], [-L, 0, 0], [0, 0, 0], [L, 0, 0]];
  const thighR: Keys = [[-L, 0, 0], [0, 0, 0], [L, 0, 0], [0, 0, 0], [-L, 0, 0]];
  // The knee is nearly straight as the foot plants and folds through the swing.
  const shinL: Keys = [[-K * 0.1, 0, 0], [-K, 0, 0], [-K * 0.6, 0, 0], [-K * 0.45, 0, 0], [-K * 0.1, 0, 0]];
  const shinR: Keys = [[-K * 0.6, 0, 0], [-K * 0.45, 0, 0], [-K * 0.1, 0, 0], [-K, 0, 0], [-K * 0.6, 0, 0]];
  // Feet counter-rotate so they stay roughly flat instead of pointing at the sky.
  const footL: Keys = [[-L * 0.3, 0, 0], [K * 0.5, 0, 0], [L * 0.4, 0, 0], [K * 0.3, 0, 0], [-L * 0.3, 0, 0]];
  const footR: Keys = [[L * 0.4, 0, 0], [K * 0.3, 0, 0], [-L * 0.3, 0, 0], [K * 0.5, 0, 0], [L * 0.4, 0, 0]];

  // Arms swing opposite the legs on the same side. Overwritten by the weapon IK
  // whenever a weapon is held; they matter for an unarmed or lowered pose.
  const armL: Keys = [[-A, 0, -0.09], [0, 0, -0.09], [A, 0, -0.09], [0, 0, -0.09], [-A, 0, -0.09]];
  const armR: Keys = [[A, 0, 0.09], [0, 0, 0.09], [-A, 0, 0.09], [0, 0, 0.09], [A, 0, 0.09]];
  const foreL: Keys = [[-A * 0.5, 0, 0], [-A * 0.8, 0, 0], [-A * 0.35, 0, 0], [-A * 0.8, 0, 0], [-A * 0.5, 0, 0]];
  const foreR: Keys = [[-A * 0.35, 0, 0], [-A * 0.8, 0, 0], [-A * 0.5, 0, 0], [-A * 0.8, 0, 0], [-A * 0.35, 0, 0]];

  const held = (value: PoseKey): Keys => [value, value, value, value, value];

  return {
    name: options.name,
    duration: d,
    times: [0, d * 0.25, d * 0.5, d * 0.75, d],
    rotations: {
      [BoneName.ThighL]: thighL,
      [BoneName.ThighR]: thighR,
      [BoneName.ShinL]: shinL,
      [BoneName.ShinR]: shinR,
      [BoneName.FootL]: footL,
      [BoneName.FootR]: footR,
      [BoneName.ArmL]: armL,
      [BoneName.ArmR]: armR,
      [BoneName.ForearmL]: foreL,
      [BoneName.ForearmR]: foreR,
      // Negative leans the runner *into* the run.
      [BoneName.Spine]: held([-lean, 0, 0]),
      // Counter-rotated so the head stays level as the spine leans.
      [BoneName.Head]: held([lean * 0.7, 0, 0]),
    },
    // Two bobs per stride: one per footfall.
    pelvisOffsetY: [0, bob, 0, bob, 0],
  };
}

function idleSpec(): ClipSpec {
  const d = 4;
  return {
    name: LocomotionClip.Idle,
    duration: d,
    times: [0, d * 0.5, d],
    rotations: {
      [BoneName.Spine]: [[-0.02, 0, 0], [-0.045, 0, 0], [-0.02, 0, 0]],
      [BoneName.Chest]: [[0, 0.02, 0], [0, -0.02, 0], [0, 0.02, 0]],
      [BoneName.Head]: [[0, -0.05, 0], [0, 0.06, 0], [0, -0.05, 0]],
      [BoneName.ArmL]: [[0.03, 0, -0.11], [0.06, 0, -0.13], [0.03, 0, -0.11]],
      [BoneName.ArmR]: [[0.03, 0, 0.11], [0.06, 0, 0.13], [0.03, 0, 0.11]],
      [BoneName.ForearmL]: [[-0.14, 0, 0], [-0.2, 0, 0], [-0.14, 0, 0]],
      [BoneName.ForearmR]: [[-0.14, 0, 0], [-0.2, 0, 0], [-0.14, 0, 0]],
      [BoneName.ThighL]: [[0, 0, 0.02], [0, 0, 0.02], [0, 0, 0.02]],
      [BoneName.ThighR]: [[0, 0, -0.02], [0, 0, -0.02], [0, 0, -0.02]],
      [BoneName.ShinL]: [[-0.04, 0, 0], [-0.06, 0, 0], [-0.04, 0, 0]],
      [BoneName.ShinR]: [[-0.04, 0, 0], [-0.06, 0, 0], [-0.04, 0, 0]],
    },
    pelvisOffsetY: [0, -0.014, 0],
  };
}

/** Take-off and rise: knees tucked, arms driven up. */
function jumpSpec(): ClipSpec {
  const d = 0.6;
  return {
    name: LocomotionClip.Jump,
    duration: d,
    times: [0, 0.22, d],
    rotations: {
      [BoneName.ThighL]: [[0.75, 0, 0], [0.45, 0, 0], [0.2, 0, 0]],
      [BoneName.ThighR]: [[0.55, 0, 0], [0.25, 0, 0], [-0.1, 0, 0]],
      [BoneName.ShinL]: [[-1.15, 0, 0], [-0.8, 0, 0], [-0.45, 0, 0]],
      [BoneName.ShinR]: [[-0.9, 0, 0], [-0.5, 0, 0], [-0.25, 0, 0]],
      [BoneName.ArmL]: [[-1.5, 0, -0.35], [-1.15, 0, -0.4], [-0.85, 0, -0.45]],
      [BoneName.ArmR]: [[-1.5, 0, 0.35], [-1.15, 0, 0.4], [-0.85, 0, 0.45]],
      [BoneName.ForearmL]: [[-0.5, 0, 0], [-0.35, 0, 0], [-0.25, 0, 0]],
      [BoneName.ForearmR]: [[-0.5, 0, 0], [-0.35, 0, 0], [-0.25, 0, 0]],
      [BoneName.Spine]: [[-0.16, 0, 0], [-0.08, 0, 0], [-0.02, 0, 0]],
    },
    pelvisOffsetY: [-0.03, 0, 0.01],
  };
}

/** Descent: legs reaching for the ground, arms out for balance. */
function fallSpec(): ClipSpec {
  const d = 0.9;
  return {
    name: LocomotionClip.Fall,
    duration: d,
    times: [0, d * 0.5, d],
    rotations: {
      [BoneName.ThighL]: [[0.3, 0, 0.05], [0.2, 0, 0.05], [0.3, 0, 0.05]],
      [BoneName.ThighR]: [[-0.12, 0, -0.05], [-0.02, 0, -0.05], [-0.12, 0, -0.05]],
      [BoneName.ShinL]: [[-0.6, 0, 0], [-0.45, 0, 0], [-0.6, 0, 0]],
      [BoneName.ShinR]: [[-0.3, 0, 0], [-0.2, 0, 0], [-0.3, 0, 0]],
      [BoneName.ArmL]: [[-0.55, 0, -0.85], [-0.7, 0, -0.95], [-0.55, 0, -0.85]],
      [BoneName.ArmR]: [[-0.55, 0, 0.85], [-0.7, 0, 0.95], [-0.55, 0, 0.85]],
      [BoneName.ForearmL]: [[-0.5, 0, 0], [-0.6, 0, 0], [-0.5, 0, 0]],
      [BoneName.ForearmR]: [[-0.5, 0, 0], [-0.6, 0, 0], [-0.5, 0, 0]],
      [BoneName.Spine]: [[0.06, 0, 0], [0.1, 0, 0], [0.06, 0, 0]],
    },
    // Zero rather than absent: `FootGrounding` adds its correction on top of
    // whatever the mixer wrote, so every clip must write the pelvis each frame
    // or the correction accumulates instead of being replaced.
    pelvisOffsetY: [0, 0, 0],
  };
}

/** Touchdown compression, played once. Purely visual — physics is unaffected. */
function landSpec(): ClipSpec {
  const d = 0.34;
  return {
    name: LocomotionClip.Land,
    duration: d,
    times: [0, 0.1, d],
    rotations: {
      [BoneName.ThighL]: [[0.35, 0, 0.05], [0.62, 0, 0.06], [0.12, 0, 0.02]],
      [BoneName.ThighR]: [[0.35, 0, -0.05], [0.62, 0, -0.06], [0.12, 0, -0.02]],
      [BoneName.ShinL]: [[-0.55, 0, 0], [-1.0, 0, 0], [-0.2, 0, 0]],
      [BoneName.ShinR]: [[-0.55, 0, 0], [-1.0, 0, 0], [-0.2, 0, 0]],
      [BoneName.FootL]: [[0.2, 0, 0], [0.38, 0, 0], [0.08, 0, 0]],
      [BoneName.FootR]: [[0.2, 0, 0], [0.38, 0, 0], [0.08, 0, 0]],
      [BoneName.Spine]: [[-0.1, 0, 0], [-0.2, 0, 0], [-0.04, 0, 0]],
      [BoneName.Head]: [[0.07, 0, 0], [0.14, 0, 0], [0.03, 0, 0]],
    },
    pelvisOffsetY: [-0.05, -0.13, -0.01],
  };
}

/**
 * Crouch, shared by the stationary and moving variants.
 *
 * `swing` is the only difference: zero holds a still crouch, a non-zero value
 * shuffles the legs so the moving crouch reads as travel rather than sliding.
 */
function crouchSpec(name: LocomotionClip, swing: number): ClipSpec {
  const d = swing === 0 ? 3.2 : 1.6;
  const hip = 1.15;
  const held = (value: PoseKey): Keys => [value, value, value, value, value];
  const breathe = swing === 0 ? 0.012 : 0.015;

  return {
    name,
    duration: d,
    times: [0, d * 0.25, d * 0.5, d * 0.75, d],
    rotations: {
      [BoneName.ThighL]: [
        [hip + swing, 0, 0.06], [hip, 0, 0.06], [hip - swing, 0, 0.06], [hip, 0, 0.06], [hip + swing, 0, 0.06],
      ],
      [BoneName.ThighR]: [
        [hip - swing, 0, -0.06], [hip, 0, -0.06], [hip + swing, 0, -0.06], [hip, 0, -0.06], [hip - swing, 0, -0.06],
      ],
      [BoneName.ShinL]: [[-1.75, 0, 0], [-1.6, 0, 0], [-1.5, 0, 0], [-1.6, 0, 0], [-1.75, 0, 0]],
      [BoneName.ShinR]: [[-1.5, 0, 0], [-1.6, 0, 0], [-1.75, 0, 0], [-1.6, 0, 0], [-1.5, 0, 0]],
      [BoneName.FootL]: [[0.55, 0, 0], [0.5, 0, 0], [0.45, 0, 0], [0.5, 0, 0], [0.55, 0, 0]],
      [BoneName.FootR]: [[0.45, 0, 0], [0.5, 0, 0], [0.55, 0, 0], [0.5, 0, 0], [0.45, 0, 0]],
      // Negative folds the torso forward over the knees; positive arches it
      // backward, which is the inverted crouch this project has already fixed
      // once (`PROJECT_STATUS.md`, orientation correction pass).
      [BoneName.Spine]: held([-0.34, 0, 0]),
      [BoneName.Head]: held([0.28, 0, 0]),
      [BoneName.ArmL]: held([0.42, 0, -0.2]),
      [BoneName.ArmR]: held([0.42, 0, 0.2]),
      [BoneName.ForearmL]: held([-0.95, 0, 0]),
      [BoneName.ForearmR]: held([-0.95, 0, 0]),
    },
    pelvisOffsetY: [-0.39, -0.39 + breathe, -0.39, -0.39 + breathe, -0.39],
  };
}

/** Every authored clip, in the rig-neutral form `retarget.ts` consumes. */
export function locomotionSpecs(): readonly ClipSpec[] {
  return [
    idleSpec(),
    gait({ name: LocomotionClip.Walk, duration: 1.05, legSwing: 0.42, armSwing: 0.3, kneeBend: 0.62, lean: 0.05, bob: 0.018 }),
    gait({ name: LocomotionClip.Run, duration: 0.72, legSwing: 0.72, armSwing: 0.62, kneeBend: 1.1, lean: 0.15, bob: 0.03 }),
    gait({ name: LocomotionClip.Sprint, duration: 0.58, legSwing: 0.95, armSwing: 0.85, kneeBend: 1.45, lean: 0.26, bob: 0.038 }),
    jumpSpec(),
    fallSpec(),
    landSpec(),
    crouchSpec(LocomotionClip.CrouchIdle, 0),
    crouchSpec(LocomotionClip.CrouchMove, 0.3),
  ];
}

/**
 * Bakes the authored locomotion onto a rig's actual skeleton.
 *
 * Called once per character, at load, while the skeleton is still in its bind
 * pose.
 */
export function createLocomotionClips(rig: HumanoidRig): Map<LocomotionClip, THREE.AnimationClip> {
  const bind = readBindPose(rig);
  const clips = new Map<LocomotionClip, THREE.AnimationClip>();
  for (const spec of locomotionSpecs()) {
    clips.set(spec.name as LocomotionClip, bakeClip(bind, spec));
  }
  return clips;
}
