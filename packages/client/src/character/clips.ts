import * as THREE from "three";

import { MovementState } from "@nullpoint/shared";

import { BoneName } from "./rig.ts";

/**
 * Hand-authored locomotion clips for the placeholder humanoid.
 *
 * These exist because no suitably licensed rigged character is available yet
 * (`ASSET_CREDITS.md`). They are ordinary `THREE.AnimationClip`s played through
 * an `AnimationMixer` with cross-fades, exactly as clips from a GLB would be, so
 * `AnimationController` does not know or care which source it is driving.
 *
 * Angles are radians about the joint's local X axis unless noted. Positive
 * swings the limb toward −Z (forward).
 */

/** Speed each locomotion clip was authored for, m/s. Drives playback rate. */
export const CLIP_REFERENCE_SPEED: Partial<Record<MovementState, number>> = {
  [MovementState.Walk]: 2.0,
  [MovementState.Run]: 5.2,
  [MovementState.Sprint]: 8.0,
  [MovementState.Crouch]: 1.7,
};

const HIP_REST_Y = 0.92;

type EulerKey = readonly [number, number, number];

function rotationTrack(bone: BoneName, times: readonly number[], keys: readonly EulerKey[]): THREE.QuaternionKeyframeTrack {
  const values = new Float32Array(times.length * 4);
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? [0, 0, 0];
    euler.set(key[0], key[1], key[2]);
    quaternion.setFromEuler(euler);
    quaternion.toArray(values, i * 4);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [...times], Array.from(values));
}

function hipHeightTrack(times: readonly number[], heights: readonly number[]): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const height of heights) values.push(0, height, 0);
  return new THREE.VectorKeyframeTrack(`${BoneName.Hips}.position`, [...times], values);
}

/**
 * Builds a symmetric two-beat locomotion cycle.
 *
 * Walk, run and sprint differ only in amplitude, lean and duration, so they
 * share one generator rather than three near-identical key tables.
 */
function locomotionClip(options: {
  name: string;
  duration: number;
  legSwing: number;
  armSwing: number;
  kneeBend: number;
  lean: number;
  bob: number;
}): THREE.AnimationClip {
  const { duration: d, legSwing: L, armSwing: A, kneeBend: K, lean, bob } = options;
  const t = [0, d * 0.25, d * 0.5, d * 0.75, d];

  const tracks: THREE.KeyframeTrack[] = [
    rotationTrack(BoneName.ThighL, t, [[L, 0, 0], [0, 0, 0], [-L, 0, 0], [0, 0, 0], [L, 0, 0]]),
    rotationTrack(BoneName.ThighR, t, [[-L, 0, 0], [0, 0, 0], [L, 0, 0], [0, 0, 0], [-L, 0, 0]]),
    // The knee is nearly straight as the foot plants and folds through the swing.
    rotationTrack(BoneName.ShinL, t, [[-K * 0.1, 0, 0], [-K, 0, 0], [-K * 0.6, 0, 0], [-K * 0.45, 0, 0], [-K * 0.1, 0, 0]]),
    rotationTrack(BoneName.ShinR, t, [[-K * 0.6, 0, 0], [-K * 0.45, 0, 0], [-K * 0.1, 0, 0], [-K, 0, 0], [-K * 0.6, 0, 0]]),
    // Feet counter-rotate so they stay roughly flat instead of pointing at the sky.
    rotationTrack(BoneName.FootL, t, [[-L * 0.3, 0, 0], [K * 0.5, 0, 0], [L * 0.4, 0, 0], [K * 0.3, 0, 0], [-L * 0.3, 0, 0]]),
    rotationTrack(BoneName.FootR, t, [[L * 0.4, 0, 0], [K * 0.3, 0, 0], [-L * 0.3, 0, 0], [K * 0.5, 0, 0], [L * 0.4, 0, 0]]),

    // Arms swing opposite the legs on the same side.
    rotationTrack(BoneName.ArmL, t, [[-A, 0, -0.09], [0, 0, -0.09], [A, 0, -0.09], [0, 0, -0.09], [-A, 0, -0.09]]),
    rotationTrack(BoneName.ArmR, t, [[A, 0, 0.09], [0, 0, 0.09], [-A, 0, 0.09], [0, 0, 0.09], [A, 0, 0.09]]),
    rotationTrack(BoneName.ForearmL, t, [[-A * 0.5, 0, 0], [-A * 0.8, 0, 0], [-A * 0.35, 0, 0], [-A * 0.8, 0, 0], [-A * 0.5, 0, 0]]),
    rotationTrack(BoneName.ForearmR, t, [[-A * 0.35, 0, 0], [-A * 0.8, 0, 0], [-A * 0.5, 0, 0], [-A * 0.8, 0, 0], [-A * 0.35, 0, 0]]),

    rotationTrack(BoneName.Spine, t, [[lean, 0, 0], [lean, 0, 0], [lean, 0, 0], [lean, 0, 0], [lean, 0, 0]]),
    // Counter-rotate the head so it stays level as the spine leans.
    rotationTrack(BoneName.Head, t, [[-lean * 0.7, 0, 0], [-lean * 0.7, 0, 0], [-lean * 0.7, 0, 0], [-lean * 0.7, 0, 0], [-lean * 0.7, 0, 0]]),
    // Two bobs per stride: one for each footfall.
    hipHeightTrack(t, [HIP_REST_Y, HIP_REST_Y + bob, HIP_REST_Y, HIP_REST_Y + bob, HIP_REST_Y]),
  ];

  return new THREE.AnimationClip(options.name, d, tracks);
}

