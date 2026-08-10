import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { PLAYER_CONFIG, createLogger } from "@nullpoint/shared";

import { CHARACTER_GLTF_URL, resolveCharacterResource } from "./characterAssets.ts";
import { createLocomotionClips, LocomotionClip } from "./clips.ts";
import { buildHumanoidRig, QUATERNIUS_BONE_MAP } from "./humanoidRig.ts";
import { createHumanoidRig, normalizeToHeight, type HumanoidRig } from "./rig.ts";

const log = createLogger("character");

export type CharacterSource = "placeholder" | "glb";

export interface CharacterAsset {
  /** Character origin at the feet; position and yaw are applied here. */
  readonly root: THREE.Object3D;
  readonly clips: ReadonlyMap<LocomotionClip, THREE.AnimationClip>;
  readonly source: CharacterSource;
  /**
   * Clips the asset itself supplied, as opposed to the generated locomotion that
   * fills the rest. Empty for an asset that ships no animation.
   */
  readonly assetClips: readonly LocomotionClip[];
  /** Rendered height after normalisation, metres. */
  readonly height: number;
  /**
   * The gameplay rig — semantic joints, weapon socket and IK metrics.
   *
   * Present for both the procedural placeholder and a mapped glTF skeleton, so
   * the aim pose and arm IK run unchanged against either.
   */
  readonly rig: HumanoidRig | null;
  dispose(): void;
}

/**
 * Clip names accepted for each state when loading a GLB, in priority order.
 *
 * Covers the usual Mixamo and Quaternius spellings. Matching is
 * case-insensitive and ignores Mixamo's `mixamo.com|` track prefix.
 */
const CLIP_NAME_CANDIDATES: Readonly<Record<LocomotionClip, readonly string[]>> = {
  [LocomotionClip.Idle]: ["idle", "idle_a", "breathingidle", "standing"],
  [LocomotionClip.Walk]: ["walk", "walking", "walk_forward"],
  [LocomotionClip.Run]: ["run", "running", "jog", "run_forward"],
  [LocomotionClip.Sprint]: ["sprint", "sprinting", "runfast", "fastrun"],
  [LocomotionClip.Jump]: ["jump", "jump_start", "jumpup", "jumping"],
  [LocomotionClip.Fall]: ["fall", "falling", "fallidle", "jump_idle", "inair"],
  [LocomotionClip.Land]: ["land", "landing", "jump_land", "jumpdown"],
  [LocomotionClip.CrouchIdle]: ["crouchidle", "crouch", "crouching", "sneakidle"],
  [LocomotionClip.CrouchMove]: ["crouchwalk", "crouchmove", "sneak", "sneakwalk"],
};

const ALL_CLIPS: readonly LocomotionClip[] = Object.values(LocomotionClip);

function normaliseClipName(name: string): string {
  const withoutPrefix = name.includes("|") ? (name.split("|").pop() ?? name) : name;
  return withoutPrefix.toLowerCase().replace(/[\s_-]/g, "");
}

function matchClips(clips: readonly THREE.AnimationClip[]): Map<LocomotionClip, THREE.AnimationClip> {
  const byName = new Map<string, THREE.AnimationClip>();
  for (const clip of clips) byName.set(normaliseClipName(clip.name), clip);

  const matched = new Map<LocomotionClip, THREE.AnimationClip>();
  for (const slot of ALL_CLIPS) {
    for (const candidate of CLIP_NAME_CANDIDATES[slot]) {
      const clip = byName.get(normaliseClipName(candidate));
      if (clip !== undefined) {
        matched.set(slot, clip);
        break;
      }
    }
  }
  return matched;
}

/**
 * Fills any slot the asset did not supply with generated locomotion.
 *
 * An asset's own clips always win — authored animation beats anything generated
 * here — so dropping in a real clip library later replaces these a state at a
 * time, with no code change.
 */
function withGeneratedClips(
  rig: HumanoidRig,
  supplied: Map<LocomotionClip, THREE.AnimationClip>,
): Map<LocomotionClip, THREE.AnimationClip> {
  const generated = createLocomotionClips(rig);
  const merged = new Map(generated);
  for (const [slot, clip] of supplied) merged.set(slot, clip);
  return merged;
}

