import * as THREE from "three";

import { ASSAULT_RIFLE } from "@nullpoint/shared";

/**
 * Low-poly placeholder rifle.
 *
 * No suitably licensed weapon GLB is in the repository (`ASSET_CREDITS.md`), and
 * the Phase 2 brief is explicit that the phase must not stall on asset
 * acquisition. This builds one from primitives instead.
 *
 * Everything downstream talks to {@link RifleModel} through `root` and `muzzle`,
 * so dropping in a real GLB means changing this file only.
 *
 * Built pointing along **−Z**, matching the glTF forward convention in
 * `CLAUDE.md` §5, with the grip near the origin so it attaches sensibly to a
 * hand joint.
 */

export interface RifleModel {
  /** Attach this to the weapon socket. */
  readonly root: THREE.Group;
  /** Empty at the barrel tip. Muzzle flash and tracers originate here. */
  readonly muzzle: THREE.Object3D;
  /** Where the trigger hand goes — the pistol grip. */
  readonly gripRight: THREE.Object3D;
  /** Where the support hand goes — the handguard. */
  readonly gripLeft: THREE.Object3D;
  dispose(): void;
}

interface Part {
  readonly size: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly tone: "body" | "dark" | "accent";
}

/** Parts are laid out along −Z: grip at the origin, barrel forward. */
const PARTS: readonly Part[] = [
  { size: [0.06, 0.1, 0.34], position: [0, 0.055, -0.12], tone: "body" }, // receiver
  { size: [0.05, 0.05, 0.3], position: [0, 0.06, -0.4], tone: "dark" }, // handguard
  { size: [0.028, 0.028, 0.22], position: [0, 0.06, -0.62], tone: "dark" }, // barrel
  { size: [0.05, 0.16, 0.06], position: [0, -0.03, -0.02], tone: "body" }, // pistol grip
  { size: [0.045, 0.13, 0.07], position: [0, -0.02, -0.19], tone: "accent" }, // magazine
  { size: [0.055, 0.09, 0.2], position: [0, 0.06, 0.12], tone: "body" }, // stock
  { size: [0.02, 0.035, 0.03], position: [0, 0.115, -0.26], tone: "dark" }, // rear sight
  { size: [0.018, 0.03, 0.025], position: [0, 0.112, -0.52], tone: "dark" }, // front sight
];

export function createRifleModel(): RifleModel {
  const root = new THREE.Group();
  root.name = "rifle";

  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x3c434b, roughness: 0.6, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.5, metalness: 0.45 }),
    // Amber marks this as placeholder art, matching the character's accents.
    accent: new THREE.MeshStandardMaterial({ color: 0xb07a34, roughness: 0.65, metalness: 0.2 }),
  } as const;

  const geometries: THREE.BoxGeometry[] = [];
  for (const part of PARTS) {
    const geometry = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, materials[part.tone]);
    mesh.position.set(part.position[0], part.position[1], part.position[2]);
    mesh.castShadow = true;
    root.add(mesh);
  }

  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  const [mx, my, mz] = ASSAULT_RIFLE.muzzleOffset;
  muzzle.position.set(mx, my, mz);
  root.add(muzzle);

  // Hand targets, on the weapon rather than on the character: the arms are
  // solved onto these, so the grip is correct by construction.
  const gripRight = new THREE.Object3D();
  gripRight.name = "grip-right";
  gripRight.position.set(0, -0.035, -0.02);
  root.add(gripRight);

  const gripLeft = new THREE.Object3D();
  gripLeft.name = "grip-left";
  // Kept within the support arm's reach rather than out on the handguard: the
  // Quaternius arm spans 0.495 m from shoulder to wrist, and a grip further
  // forward simply cannot be reached across the body.
  gripLeft.position.set(0, 0.02, -0.17);
  root.add(gripLeft);

  return {
    root,
    muzzle,
    gripRight,
    gripLeft,
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