function idleClip(): THREE.AnimationClip {
  const d = 4;
  const t = [0, d * 0.5, d];
  return new THREE.AnimationClip(MovementState.Idle, d, [
    hipHeightTrack(t, [HIP_REST_Y, HIP_REST_Y - 0.014, HIP_REST_Y]),
    rotationTrack(BoneName.Spine, t, [[0.02, 0, 0], [0.045, 0, 0], [0.02, 0, 0]]),
    rotationTrack(BoneName.Chest, t, [[0, 0.02, 0], [0, -0.02, 0], [0, 0.02, 0]]),
    rotationTrack(BoneName.Head, t, [[0, -0.05, 0], [0, 0.06, 0], [0, -0.05, 0]]),
    rotationTrack(BoneName.ArmL, t, [[0.03, 0, -0.11], [0.06, 0, -0.13], [0.03, 0, -0.11]]),
    rotationTrack(BoneName.ArmR, t, [[0.03, 0, 0.11], [0.06, 0, 0.13], [0.03, 0, 0.11]]),
    rotationTrack(BoneName.ForearmL, t, [[-0.14, 0, 0], [-0.2, 0, 0], [-0.14, 0, 0]]),
    rotationTrack(BoneName.ForearmR, t, [[-0.14, 0, 0], [-0.2, 0, 0], [-0.14, 0, 0]]),
    rotationTrack(BoneName.ThighL, t, [[0, 0, 0.02], [0, 0, 0.02], [0, 0, 0.02]]),
    rotationTrack(BoneName.ThighR, t, [[0, 0, -0.02], [0, 0, -0.02], [0, 0, -0.02]]),
    rotationTrack(BoneName.ShinL, t, [[-0.04, 0, 0], [-0.06, 0, 0], [-0.04, 0, 0]]),
    rotationTrack(BoneName.ShinR, t, [[-0.04, 0, 0], [-0.06, 0, 0], [-0.04, 0, 0]]),
  ]);
}

