import * as THREE from "three";

import { BoneName, type HumanoidRig } from "./rig.ts";

/**
 * Bakes rig-neutral pose data into `THREE.AnimationClip`s for a specific rig.
 *
 * Locomotion is authored once, in **character space** — "swing the thigh forward
 * by 0.4 rad" — and retargeted here onto whatever skeleton is loaded. Without
 * this layer a clip is welded to one skeleton's bind pose and axis conventions:
 * the placeholder's limbs hang along local −Y from identity rotations, while the
 * Quaternius skeleton's run along +Y from bind rotations that are nowhere near
 * identity. The same authored numbers drive both.
 *
 * The conversion, per bone, for a desired character-space rotation `q`:
 *
 * ```
 *   local = parentBind⁻¹ · q · parentBind · localBind
 * ```
 *
 * which is the bone's bind pose with `q` applied about the character's axes
 * rather than the bone's own. Parent rotations are taken from the **bind** pose,
 * so a child's authored swing means the same thing regardless of what its
 * parents are doing — the child still inherits its parents' animation, it simply
 * is not re-interpreted by it.
 *
 * Nothing here modifies the skeleton. It reads the bind pose once and returns
 * clips.
 */

/** A rotation in character space, radians, XYZ euler order. */
export type PoseKey = readonly [number, number, number];

export interface ClipSpec {
  readonly name: string;
  readonly duration: number;
  /** Key times, seconds. Every track shares them. */
  readonly times: readonly number[];
  /** Character-space rotations per joint, one key per entry in {@link times}. */
  readonly rotations: Partial<Record<BoneName, readonly PoseKey[]>>;
  /**
   * Pelvis height relative to its bind height, **metres**, one per key time.
   *
   * Authored as an offset rather than an absolute so it survives a change of
   * character: an asset whose hips sit at 0.95 m and one at 0.88 m both bob by
   * the same amount.
   */
  readonly pelvisOffsetY?: readonly number[];
}

/** A joint's bind pose, expressed relative to the character root. */
interface BindFrame {
  readonly name: string;
  /** Parent's bind rotation in character space, and its inverse. */
  readonly parent: THREE.Quaternion;
  readonly parentInverse: THREE.Quaternion;
  readonly local: THREE.Quaternion;
  readonly localPosition: THREE.Vector3;
  /** Bone-local units per metre of character space. */
  readonly unitsPerMetre: number;
}

export type BindPose = Readonly<Record<BoneName, BindFrame>>;

/**
 * Reads every gameplay joint's bind pose relative to the character root.
 *
 * Must be called before anything poses the skeleton, or the "bind" pose captured
 * is really whatever frame the character happened to be in.
 */
export function readBindPose(rig: HumanoidRig): BindPose {
  rig.root.updateWorldMatrix(true, true);

  const rootQuaternion = new THREE.Quaternion();
  const rootScale = new THREE.Vector3();
  rig.root.matrixWorld.decompose(new THREE.Vector3(), rootQuaternion, rootScale);
  const rootInverse = rootQuaternion.clone().invert();

  const frames = {} as Record<BoneName, BindFrame>;

  for (const slot of Object.values(BoneName)) {
    const bone = rig.bones[slot];
    const parentNode = bone.parent;

    const parentQuaternion = new THREE.Quaternion();
    const parentScale = new THREE.Vector3(1, 1, 1);
    if (parentNode !== null) {
      parentNode.matrixWorld.decompose(new THREE.Vector3(), parentQuaternion, parentScale);
    }

    // Character space, so the root's own placement in the world drops out.
    const parent = rootInverse.clone().multiply(parentQuaternion);

    // Uniform scale is assumed — every rig in this project is scaled uniformly
    // at the model root — so one axis is enough.
    const relativeScale = rootScale.x === 0 ? 1 : parentScale.x / rootScale.x;

    frames[slot] = {
      name: bone.name,
      parent,
      parentInverse: parent.clone().invert(),
      local: bone.quaternion.clone(),
      localPosition: bone.position.clone(),
      unitsPerMetre: relativeScale === 0 ? 1 : 1 / relativeScale,
    };
  }

  return frames;
}

const scratchEuler = new THREE.Euler();
const scratchCharacter = new THREE.Quaternion();
const scratchResult = new THREE.Quaternion();

/** Converts one character-space rotation into a bone-local quaternion. */
function toBoneLocal(frame: BindFrame, key: PoseKey, out: THREE.Quaternion): THREE.Quaternion {
  scratchEuler.set(key[0], key[1], key[2]);
  scratchCharacter.setFromEuler(scratchEuler);

  out.copy(frame.parentInverse);
  out.multiply(scratchCharacter);
  out.multiply(frame.parent);
  out.multiply(frame.local);
  return out;
}

function rotationTrack(frame: BindFrame, times: readonly number[], keys: readonly PoseKey[]): THREE.QuaternionKeyframeTrack {
  const values = new Float32Array(times.length * 4);
  for (let i = 0; i < times.length; i++) {
    // A track shorter than the shared time array holds its final pose rather
    // than snapping back to bind.
    const key = keys[i] ?? keys[keys.length - 1] ?? ([0, 0, 0] as PoseKey);
    toBoneLocal(frame, key, scratchResult).toArray(values, i * 4);
  }
  return new THREE.QuaternionKeyframeTrack(`${frame.name}.quaternion`, [...times], Array.from(values));
}

function pelvisTrack(frame: BindFrame, times: readonly number[], offsets: readonly number[]): THREE.VectorKeyframeTrack {
  // The pelvis's local axes are not the character's — the Quaternius armature
  // sits under a −90° X correction — so a vertical offset has to be rotated into
  // the parent's frame and converted out of metres.
  const up = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(frame.parentInverse)
    .multiplyScalar(frame.unitsPerMetre);

  const values: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const offset = offsets[i] ?? offsets[offsets.length - 1] ?? 0;
    values.push(
      frame.localPosition.x + up.x * offset,
      frame.localPosition.y + up.y * offset,
      frame.localPosition.z + up.z * offset,
    );
  }
  return new THREE.VectorKeyframeTrack(`${frame.name}.position`, [...times], values);
}

/** Bakes one authored clip onto a rig's actual bones. */
export function bakeClip(bind: BindPose, spec: ClipSpec): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const [slot, keys] of Object.entries(spec.rotations) as [BoneName, readonly PoseKey[]][]) {
    if (keys.length === 0) continue;
    tracks.push(rotationTrack(bind[slot], spec.times, keys));
  }

  if (spec.pelvisOffsetY !== undefined && spec.pelvisOffsetY.length > 0) {
    tracks.push(pelvisTrack(bind[BoneName.Hips], spec.times, spec.pelvisOffsetY));
  }

  return new THREE.AnimationClip(spec.name, spec.duration, tracks);
}
