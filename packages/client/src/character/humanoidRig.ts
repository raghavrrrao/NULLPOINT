import * as THREE from "three";

import { PLAYER_CONFIG, createLogger } from "@nullpoint/shared";

import { AttachmentPoint, BoneName, type ArmMetrics, type HumanoidRig } from "./rig.ts";

const log = createLogger("humanoid-rig");

/**
 * Adapts a rigged glTF skeleton to NULLPOINT's semantic rig.
 *
 * Gameplay code addresses bones by role — chest, right hand, weapon socket — and
 * never by the name a particular artist happened to use. This module is the only
 * place a real skeleton's bone names appear, so swapping in a different character
 * means adding a bone map here and nothing else.
 *
 * The source asset is never modified: no bones are renamed and no nodes are
 * removed. Everything is resolved by lookup.
 */

/** Semantic humanoid joints, the vocabulary the rest of the game uses. */
export const HumanoidBone = {
  Root: "root",
  Pelvis: "pelvis",
  Spine: "spine",
  Chest: "chest",
  Neck: "neck",
  Head: "head",
  LeftUpperArm: "leftUpperArm",
  LeftForearm: "leftForearm",
  LeftHand: "leftHand",
  RightUpperArm: "rightUpperArm",
  RightForearm: "rightForearm",
  RightHand: "rightHand",
  LeftThigh: "leftThigh",
  LeftShin: "leftShin",
  LeftFoot: "leftFoot",
  RightThigh: "rightThigh",
  RightShin: "rightShin",
  RightFoot: "rightFoot",
} as const;

export type HumanoidBone = (typeof HumanoidBone)[keyof typeof HumanoidBone];

/** Bone names in the source skeleton, keyed by the role each one plays. */
export type HumanoidBoneMap = Readonly<Record<HumanoidBone, string>>;

/**
 * Quaternius "Universal Base Characters" skeleton.
 *
 * An Unreal-style naming scheme. `spine_03` is the upper chest and is what the
 * weapon and aim pose hang from; `spine_01` is the lower spine, which the
 * locomotion lean uses.
 */
export const QUATERNIUS_BONE_MAP: HumanoidBoneMap = {
  root: "root",
  pelvis: "pelvis",
  spine: "spine_01",
  chest: "spine_03",
  neck: "neck_01",
  head: "Head",
  leftUpperArm: "upperarm_l",
  leftForearm: "lowerarm_l",
  leftHand: "hand_l",
  rightUpperArm: "upperarm_r",
  rightForearm: "lowerarm_r",
  rightHand: "hand_r",
  leftThigh: "thigh_l",
  leftShin: "calf_l",
  leftFoot: "foot_l",
  rightThigh: "thigh_r",
  rightShin: "calf_r",
  rightFoot: "foot_r",
};

/** How the semantic joints map onto the gameplay rig's bone slots. */
const GAMEPLAY_SLOTS: Readonly<Record<BoneName, HumanoidBone>> = {
  [BoneName.Hips]: HumanoidBone.Pelvis,
  [BoneName.Spine]: HumanoidBone.Spine,
  [BoneName.Chest]: HumanoidBone.Chest,
  [BoneName.Head]: HumanoidBone.Head,
  [BoneName.ArmL]: HumanoidBone.LeftUpperArm,
  [BoneName.ForearmL]: HumanoidBone.LeftForearm,
  [BoneName.HandL]: HumanoidBone.LeftHand,
  [BoneName.ArmR]: HumanoidBone.RightUpperArm,
  [BoneName.ForearmR]: HumanoidBone.RightForearm,
  [BoneName.HandR]: HumanoidBone.RightHand,
  [BoneName.ThighL]: HumanoidBone.LeftThigh,
  [BoneName.ShinL]: HumanoidBone.LeftShin,
  [BoneName.FootL]: HumanoidBone.LeftFoot,
  [BoneName.ThighR]: HumanoidBone.RightThigh,
  [BoneName.ShinR]: HumanoidBone.RightShin,
  [BoneName.FootR]: HumanoidBone.RightFoot,
};

export interface HumanoidRigOptions {
  /**
   * Yaw applied to the model so its forward axis meets NULLPOINT's.
   *
   * The glTF specification puts an asset's front on **+Z**; this project uses
   * **−Z** throughout (`CLAUDE.md` §5), so a spec-conforming asset needs half a
   * turn. Applied once at the model root — never to individual bones, which
   * would corrupt the skeleton's bind pose.
   */
  readonly forwardCorrectionYaw: number;
  /** Direction a limb bone points at rest, in its own local space. */
  readonly restDirection: THREE.Vector3;
  /** Height the character is normalised to, metres. */
  readonly targetHeight?: number;
}

export interface HumanoidRigResult {
  readonly rig: HumanoidRig;
  /** Bone roles the skeleton did not provide. Empty when fully mapped. */
  readonly missing: readonly HumanoidBone[];
  readonly appliedScale: number;
  /** Height of the model before normalisation, metres. */
  readonly sourceHeight: number;
  /** Vertical shift applied so the lowest vertex sits on the origin plane. */
  readonly groundOffset: number;
}