/** Take-off and rise: knees tucked, arms driven up. */
function jumpClip(): THREE.AnimationClip {
  const d = 0.6;
  const t = [0, 0.22, d];
  return new THREE.AnimationClip(MovementState.Jump, d, [
    rotationTrack(BoneName.ThighL, t, [[0.75, 0, 0], [0.45, 0, 0], [0.2, 0, 0]]),
    rotationTrack(BoneName.ThighR, t, [[0.55, 0, 0], [0.25, 0, 0], [-0.1, 0, 0]]),
    rotationTrack(BoneName.ShinL, t, [[-1.15, 0, 0], [-0.8, 0, 0], [-0.45, 0, 0]]),
    rotationTrack(BoneName.ShinR, t, [[-0.9, 0, 0], [-0.5, 0, 0], [-0.25, 0, 0]]),
    rotationTrack(BoneName.ArmL, t, [[-1.5, 0, -0.35], [-1.15, 0, -0.4], [-0.85, 0, -0.45]]),
    rotationTrack(BoneName.ArmR, t, [[-1.5, 0, 0.35], [-1.15, 0, 0.4], [-0.85, 0, 0.45]]),
    rotationTrack(BoneName.ForearmL, t, [[-0.5, 0, 0], [-0.35, 0, 0], [-0.25, 0, 0]]),
    rotationTrack(BoneName.ForearmR, t, [[-0.5, 0, 0], [-0.35, 0, 0], [-0.25, 0, 0]]),
    rotationTrack(BoneName.Spine, t, [[0.16, 0, 0], [0.08, 0, 0], [0.02, 0, 0]]),
    hipHeightTrack(t, [HIP_REST_Y - 0.03, HIP_REST_Y, HIP_REST_Y + 0.01]),
  ]);
}

/** Descent: legs reaching for the ground, arms out for balance. */
function fallClip(): THREE.AnimationClip {
  const d = 0.9;
  const t = [0, d * 0.5, d];
  return new THREE.AnimationClip(MovementState.Fall, d, [
    rotationTrack(BoneName.ThighL, t, [[0.3, 0, 0.05], [0.2, 0, 0.05], [0.3, 0, 0.05]]),
    rotationTrack(BoneName.ThighR, t, [[-0.12, 0, -0.05], [-0.02, 0, -0.05], [-0.12, 0, -0.05]]),
    rotationTrack(BoneName.ShinL, t, [[-0.6, 0, 0], [-0.45, 0, 0], [-0.6, 0, 0]]),
    rotationTrack(BoneName.ShinR, t, [[-0.3, 0, 0], [-0.2, 0, 0], [-0.3, 0, 0]]),
    rotationTrack(BoneName.ArmL, t, [[-0.55, 0, -0.85], [-0.7, 0, -0.95], [-0.55, 0, -0.85]]),
    rotationTrack(BoneName.ArmR, t, [[-0.55, 0, 0.85], [-0.7, 0, 0.95], [-0.55, 0, 0.85]]),
    rotationTrack(BoneName.ForearmL, t, [[-0.5, 0, 0], [-0.6, 0, 0], [-0.5, 0, 0]]),
    rotationTrack(BoneName.ForearmR, t, [[-0.5, 0, 0], [-0.6, 0, 0], [-0.5, 0, 0]]),
    rotationTrack(BoneName.Spine, t, [[-0.06, 0, 0], [-0.1, 0, 0], [-0.06, 0, 0]]),
    hipHeightTrack(t, [HIP_REST_Y, HIP_REST_Y, HIP_REST_Y]),
  ]);
}

/**
 * Crouch. One clip covers both crouched idle and crouched movement: the legs
 * carry a small shuffle that reads as walking when the playback rate scales up
 * with speed, and as breathing when it does not.
 */
