import * as THREE from "three";

import { clamp, damp, wrapAngle } from "@nullpoint/shared";

import { solveArmIK, type ArmChain } from "./armIK.ts";
import { BoneName, type HumanoidRig } from "./rig.ts";

/**
 * Upper-body combat pose: torso aim, weapon placement, two-handed grip.
 *
 * Applied **after** the `AnimationMixer` has written the locomotion pose, so it
 * overrides only the bones it touches and leaves hips and legs entirely to the
 * locomotion clips. Lower body walks, upper body aims — without a second
 * animation system.
 *
 * The order of operations is the whole design:
 *
 * ```
 *   aim direction  →  weapon transform  →  grip points  →  arm IK  →  hands
 * ```
 *
 * The weapon is placed first, from the aim direction, and the arms are solved
 * onto grip points on it. Posing the arms first and hoping the weapon lands
 * between them is what produced a rifle lying diagonally across the chest.
 */

export interface WeaponGrips {
  /** Trigger-hand target on the weapon. */
  readonly right: THREE.Object3D;
  /** Support-hand target on the weapon. */
  readonly left: THREE.Object3D;
}

/** Everything the pose needs to know about the player this frame. */
export interface PoseInput {
  readonly aiming: boolean;
  /** True while sprinting — the weapon drops out of the ready position. */
  readonly sprinting: boolean;
  /** World-space aim yaw, radians. */
  readonly aimYaw: number;
  /** World-space aim pitch, radians. Positive looks down. */
  readonly aimPitch: number;
  /** The character's own facing, radians. */
  readonly bodyYaw: number;
  /** Accumulated recoil pitch, radians. */
  readonly recoilPitch: number;
  /** 0 = standing, 1 = fully crouched. */
  readonly crouchBlend: number;
}

/** A weapon stance: where the weapon sits relative to the shoulder. */
interface Stance {
  /** Socket offset from the chest, metres. */
  readonly offset: readonly [number, number, number];
  /** Extra pitch on the weapon beyond the aim pitch, radians. */
  readonly pitchBias: number;
  /** Extra yaw on the weapon beyond the aim yaw, radians. */
  readonly yawBias: number;
  /** How much of the aim pitch the weapon takes, 0..1. */
  readonly pitchFollow: number;
  /** How much of the aim yaw offset the torso twists to cover, 0..1. */
  readonly torsoFollow: number;
}

/**
 * Hip fire: weapon at the ready but below the sight line, angled slightly
 * outboard so it never covers the centre of the screen.
 */
const HIP: Stance = {
  offset: [0.08, 0.03, -0.17],
  pitchBias: 0.2,
  yawBias: -0.09,
  pitchFollow: 0.55,
  torsoFollow: 0.55,
};

/** Shouldered: stock in to the shoulder, barrel on the aim line. */
const AIM: Stance = {
  // Close to the centreline on purpose: held out on the right shoulder the
  // support grip drifts beyond the left arm's reach and the hand comes off it.
  offset: [0.04, 0.12, -0.20],
  pitchBias: 0,
  yawBias: 0,
  pitchFollow: 1,
  torsoFollow: 0.9,
};

/** Sprinting: weapon dropped across the body, out of the way. */
const SPRINT: Stance = {
  offset: [0.05, -0.05, -0.15],
  pitchBias: 0.45,
  yawBias: -0.3,
  pitchFollow: 0.15,
  torsoFollow: 0.25,
};

/** Widest the torso may twist away from the character's facing, radians. */
const MAX_TORSO_TWIST = (55 * Math.PI) / 180;

/**
 * Torso pitch limits, radians.
 *
 * Sign convention, and the source of an inverted-aim bug worth spelling out:
 * the spine, chest and head extend along **+Y** from their joints, so a
 * positive X rotation tips them **backward**. Limbs hang along −Y, where the
 * same positive rotation swings them *forward*. The two are opposite, and using
 * the limb convention on the torso makes the character lean back when it should
 * look down.
 */
