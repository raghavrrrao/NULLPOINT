import * as THREE from "three";

import { clamp, damp } from "@nullpoint/shared";

import { BoneName, type HumanoidRig } from "./rig.ts";

/**
 * Keeps the character's feet on the floor.
 *
 * Locomotion is authored as joint angles, and joint angles do not know how long
 * a particular character's legs are. The same crouch that sits correctly on the
 * placeholder pushes the Quaternius character's feet 26 mm through the ground,
 * and the same run cycle floats its planted foot 50 mm above it, purely because
 * the two rigs have different femur and shin lengths.
 *
 * Rather than retune every clip per character — which would have to be redone
 * for the next one — the lowest foot is measured each frame and the pelvis is
 * lifted or dropped to put it back where it sits in the bind pose. That is
 * measured from the asset, so it is correct for any rig.
 *
 * The correction is deliberately damped rather than exact: pinning the lowest
 * foot every frame cancels the vertical bob that gives a stride its weight. It
 * removes the average error and leaves the bob alone.
 *
 * **This does not move the character.** It offsets one bone inside the model;
 * the collider, the simulation and the camera are untouched. There is no root
 * motion here and none anywhere else.
 */

/** How fast the correction converges. Low enough to leave the stride's bob intact. */
const CORRECTION_RATE = 6;
/** How fast it eases out once airborne, where feet should hang freely. */
const RELEASE_RATE = 6;

/** Bounds on the correction, metres. A broken clip must not launch the character. */
const MAX_LIFT = 0.2;
const MAX_DROP = -0.3;

export class FootGrounding {
  private readonly rig: HumanoidRig;
  private readonly pelvis: THREE.Object3D;
  /** Character-space up, expressed in the pelvis's parent frame and in its units. */
  private readonly up = new THREE.Vector3();
  private readonly referenceHeight: number;

  private correction = 0;
  private readonly scratch = new THREE.Vector3();

  constructor(rig: HumanoidRig) {
    this.rig = rig;
    this.pelvis = rig.bones[BoneName.Hips];

    rig.root.updateWorldMatrix(true, true);
    this.referenceHeight = this.lowestFoot();

    // The pelvis's local axes are not the character's, and its units are not
    // metres — the Quaternius armature sits under a −90° X correction and a
    // uniform scale. Resolve both once.
    const parent = this.pelvis.parent;
    const parentQuaternion = new THREE.Quaternion();
    const parentScale = new THREE.Vector3(1, 1, 1);
    if (parent !== null) parent.matrixWorld.decompose(new THREE.Vector3(), parentQuaternion, parentScale);

    const rootQuaternion = new THREE.Quaternion();
    const rootScale = new THREE.Vector3(1, 1, 1);
    rig.root.matrixWorld.decompose(new THREE.Vector3(), rootQuaternion, rootScale);

    const parentToCharacter = rootQuaternion.clone().invert().multiply(parentQuaternion);
    const unitsPerMetre = parentScale.x === 0 || rootScale.x === 0 ? 1 : rootScale.x / parentScale.x;

    this.up.set(0, 1, 0).applyQuaternion(parentToCharacter.invert()).multiplyScalar(unitsPerMetre);
  }

  /** Height of the foot nearer the ground, in character space, metres. */
  private lowestFoot(): number {
    this.rig.bones[BoneName.FootL].getWorldPosition(this.scratch);
    this.rig.root.worldToLocal(this.scratch);
    const left = this.scratch.y;
    this.rig.bones[BoneName.FootR].getWorldPosition(this.scratch);
    this.rig.root.worldToLocal(this.scratch);
    return Math.min(left, this.scratch.y);
  }

  /**
   * Applies this frame's correction.
   *
   * Call after the animation mixer has posed the skeleton and before the weapon
   * pose solves the arms, so the arms are solved against the final body height.
   */
  update(grounded: boolean, dt: number): void {
    this.rig.root.updateWorldMatrix(true, true);

    if (grounded) {
      // The mixer overwrites the pelvis every frame — every clip carries a
      // pelvis track for exactly this reason — so what is measured here is the
      // *uncorrected* pose. The correction is therefore the whole error, not an
      // adjustment to the previous one; accumulating instead sends it straight
      // to the clamp.
      const wanted = clamp(this.referenceHeight - this.lowestFoot(), MAX_DROP, MAX_LIFT);
      this.correction = damp(this.correction, wanted, CORRECTION_RATE, dt);
    } else {
      this.correction = damp(this.correction, 0, RELEASE_RATE, dt);
    }

    if (this.correction !== 0) {
      this.pelvis.position.addScaledVector(this.up, this.correction);
      this.rig.root.updateWorldMatrix(true, true);
    }
  }

  /** Current correction, metres. Development hook. */
  get offset(): number {
    return this.correction;
  }
}