function crouchClip(): THREE.AnimationClip {
  const d = 1.6;
  const t = [0, d * 0.25, d * 0.5, d * 0.75, d];
  const swing = 0.3;
  return new THREE.AnimationClip(MovementState.Crouch, d, [
    rotationTrack(BoneName.ThighL, t, [[1.15 + swing, 0, 0.06], [1.15, 0, 0.06], [1.15 - swing, 0, 0.06], [1.15, 0, 0.06], [1.15 + swing, 0, 0.06]]),
    rotationTrack(BoneName.ThighR, t, [[1.15 - swing, 0, -0.06], [1.15, 0, -0.06], [1.15 + swing, 0, -0.06], [1.15, 0, -0.06], [1.15 - swing, 0, -0.06]]),
    rotationTrack(BoneName.ShinL, t, [[-1.75, 0, 0], [-1.6, 0, 0], [-1.5, 0, 0], [-1.6, 0, 0], [-1.75, 0, 0]]),
    rotationTrack(BoneName.ShinR, t, [[-1.5, 0, 0], [-1.6, 0, 0], [-1.75, 0, 0], [-1.6, 0, 0], [-1.5, 0, 0]]),
    rotationTrack(BoneName.FootL, t, [[0.55, 0, 0], [0.5, 0, 0], [0.45, 0, 0], [0.5, 0, 0], [0.55, 0, 0]]),
    rotationTrack(BoneName.FootR, t, [[0.45, 0, 0], [0.5, 0, 0], [0.55, 0, 0], [0.5, 0, 0], [0.45, 0, 0]]),
    rotationTrack(BoneName.Spine, t, [[0.34, 0, 0], [0.34, 0, 0], [0.34, 0, 0], [0.34, 0, 0], [0.34, 0, 0]]),
    rotationTrack(BoneName.Head, t, [[-0.28, 0, 0], [-0.28, 0, 0], [-0.28, 0, 0], [-0.28, 0, 0], [-0.28, 0, 0]]),
    rotationTrack(BoneName.ArmL, t, [[0.42, 0, -0.2], [0.46, 0, -0.2], [0.42, 0, -0.2], [0.46, 0, -0.2], [0.42, 0, -0.2]]),
    rotationTrack(BoneName.ArmR, t, [[0.42, 0, 0.2], [0.46, 0, 0.2], [0.42, 0, 0.2], [0.46, 0, 0.2], [0.42, 0, 0.2]]),
    rotationTrack(BoneName.ForearmL, t, [[-0.95, 0, 0], [-0.9, 0, 0], [-0.95, 0, 0], [-0.9, 0, 0], [-0.95, 0, 0]]),
    rotationTrack(BoneName.ForearmR, t, [[-0.95, 0, 0], [-0.9, 0, 0], [-0.95, 0, 0], [-0.9, 0, 0], [-0.95, 0, 0]]),
    hipHeightTrack(t, [0.53, 0.545, 0.53, 0.545, 0.53]),
  ]);
}

/** Every locomotion clip, keyed by the movement state that plays it. */
export function createPlaceholderClips(): Map<MovementState, THREE.AnimationClip> {
  const clips = new Map<MovementState, THREE.AnimationClip>();
  clips.set(MovementState.Idle, idleClip());
  clips.set(
    MovementState.Walk,
    locomotionClip({ name: MovementState.Walk, duration: 1.05, legSwing: 0.42, armSwing: 0.3, kneeBend: 0.62, lean: 0.05, bob: 0.018 }),
  );
  clips.set(
    MovementState.Run,
    locomotionClip({ name: MovementState.Run, duration: 0.72, legSwing: 0.72, armSwing: 0.62, kneeBend: 1.1, lean: 0.15, bob: 0.03 }),
  );
  clips.set(
    MovementState.Sprint,
    locomotionClip({ name: MovementState.Sprint, duration: 0.58, legSwing: 0.95, armSwing: 0.85, kneeBend: 1.45, lean: 0.26, bob: 0.038 }),
  );
  clips.set(MovementState.Jump, jumpClip());
  clips.set(MovementState.Fall, fallClip());
  clips.set(MovementState.Crouch, crouchClip());
  return clips;
}
