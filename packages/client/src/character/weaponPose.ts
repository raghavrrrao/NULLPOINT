import * as THREE from "three";

import { clamp, damp } from "@nullpoint/shared";

import { BoneName, type HumanoidRig } from "./rig.ts";

/**
 * Upper-body override for holding and aiming a weapon.
 *
 * Applied **after** the `AnimationMixer` has written the locomotion pose, so it
 * simply wins on the bones it touches and leaves the legs and hips entirely to
 * the locomotion clips. That is what lets the character run, jump and crouch
 * normally while still holding a rifle, without a second animation system
 * (Phase 2 brief §23: do not destroy locomotion to force an aim pose).
 *
 * The arm angles here are hand-authored to suit the placeholder rig. A real
 * rigged GLB will bring its own aim poses and should replace this file rather
 * than extend it.
 */

interface ArmPose {
  /** Euler XYZ for each bone, radians. */
  readonly armL: readonly [number, number, number];
  readonly forearmL: readonly [number, number, number];
  readonly armR: readonly [number, number, number];
  readonly forearmR: readonly [number, number, number];
  readonly handR: readonly [number, number, number];
  /** Weapon mount offset from the chest, metres. */
  readonly mountPosition: readonly [number, number, number];
  /** Weapon mount rotation, radians. Zero points the barrel along −Z. */
  readonly mountRotation: readonly [number, number, number];
  /** Chest twist toward the aim direction, as a fraction of the yaw offset. */
  readonly chestFollow: number;
}

/**
 * Weapon lowered across the body — the default carry.
 *
 * Sign convention, easy to get backwards: limbs hang along local −Y, so a
 * **positive** X rotation swings them toward −Z, which is forward. Negative
 * values point the arms behind the character.
 */
const CARRY: ArmPose = {
  armL: [0.95, 0.35, 0.5],
  forearmL: [-1.15, 0, 0],
  armR: [0.75, -0.25, -0.35],
  forearmR: [-1.0, 0, 0],
  handR: [0, 0, 0],
  mountPosition: [-0.2, -0.02, -0.12],
  // Negative X drops the barrel: a positive rotation raises it, which pointed
  // the muzzle 26° at the sky in the low-ready carry.
  mountRotation: [-0.35, 0.22, 0],
  chestFollow: 0.35,
};

/** Weapon shouldered, pointing down the aim line. */
const AIM: ArmPose = {
  armL: [1.35, 0.45, 0.42],
  forearmL: [-1.05, 0, 0],
  armR: [1.3, -0.2, -0.22],
  forearmR: [-0.75, 0, 0],
  handR: [0, 0, 0],
  mountPosition: [-0.1, 0.06, -0.16],
  mountRotation: [0, 0, 0],
  chestFollow: 0.85,
};

/** Widest the chest may twist away from the character's facing, radians. */
const MAX_CHEST_TWIST = 1.0;
/** Widest the chest may pitch to follow aim elevation, radians. */
const MAX_CHEST_PITCH = 0.75;
/** Rate the aim blend eases between CARRY and AIM. */
const BLEND_RATE = 12;

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  out: THREE.Euler,
): void {
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

export class WeaponPose {
  private readonly rig: HumanoidRig;
  private blend = 0;
  private readonly scratch = new THREE.Euler();

  constructor(rig: HumanoidRig) {
    this.rig = rig;
  }

  /** 0 = carrying, 1 = fully aimed. Exposed for the debug HUD. */
  get aimBlend(): number {
    return this.blend;
  }

  /**
   * @param aiming     Whether the aim button is held.
   * @param yawOffset  Aim yaw minus character yaw, radians, already wrapped.
   * @param pitch      Aim pitch, radians. Positive looks down.
   * @param recoilPitch Accumulated recoil, radians, added to the weapon's rise.
   * @param dt         Real frame delta, seconds.
   */
  apply(
    aiming: boolean,
    yawOffset: number,
    pitch: number,
    recoilPitch: number,
    dt: number,
  ): void {
    this.blend = damp(this.blend, aiming ? 1 : 0, BLEND_RATE, dt);
    const t = this.blend;

    const bones = this.rig.bones;

    lerp3(CARRY.armL, AIM.armL, t, this.scratch);
    bones[BoneName.ArmL].rotation.copy(this.scratch);
    lerp3(CARRY.forearmL, AIM.forearmL, t, this.scratch);
    bones[BoneName.ForearmL].rotation.copy(this.scratch);
    lerp3(CARRY.armR, AIM.armR, t, this.scratch);
    bones[BoneName.ArmR].rotation.copy(this.scratch);
    lerp3(CARRY.forearmR, AIM.forearmR, t, this.scratch);
    bones[BoneName.ForearmR].rotation.copy(this.scratch);
    lerp3(CARRY.handR, AIM.handR, t, this.scratch);
    bones[BoneName.HandR].rotation.copy(this.scratch);

    lerp3(CARRY.mountRotation, AIM.mountRotation, t, this.scratch);
    this.rig.weaponMount.rotation.copy(this.scratch);
    this.rig.weaponMount.position.set(
      CARRY.mountPosition[0] + (AIM.mountPosition[0] - CARRY.mountPosition[0]) * t,
      CARRY.mountPosition[1] + (AIM.mountPosition[1] - CARRY.mountPosition[1]) * t,
      CARRY.mountPosition[2] + (AIM.mountPosition[2] - CARRY.mountPosition[2]) * t,
    );

    // Chest twist. The character's yaw already turns to the camera while aiming,
    // so this only has to absorb the residual — but it is what makes hip-fire
    // read as "pointing that way" rather than "facing forward, shooting sideways".
    const follow = CARRY.chestFollow + (AIM.chestFollow - CARRY.chestFollow) * t;
    const twist = clamp(yawOffset * follow, -MAX_CHEST_TWIST, MAX_CHEST_TWIST);
    // Weapon elevation is carried by the chest, plus the recoil kick.
    const elevation = clamp(-pitch * follow - recoilPitch, -MAX_CHEST_PITCH, MAX_CHEST_PITCH);

    const chest = bones[BoneName.Chest];
    chest.rotation.set(elevation, twist, 0);
  }
}