const MAX_TORSO_LEAN_BACK = (35 * Math.PI) / 180;
const MAX_TORSO_LEAN_FORWARD = (45 * Math.PI) / 180;

const AIM_BLEND_RATE = 12;
const SPRINT_BLEND_RATE = 9;

/**
 * Where each elbow is pulled, as an offset from its own shoulder in **character
 * space** (+X right, +Y up, −Z forward): down, outboard and slightly behind, so
 * the elbows tuck rather than splay.
 *
 * Character space rather than a bone's local space on purpose — a bone's axes
 * depend on how the asset was authored, so a pole written in chest space lands
 * on the wrong side the moment a model with a different forward axis is loaded.
 */
const RIGHT_ELBOW_POLE = new THREE.Vector3(0.5, -0.8, 0.3);
const LEFT_ELBOW_POLE = new THREE.Vector3(-0.5, -0.8, 0.3);

export class WeaponPose {
  private readonly rig: HumanoidRig;
  private grips: WeaponGrips | null = null;

  private aimBlendValue = 0;
  private sprintBlend = 0;

  // Scratch. This runs every frame for two arm chains and must not allocate.
  private readonly offset: [number, number, number] = [0, 0, 0];
  private pitchBias = 0;
  private yawBias = 0;
  private pitchFollow = 0;
  private torsoFollow = 0;

  private readonly weaponEuler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly weaponWorldQuaternion = new THREE.Quaternion();
  private readonly parentWorldQuaternion = new THREE.Quaternion();
  private readonly gripWorld = new THREE.Vector3();
  private readonly poleWorld = new THREE.Vector3();
  private readonly handQuaternion = new THREE.Quaternion();
  private readonly rootQuaternion = new THREE.Quaternion();
  private readonly scratchVector = new THREE.Vector3();

  private readonly rightArm: ArmChain;
  private readonly leftArm: ArmChain;


  constructor(rig: HumanoidRig) {
    this.rig = rig;
    this.rightArm = {
      upper: rig.bones[BoneName.ArmR],
      lower: rig.bones[BoneName.ForearmR],
      hand: rig.bones[BoneName.HandR],
      upperLength: rig.armMetrics.upperLength,
      lowerLength: rig.armMetrics.lowerLength,
      restDirection: rig.restDirection,
    };
    this.leftArm = {
      upper: rig.bones[BoneName.ArmL],
      lower: rig.bones[BoneName.ForearmL],
      hand: rig.bones[BoneName.HandL],
      upperLength: rig.armMetrics.upperLength,
      lowerLength: rig.armMetrics.lowerLength,
      restDirection: rig.restDirection,
    };

  }

  /** Supplies the weapon's grip anchors. Called when a weapon is equipped. */
  setGrips(grips: WeaponGrips | null): void {
    this.grips = grips;
  }

  /** 0 = hip, 1 = fully aimed. */
  get aimBlend(): number {
    return this.aimBlendValue;
  }

  /**
   * Height of each foot above the character's own ground plane, metres.
   *
   * The exit criterion is that feet meet the floor, so it is measured rather
   * than eyeballed. Development hook.
   */
  footHeight(): { right: number; left: number } {
    const feet = this.footPositions();
    return { right: feet.right[1], left: feet.left[1] };
  }

  /**
   * Both feet in character space, metres.
   *
   * The y components answer "are the feet on the floor"; the z components answer
   * "are the legs actually striding", which is the only objective way to tell a
   * walk cycle from a bind pose sliding along the ground. Development hook.
   */
  footPositions(): { right: [number, number, number]; left: [number, number, number] } {
    this.rig.root.updateWorldMatrix(true, true);
    this.rig.bones[BoneName.FootR].getWorldPosition(this.scratchVector);
    this.rig.root.worldToLocal(this.scratchVector);
    const right: [number, number, number] = [this.scratchVector.x, this.scratchVector.y, this.scratchVector.z];
    this.rig.bones[BoneName.FootL].getWorldPosition(this.scratchVector);
    this.rig.root.worldToLocal(this.scratchVector);
    return { right, left: [this.scratchVector.x, this.scratchVector.y, this.scratchVector.z] };
  }