/**
 * Builds a gameplay rig from a loaded glTF scene.
 *
 * Returns `null` when a required bone is missing rather than substituting a
 * plausible-looking neighbour: a silently mis-mapped shoulder produces a
 * character that is subtly wrong everywhere and very hard to diagnose.
 */
export function buildHumanoidRig(
  gltfScene: THREE.Object3D,
  boneMap: HumanoidBoneMap,
  options: HumanoidRigOptions,
): HumanoidRigResult | null {
  const found = new Map<HumanoidBone, THREE.Object3D>();
  const missing: HumanoidBone[] = [];

  for (const role of Object.values(HumanoidBone)) {
    const sourceName = boneMap[role];
    const bone = gltfScene.getObjectByName(sourceName);
    if (bone === undefined) missing.push(role);
    else found.set(role, bone);
  }

  // Only the joints gameplay actually drives are fatal. `root` and `neck` are
  // mapped for completeness and future animation retargeting.
  const requiredSlots = Object.values(GAMEPLAY_SLOTS);
  const fatal = missing.filter((role) => requiredSlots.includes(role));
  if (fatal.length > 0) {
    log.error(`skeleton is missing required joints: ${fatal.join(", ")}`);
    return null;
  }
  if (missing.length > 0) {
    log.warn(`skeleton has no ${missing.join(", ")}; not used by gameplay`);
  }

  // Character space: forward −Z, no rotation. Everything gameplay positions —
  // the player object, the camera pivot — works in this frame.
  const root = new THREE.Group();
  root.name = "character-root";

  // Model space: carries the forward correction and the scale, so the skeleton
  // below is left exactly as authored.
  const modelRoot = new THREE.Group();
  modelRoot.name = "character-model";
  modelRoot.rotation.y = options.forwardCorrectionYaw;
  modelRoot.add(gltfScene);
  root.add(modelRoot);

  const targetHeight = options.targetHeight ?? PLAYER_CONFIG.standHeight;
  const box = new THREE.Box3();
  modelRoot.updateWorldMatrix(true, true);
  box.setFromObject(modelRoot);
  const sourceHeight = box.max.y - box.min.y;

  let appliedScale = 1;
  if (Number.isFinite(sourceHeight) && sourceHeight > 1e-4) {
    appliedScale = targetHeight / sourceHeight;
    modelRoot.scale.setScalar(appliedScale);
  }

  // Sit the lowest vertex exactly on the origin plane. The gameplay character's
  // position is its feet, so an asset modelled a few millimetres below zero
  // would otherwise sink into the floor.
  modelRoot.updateWorldMatrix(true, true);
  box.setFromObject(modelRoot);
  const groundOffset = -box.min.y;
  modelRoot.position.y = groundOffset;

  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const [slot, role] of Object.entries(GAMEPLAY_SLOTS) as [BoneName, HumanoidBone][]) {
    const bone = found.get(role);
    if (bone === undefined) return null;
    bones[slot] = bone;
  }

  // The socket's frame cancels the model's forward correction, so weapon stance
  // offsets stay written in character space regardless of how the asset was
  // authored.
  const socketFrame = new THREE.Object3D();
  socketFrame.name = "weapon-socket-frame";
  socketFrame.rotation.y = -options.forwardCorrectionYaw;
  bones[BoneName.Chest].add(socketFrame);

  const weaponSocket = new THREE.Object3D();
  weaponSocket.name = "weapon-socket";
  socketFrame.add(weaponSocket);

  const armMetrics = measureArm(bones[BoneName.ForearmR], bones[BoneName.HandR]);

  const attachments: Readonly<Record<AttachmentPoint, THREE.Object3D>> = {
    [AttachmentPoint.RightHand]: bones[BoneName.HandR],
    [AttachmentPoint.LeftHand]: bones[BoneName.HandL],
    [AttachmentPoint.WeaponSocket]: weaponSocket,
    [AttachmentPoint.Head]: bones[BoneName.Head],
  };

  const rig: HumanoidRig = {
    root,
    bones,
    weaponSocket,
    attachment: (point) => attachments[point],
    armMetrics,
    restDirection: options.restDirection.clone().normalize(),
    dispose(): void {
      gltfScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  };

  log.info(
    `mapped ${Object.keys(bones).length} gameplay joints; height ${sourceHeight.toFixed(3)} m ` +
      `→ ${targetHeight.toFixed(2)} m (×${appliedScale.toFixed(4)}), ground offset ${groundOffset.toFixed(4)} m`,
  );

  return { rig, missing, appliedScale, sourceHeight, groundOffset };
}

/**
 * Measures arm segment lengths from the skeleton's own bind pose.
 *
 * Read from the asset rather than configured, so a different character with
 * different proportions needs no retuning of the IK.
 */
function measureArm(lower: THREE.Object3D, hand: THREE.Object3D): ArmMetrics {
  // Each child's local translation is the length of the bone above it.
  return {
    upperLength: lower.position.length(),
    lowerLength: hand.position.length(),
  };
}
