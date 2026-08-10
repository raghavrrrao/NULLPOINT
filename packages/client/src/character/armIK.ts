import * as THREE from "three";

/**
 * Two-bone inverse kinematics for an arm.
 *
 * The weapon's transform is decided first, and the arms are then solved onto
 * grip points on it. That is the only way to guarantee the hands actually meet
 * the rifle: posing arms by hand-authored angles and hoping the weapon lines up
 * produces exactly the "gun floating near the torso" look this replaces.
 *
 * The elbow position is constructed directly from the triangle rather than from
 * accumulated joint angles, which avoids the sign and gimbal ambiguities that
 * make angle-based solvers flip when the target crosses behind the shoulder.
 *
 * Limb segments in this rig hang along local **−Y**, so "aim a bone at a point"
 * means rotating −Y onto the direction to that point.
 */

const REST_DIRECTION = new THREE.Vector3(0, -1, 0);

/** Scratch, module-level: this runs twice a frame and must not allocate. */
const targetLocal = new THREE.Vector3();
const poleLocal = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const alongAxis = new THREE.Vector3();
const poleComponent = new THREE.Vector3();
const elbowLocal = new THREE.Vector3();
const upperDirection = new THREE.Vector3();
const lowerDirection = new THREE.Vector3();
const inverseUpper = new THREE.Quaternion();
const scratchQuaternion = new THREE.Quaternion();

export interface ArmChain {
  /** Shoulder joint. Its rotation is set in its parent's space. */
  readonly upper: THREE.Object3D;
  /** Elbow joint, a child of `upper`. */
  readonly lower: THREE.Object3D;
  /** Optional hand, a child of `lower`, oriented to the grip when supplied. */
  readonly hand?: THREE.Object3D | undefined;
  readonly upperLength: number;
  readonly lowerLength: number;
}

/**
 * Points `chain` so its hand lands on `targetWorld`.
 *
 * @param poleWorld A world-space point the elbow should bend toward. For a rifle
 *                  stance this is below and outside the shoulder, which is what
 *                  keeps the elbows down instead of splayed like a chicken.
 * @param handWorldQuaternion Optional orientation for the hand, usually the
 *                  weapon's, so the hand does not sit on the grip at a
 *                  nonsensical angle.
 */
export function solveArmIK(
  chain: ArmChain,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  handWorldQuaternion?: THREE.Quaternion,
): void {
  const parent = chain.upper.parent;
  if (parent === null) return;

  parent.updateWorldMatrix(true, false);

  // Everything is solved in the shoulder's parent space, where the shoulder is
  // simply at `upper.position` and no world transforms confuse the geometry.
  targetLocal.copy(targetWorld);
  parent.worldToLocal(targetLocal);
  poleLocal.copy(poleWorld);
  parent.worldToLocal(poleLocal);

  toTarget.copy(targetLocal).sub(chain.upper.position);

  const upperLength = chain.upperLength;
  const lowerLength = chain.lowerLength;
  const maxReach = (upperLength + lowerLength) * 0.999;
  const minReach = Math.abs(upperLength - lowerLength) * 1.001 + 1e-4;

  let distance = toTarget.length();
  if (distance < 1e-5) {
    // Degenerate: the target is on the shoulder. Leave the arm as it is rather
    // than dividing by zero.
    return;
  }
  // Clamped rather than left unreachable: an over-extended arm should stretch
  // toward the target, not snap to some fallback pose.
  distance = THREE.MathUtils.clamp(distance, minReach, maxReach);
  alongAxis.copy(toTarget).normalize();

  // Distance from the shoulder to the elbow's projection on the shoulder→target
  // line, from the standard two-triangle construction.
  const projection =
    (upperLength * upperLength - lowerLength * lowerLength + distance * distance) /
    (2 * distance);
  const heightSquared = upperLength * upperLength - projection * projection;
  const height = heightSquared > 0 ? Math.sqrt(heightSquared) : 0;

  // The elbow is displaced off that line toward the pole.
  poleComponent.copy(poleLocal).sub(chain.upper.position);
  poleComponent.addScaledVector(alongAxis, -poleComponent.dot(alongAxis));
  if (poleComponent.lengthSq() < 1e-8) {
    // Pole is parallel to the limb; pick any perpendicular so the bend plane is
    // still defined.
    poleComponent.set(alongAxis.y, -alongAxis.x, 0);
    if (poleComponent.lengthSq() < 1e-8) poleComponent.set(0, 0, 1);
  }
  poleComponent.normalize();

  elbowLocal
    .copy(chain.upper.position)
    .addScaledVector(alongAxis, projection)
    .addScaledVector(poleComponent, height);

  upperDirection.copy(elbowLocal).sub(chain.upper.position).normalize();
  chain.upper.quaternion.setFromUnitVectors(REST_DIRECTION, upperDirection);

  // The forearm is aimed in the upper arm's space, so its rotation is relative
  // to whatever the shoulder just did.
  lowerDirection.copy(targetLocal).sub(elbowLocal).normalize();
  inverseUpper.copy(chain.upper.quaternion).invert();
  lowerDirection.applyQuaternion(inverseUpper);
  chain.lower.quaternion.setFromUnitVectors(REST_DIRECTION, lowerDirection);

  if (chain.hand !== undefined && handWorldQuaternion !== undefined) {
    chain.lower.updateWorldMatrix(true, false);
    chain.lower.getWorldQuaternion(scratchQuaternion);
    chain.hand.quaternion.copy(scratchQuaternion.invert().multiply(handWorldQuaternion));
  }
}