  /** Chest and head X rotations, radians. Development hook. */
  get torsoPitch(): number {
    return this.rig.bones[BoneName.Chest].rotation.x;
  }

  get headPitch(): number {
    return this.rig.bones[BoneName.Head].rotation.x;
  }

  /**
   * Lean of the lower spine in **character space**, radians. Negative is a
   * forward fold. Development hook.
   *
   * Measured as the direction from the spine joint to the chest joint rather
   * than read off the bone's local `rotation.x`. Locomotion clips are retargeted
   * onto each skeleton's bind pose, so a bone's local rotation is its bind
   * orientation composed with the authored one and means nothing on its own —
   * on the Quaternius rig a forward fold reads as a *positive* local x. The
   * vector between two joints is the same measurement on any rig.
   */
  get spinePitch(): number {
    this.rig.root.updateWorldMatrix(true, true);
    this.rig.bones[BoneName.Spine].getWorldPosition(this.scratchVector);
    this.rig.root.worldToLocal(this.scratchVector);
    const spineY = this.scratchVector.y;
    const spineZ = this.scratchVector.z;
    this.rig.bones[BoneName.Chest].getWorldPosition(this.scratchVector);
    this.rig.root.worldToLocal(this.scratchVector);
    return Math.atan2(this.scratchVector.z - spineZ, this.scratchVector.y - spineY);
  }

  /**
   * How far each hand ended up from its grip, metres.
   *
   * Non-zero means the IK could not reach — the arm is too short for where the
   * weapon was placed, which is a stance-tuning problem, not a solver bug.
   */
  gripError(): { right: number; left: number } {
    const grips = this.grips;
    if (grips === null) return { right: -1, left: -1 };

    this.rig.root.updateWorldMatrix(true, true);
    grips.right.getWorldPosition(this.gripWorld);
    this.rig.bones[BoneName.HandR].getWorldPosition(this.poleWorld);
    const right = this.gripWorld.distanceTo(this.poleWorld);

    grips.left.getWorldPosition(this.gripWorld);
    this.rig.bones[BoneName.HandL].getWorldPosition(this.poleWorld);
    const left = this.gripWorld.distanceTo(this.poleWorld);

    return { right, left };
  }

  /** @param dt Real frame delta, seconds. */
  apply(input: PoseInput, dt: number): void {
    this.aimBlendValue = damp(this.aimBlendValue, input.aiming ? 1 : 0, AIM_BLEND_RATE, dt);
    // Sprint and aim are mutually exclusive, so aiming pulls the weapon out of
    // the sprint carry rather than waiting for the sprint to end.
    const wantSprint = input.sprinting && !input.aiming;
    this.sprintBlend = damp(this.sprintBlend, wantSprint ? 1 : 0, SPRINT_BLEND_RATE, dt);

    this.blendStance();
    // Torso first. `placeWeapon` writes the weapon's orientation in world space
    // by dividing out its parent's rotation, so the chest must already hold this
    // frame's value — otherwise the weapon is compensated against a stale chest
    // and keeps whatever pitch the torso added since.
    this.poseTorso(input);
    this.placeWeapon(input);
    this.solveArms();
  }

  /** HIP → AIM by the aim blend, then → SPRINT by the sprint blend. */
  private blendStance(): void {
    const a = this.aimBlendValue;
    const s = this.sprintBlend;
    const mix = (hip: number, aim: number, sprint: number): number => {
      const base = hip + (aim - hip) * a;
      return base + (sprint - base) * s;
    };

    for (let i = 0; i < 3; i++) {
      this.offset[i] = mix(HIP.offset[i] ?? 0, AIM.offset[i] ?? 0, SPRINT.offset[i] ?? 0);
    }
    this.pitchBias = mix(HIP.pitchBias, AIM.pitchBias, SPRINT.pitchBias);
    this.yawBias = mix(HIP.yawBias, AIM.yawBias, SPRINT.yawBias);
    this.pitchFollow = mix(HIP.pitchFollow, AIM.pitchFollow, SPRINT.pitchFollow);
    this.torsoFollow = mix(HIP.torsoFollow, AIM.torsoFollow, SPRINT.torsoFollow);
  }

