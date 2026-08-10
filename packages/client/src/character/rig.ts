import * as THREE from "three";

/**
 * Bone names for the placeholder humanoid.
 *
 * Deliberately Mixamo-ish in structure (hips → spine → chest → head, two arms,
 * two legs) so that the animation state machine written against these names does
 * not have to change when a real rigged GLB replaces the placeholder — only the
 * name mapping in the loader does.
 */
export const BoneName = {
  Hips: "Hips",
  Spine: "Spine",
  Chest: "Chest",
  Head: "Head",
  ArmL: "ArmL",
  ForearmL: "ForearmL",
  ArmR: "ArmR",
  ForearmR: "ForearmR",
  HandL: "HandL",
  HandR: "HandR",
  ThighL: "ThighL",
  ShinL: "ShinL",
  FootL: "FootL",
  ThighR: "ThighR",
  ShinR: "ShinR",
  FootR: "FootR",
} as const;

export type BoneName = (typeof BoneName)[keyof typeof BoneName];

/**
 * Rest-pose joint offsets, in metres, relative to the parent joint.
 *
 * Limb segments hang along local −Y, so a positive rotation about X swings the
 * limb toward −Z, which is the model's forward axis (`CLAUDE.md` §5). That makes
 * every animation track in `clips.ts` readable as "swing forward by N radians".
 */
const JOINTS: Readonly<Record<BoneName, { parent: BoneName | null; offset: [number, number, number] }>> = {
  Hips: { parent: null, offset: [0, 0.92, 0] },
  Spine: { parent: "Hips", offset: [0, 0.12, 0] },
  Chest: { parent: "Spine", offset: [0, 0.2, 0] },
  Head: { parent: "Chest", offset: [0, 0.28, 0] },

  ArmL: { parent: "Chest", offset: [0.2, 0.14, 0] },
  ForearmL: { parent: "ArmL", offset: [0, -0.28, 0] },
  ArmR: { parent: "Chest", offset: [-0.2, 0.14, 0] },
  ForearmR: { parent: "ArmR", offset: [0, -0.28, 0] },
  // Hands exist as explicit joints so a weapon has something to attach to that
  // is not the forearm mesh. A real rigged GLB will provide equivalents.
  HandL: { parent: "ForearmL", offset: [0, -0.26, 0] },
  HandR: { parent: "ForearmR", offset: [0, -0.26, 0] },

  ThighL: { parent: "Hips", offset: [0.11, -0.06, 0] },
  ShinL: { parent: "ThighL", offset: [0, -0.44, 0] },
  FootL: { parent: "ShinL", offset: [0, -0.33, 0] },
  ThighR: { parent: "Hips", offset: [-0.11, -0.06, 0] },
  ShinR: { parent: "ThighR", offset: [0, -0.44, 0] },
  FootR: { parent: "ShinR", offset: [0, -0.33, 0] },
};

/** Box drawn for each joint: full size, then centre offset from the joint. */
const LIMB_MESHES: Readonly<
  Partial<Record<BoneName, { size: [number, number, number]; centre: [number, number, number]; accent?: boolean }>>
> = {
  Hips: { size: [0.32, 0.2, 0.21], centre: [0, 0, 0] },
  Chest: { size: [0.38, 0.34, 0.23], centre: [0, 0.1, 0] },
  Head: { size: [0.21, 0.23, 0.22], centre: [0, 0.1, 0] },
  ArmL: { size: [0.11, 0.28, 0.11], centre: [0, -0.14, 0], accent: true },
  ForearmL: { size: [0.095, 0.26, 0.095], centre: [0, -0.13, 0] },
  ArmR: { size: [0.11, 0.28, 0.11], centre: [0, -0.14, 0], accent: true },
  ForearmR: { size: [0.095, 0.26, 0.095], centre: [0, -0.13, 0] },
  HandL: { size: [0.085, 0.1, 0.09], centre: [0, -0.05, 0], accent: true },
  HandR: { size: [0.085, 0.1, 0.09], centre: [0, -0.05, 0], accent: true },
  ThighL: { size: [0.145, 0.44, 0.15], centre: [0, -0.22, 0] },
  ShinL: { size: [0.125, 0.33, 0.13], centre: [0, -0.165, 0], accent: true },
  FootL: { size: [0.13, 0.09, 0.26], centre: [0, -0.045, -0.05] },
  ThighR: { size: [0.145, 0.44, 0.15], centre: [0, -0.22, 0] },
  ShinR: { size: [0.125, 0.33, 0.13], centre: [0, -0.165, 0], accent: true },
  FootR: { size: [0.13, 0.09, 0.26], centre: [0, -0.045, -0.05] },
};