/**
 * Builds the clearly-marked placeholder character.
 *
 * `PROJECT.md` Q10/Q12/Q19 leave art direction and asset sourcing undecided, and
 * no suitably licensed rigged humanoid was available at Phase 1 (see
 * `ASSET_CREDITS.md`). Rather than stall the phase, the prototype ships a
 * procedural humanoid with authored clips; the GLB path below is the seam the
 * real asset drops into.
 */
function createPlaceholderCharacter(): CharacterAsset {
  const rig = createHumanoidRig();
  normalizeToHeight(rig.root, PLAYER_CONFIG.standHeight);

  log.warn(
    "using the PLACEHOLDER procedural character — no licensed rigged asset is present. " +
      "Set VITE_CHARACTER_GLB to load a real one.",
  );

  return {
    root: rig.root,
    clips: createLocomotionClips(rig),
    source: "placeholder",
    assetClips: [],
    height: PLAYER_CONFIG.standHeight,
    rig,
    dispose: () => rig.dispose(),
  };
}

/**
 * The glTF specification places an asset's front on +Z; NULLPOINT uses −Z
 * throughout (`CLAUDE.md` §5). A spec-conforming asset therefore needs half a
 * turn, applied once at the model root.
 */
const GLTF_FORWARD_CORRECTION = Math.PI;

/** Quaternius bones run along +Y toward their child, unlike the placeholder's −Y. */
const QUATERNIUS_REST_DIRECTION = new THREE.Vector3(0, 1, 0);

async function loadGlbCharacter(url: string): Promise<CharacterAsset> {
  // The glTF references its buffer and textures by bare filename. Vite
  // fingerprints emitted assets, so those names no longer exist as paths —
  // every request is routed through the emitted-asset map instead.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(resolveCharacterResource);

  const gltf = await new GLTFLoader(manager).loadAsync(url);

  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      // Skinned meshes are culled against their un-posed bounding box, so a
      // character can vanish when an arm swings outside it.
      object.frustumCulled = false;
    }
  });

  const built = buildHumanoidRig(gltf.scene, QUATERNIUS_BONE_MAP, {
    forwardCorrectionYaw: GLTF_FORWARD_CORRECTION,
    restDirection: QUATERNIUS_REST_DIRECTION,
    targetHeight: PLAYER_CONFIG.standHeight,
  });

  if (built === null) {
    throw new Error("character skeleton could not be mapped; see the log for the missing joints");
  }

  // Read the bind pose and bake before anything poses the skeleton: the
  // retargeter measures the character's rest frame, and a posed skeleton would
  // silently bake the pose into every clip.
  const supplied = matchClips(gltf.animations);
  const clips = withGeneratedClips(built.rig, supplied);
  const assetClips = [...supplied.keys()];

  log.info(
    `loaded character from ${url}: ${gltf.animations.length} clips, ` +
      `scaled ×${built.appliedScale.toFixed(4)} from ${built.sourceHeight.toFixed(3)} m`,
  );
  if (assetClips.length < ALL_CLIPS.length) {
    const generated = ALL_CLIPS.filter((slot) => !supplied.has(slot));
    log.warn(
      `character supplies no clip for: ${generated.join(", ")}; using generated locomotion. ` +
        "See ASSET_CREDITS.md.",
    );
  }

  return {
    root: built.rig.root,
    clips,
    source: "glb",
    assetClips,
    height: built.sourceHeight * built.appliedScale,
    rig: built.rig,
    dispose: () => built.rig.dispose(),
  };
}

/**
 * Loads the player character.
 *
 * No network request is made unless `VITE_CHARACTER_GLB` is set, so the default
 * build produces no failed requests. If a configured GLB fails to load the
 * prototype falls back to the placeholder rather than failing to start.
 */
export async function loadCharacterAsset(): Promise<CharacterAsset> {
  // An explicit override wins, otherwise the bundled Quaternius character.
  const override = import.meta.env["VITE_CHARACTER_GLB"];
  const url =
    typeof override === "string" && override.length > 0 ? override : CHARACTER_GLTF_URL;

  try {
    return await loadGlbCharacter(url);
  } catch (error) {
    // Loudly, not silently: a missing character is a real problem, but it must
    // not stop the game from starting.
    log.error(`failed to load the character from ${url}; falling back to placeholder`, error);
    return createPlaceholderCharacter();
  }
}