  /**
   * Places the weapon from the aim direction.
   *
   * The socket hangs off the chest so it travels with the body, but its
   * orientation is written in **world** space with the chest's own rotation
   * divided out. Inheriting the chest's rotation would double-apply the torso
   * twist and swing the barrel off the aim line.
   */
  private placeWeapon(input: PoseInput): void {
    const socket = this.rig.weaponSocket;
    socket.position.set(
      this.offset[0],
      this.offset[1] - input.crouchBlend * 0.05,
      this.offset[2],
    );

    const pitch = input.aimPitch * this.pitchFollow + this.pitchBias - input.recoilPitch;
    const yaw = input.aimYaw + this.yawBias;

    this.weaponEuler.set(-pitch, yaw, 0);
    this.weaponWorldQuaternion.setFromEuler(this.weaponEuler);

    const parent = socket.parent;
    if (parent === null) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(this.parentWorldQuaternion);
    socket.quaternion
      .copy(this.parentWorldQuaternion.invert())
      .multiply(this.weaponWorldQuaternion);
  }

  /**
   * Twists and pitches the torso toward the aim.
   *
   * The legs hold their own facing — `resolveFacing` in the shared simulation
   * only turns them once the aim leaves a deadzone — so this is what actually
   * communicates where the character is looking.
   */
  private poseTorso(input: PoseInput): void {
    const yawOffset = wrapAngle(input.aimYaw - input.bodyYaw);
    const twist = clamp(yawOffset * this.torsoFollow, -MAX_TORSO_TWIST, MAX_TORSO_TWIST);
    // `aimPitch` is positive looking down, and a positive X rotation leans the
    // torso back, so the aim contribution is negated: looking down folds the
    // character forward. Recoil throws the shoulders back, so it adds.
    const pitch = clamp(
      -input.aimPitch * this.torsoFollow * 0.5 + input.recoilPitch * 0.6,
      -MAX_TORSO_LEAN_FORWARD,
      MAX_TORSO_LEAN_BACK,
    );

    this.rig.bones[BoneName.Chest].rotation.set(pitch, twist, 0);
    // The head keeps looking along the aim even when the torso has run out of
    // twist, which is what sells "the character is watching that".
    this.rig.bones[BoneName.Head].rotation.set(
      clamp(-input.aimPitch * 0.35, -0.5, 0.5),
      clamp(yawOffset - twist, -0.7, 0.7),
      0,
    );
  }

  /** Solves both arms onto the weapon's grips. */
  private solveArms(): void {
    const grips = this.grips;
    if (grips === null) return;

    // The weapon's world transform is only up to date after the chest has been
    // rotated, so this must run last.
    this.rig.weaponSocket.updateWorldMatrix(true, true);
    grips.right.getWorldQuaternion(this.handQuaternion);

    // Poles are built from the character root's orientation, so they land on the
    // correct side for any rig regardless of the asset's authored axes.
    this.rig.root.getWorldQuaternion(this.rootQuaternion);

    grips.right.getWorldPosition(this.gripWorld);
    this.placePole(this.rightArm.upper, RIGHT_ELBOW_POLE);
    solveArmIK(this.rightArm, this.gripWorld, this.poleWorld, this.handQuaternion);

    grips.left.getWorldPosition(this.gripWorld);
    this.placePole(this.leftArm.upper, LEFT_ELBOW_POLE);
    solveArmIK(this.leftArm, this.gripWorld, this.poleWorld, this.handQuaternion);
  }

  /** Writes `poleWorld` as a character-space offset from a shoulder. */
  private placePole(shoulder: THREE.Object3D, offset: THREE.Vector3): void {
    shoulder.getWorldPosition(this.poleWorld);
    this.scratchVector.copy(offset).applyQuaternion(this.rootQuaternion);
    this.poleWorld.add(this.scratchVector);
  }
}