export interface HumanoidRig {
  /** Character origin, at the feet. Position and yaw are applied to this. */
  readonly root: THREE.Group;
  readonly bones: Readonly<Record<BoneName, THREE.Object3D>>;
  /**
   * Where a weapon attaches.
   *
   * Parented to the chest rather than the hand on purpose. Hanging it off the
   * hand makes the weapon inherit the whole arm chain's rotation, so it points
   * wherever the forearm happens to point and has to be counter-rotated by a
   * transform that changes every time an arm angle is touched. Mounting on the
   * chest — which is the bone that already follows the aim direction — keeps the
   * barrel pointing where the character aims, and the arms are posed to meet it.
   */
  readonly weaponMount: THREE.Object3D;
  dispose(): void;
}

/**
 * Builds the placeholder humanoid.
 *
 * The amber accents and the visible nose wedge are intentional: the accents mark
 * this as placeholder art at a glance, and the nose makes the character's facing
 * readable from behind, which is otherwise nearly impossible to judge on a
 * symmetrical grey figure in third person.
 */
export function createHumanoidRig(): HumanoidRig {
  const root = new THREE.Group();
  root.name = "character-root";

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x5c6f82, roughness: 0.75, metalness: 0.05 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.6, metalness: 0.1 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0x8fa2b5, roughness: 0.7, metalness: 0.05 });
  const materials = [bodyMaterial, accentMaterial, headMaterial];
  const geometries: THREE.BoxGeometry[] = [];

  const bones = {} as Record<BoneName, THREE.Object3D>;

  for (const name of Object.keys(JOINTS) as BoneName[]) {
    const bone = new THREE.Object3D();
    bone.name = name;
    const joint = JOINTS[name];
    bone.position.set(joint.offset[0], joint.offset[1], joint.offset[2]);
    bones[name] = bone;
  }

  for (const name of Object.keys(JOINTS) as BoneName[]) {
    const parent = JOINTS[name].parent;
    if (parent === null) root.add(bones[name]);
    else bones[parent].add(bones[name]);
  }

  for (const name of Object.keys(LIMB_MESHES) as BoneName[]) {
    const spec = LIMB_MESHES[name];
    if (spec === undefined) continue;

    const geometry = new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    geometries.push(geometry);
    const material = name === "Head" ? headMaterial : spec.accent === true ? accentMaterial : bodyMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(spec.centre[0], spec.centre[1], spec.centre[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bones[name].add(mesh);
  }

  const weaponMount = new THREE.Object3D();
  weaponMount.name = "weapon-mount";
  bones.Chest.add(weaponMount);

  // Facing marker on the head, pointing along −Z.
  const noseGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.09);
  geometries.push(noseGeometry);
  const nose = new THREE.Mesh(noseGeometry, accentMaterial);
  nose.position.set(0, 0.1, -0.14);
  nose.castShadow = true;
  bones.Head.add(nose);

  return {
    root,
    bones,
    weaponMount,
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

/**
 * Uniformly scales an object so its bounding box is `targetHeight` tall.
 *
 * Applied to the placeholder and to any GLB that replaces it, so the visible
 * character always matches the collider height rather than depending on whatever
 * scale the source asset happened to be authored at.
 */
export function normalizeToHeight(object: THREE.Object3D, targetHeight: number): number {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 1e-4) return 1;

  const scale = targetHeight / height;
  object.scale.multiplyScalar(scale);
  return scale;
}
