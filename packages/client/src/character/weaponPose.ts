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
  offset: [0.15, 0.02, -0.14],
  pitchBias: 0.2,
  yawBias: -0.09,
  pitchFollow: 0.55,
  torsoFollow: 0.55,
};

/** Shouldered: stock in to the shoulder, barrel on the aim line. */
const AIM: Stance = {
  // Close to the centreline on purpose: held out on the right shoulder the
  // support grip drifts beyond the left arm's reach and the hand comes off it.
  offset: [0.13, 0.1, -0.18],
  pitchBias: 0,
  yawBias: 0,
  pitchFollow: 1,
  torsoFollow: 0.9,
};

/** Sprinting: weapon dropped across the body, out of the way. */
const SPRINT: Stance = {
  offset: [0.16, -0.08, -0.1],
  pitchBias: 0.45,
  yawBias: -0.3,
  pitchFollow: 0.15,
  torsoFollow: 0.25,
};

/** Widest the torso may twist away from the character's facing, radians. */
const MAX_TORSO_TWIST = (55 * Math.PI) / 180;
/** Torso pitch limits, radians. Positive leans forward/down. */
const MAX_TORSO_PITCH = (40 * Math.PI) / 180;
const MIN_TORSO_PITCH = (-35 * Math.PI) / 180;

const AIM_BLEND_RATE = 12;
const SPRINT_BLEND_RATE = 9;

/** Elbows are pulled toward points below and outboard of each shoulder. */
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
    };
    this.leftArm = {
      upper: rig.bones[BoneName.ArmL],
      lower: rig.bones[BoneName.ForearmL],
      hand: rig.bones[BoneName.HandL],
      upperLength: rig.armMetrics.upperLength,
      lowerLength: rig.armMetrics.lowerLength,
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
    this.placeWeapon(input);
    this.poseTorso(input);
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
    const pitch = clamp(
      input.aimPitch * this.torsoFollow * 0.5 - input.recoilPitch * 0.6,
      MIN_TORSO_PITCH,
      MAX_TORSO_PITCH,
    );

    this.rig.bones[BoneName.Chest].rotation.set(pitch, twist, 0);
    // The head keeps looking along the aim even when the torso has run out of
    // twist, which is what sells "the character is watching that".
    this.rig.bones[BoneName.Head].rotation.set(
      clamp(input.aimPitch * 0.35, -0.5, 0.5),
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

    grips.right.getWorldPosition(this.gripWorld);
    this.poleWorld.copy(RIGHT_ELBOW_POLE);
    this.rig.bones[BoneName.Chest].localToWorld(this.poleWorld);
    solveArmIK(this.rightArm, this.gripWorld, this.poleWorld, this.handQuaternion);

    grips.left.getWorldPosition(this.gripWorld);
    this.poleWorld.copy(LEFT_ELBOW_POLE);
    this.rig.bones[BoneName.Chest].localToWorld(this.poleWorld);
    solveArmIK(this.leftArm, this.gripWorld, this.poleWorld, this.handQuaternion);
  }
}
