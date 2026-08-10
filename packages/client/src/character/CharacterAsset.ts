import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { MovementState, PLAYER_CONFIG, createLogger } from "@nullpoint/shared";

import { createPlaceholderClips } from "./clips.ts";
import { createHumanoidRig, normalizeToHeight } from "./rig.ts";

const log = createLogger("character");

export type CharacterSource = "placeholder" | "glb";

export interface CharacterAsset {
  /** Character origin at the feet; position and yaw are applied here. */
  readonly root: THREE.Object3D;
  readonly clips: ReadonlyMap<MovementState, THREE.AnimationClip>;
  readonly source: CharacterSource;
  /** States with no clip. `AnimationController` substitutes a fallback for each. */
  readonly missingStates: readonly MovementState[];
  dispose(): void;
}

/**
 * Clip names accepted for each state when loading a GLB, in priority order.
 *
 * Covers the usual Mixamo and Quaternius spellings. Matching is
 * case-insensitive and ignores Mixamo's `mixamo.com|` track prefix.
 */
const CLIP_NAME_CANDIDATES: Readonly<Record<MovementState, readonly string[]>> = {
  [MovementState.Idle]: ["idle", "idle_a", "breathingidle", "standing"],
  [MovementState.Walk]: ["walk", "walking", "walk_forward"],
  [MovementState.Run]: ["run", "running", "jog", "run_forward"],
  [MovementState.Sprint]: ["sprint", "sprinting", "runfast", "fastrun"],
  [MovementState.Jump]: ["jump", "jump_start", "jumpup", "jumping"],
  [MovementState.Fall]: ["fall", "falling", "fallidle", "jump_idle", "inair"],
  [MovementState.Crouch]: ["crouch", "crouching", "crouchidle", "crouch_walk", "sneak"],
};

const ALL_STATES: readonly MovementState[] = [
  MovementState.Idle,
  MovementState.Walk,
  MovementState.Run,
  MovementState.Sprint,
  MovementState.Jump,
  MovementState.Fall,
  MovementState.Crouch,
];

function normaliseClipName(name: string): string {
  const withoutPrefix = name.includes("|") ? (name.split("|").pop() ?? name) : name;
  return withoutPrefix.toLowerCase().replace(/[\s_-]/g, "");
}

function matchClips(clips: readonly THREE.AnimationClip[]): Map<MovementState, THREE.AnimationClip> {
  const byName = new Map<string, THREE.AnimationClip>();
  for (const clip of clips) byName.set(normaliseClipName(clip.name), clip);

  const matched = new Map<MovementState, THREE.AnimationClip>();
  for (const state of ALL_STATES) {
    for (const candidate of CLIP_NAME_CANDIDATES[state]) {
      const clip = byName.get(normaliseClipName(candidate));
      if (clip !== undefined) {
        matched.set(state, clip);
        break;
      }
    }
  }
  return matched;
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
    clips: createPlaceholderClips(),
    source: "placeholder",
    missingStates: [],
    dispose: () => rig.dispose(),
  };
}

async function loadGlbCharacter(url: string): Promise<CharacterAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const scale = normalizeToHeight(root, PLAYER_CONFIG.standHeight);
  const clips = matchClips(gltf.animations);
  const missingStates = ALL_STATES.filter((state) => !clips.has(state));

  log.info(
    `loaded character from ${url}: ${gltf.animations.length} clips, scaled ×${scale.toFixed(3)}`,
  );
  if (missingStates.length > 0) {
    log.warn(
      `character GLB has no clip for: ${missingStates.join(", ")}. ` +
        "A fallback state will be substituted; see ASSET_CREDITS.md.",
      gltf.animations.map((clip) => clip.name),
    );
  }

  return {
    root,
    clips,
    source: "glb",
    missingStates,
    dispose: () => {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
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
  const url = import.meta.env["VITE_CHARACTER_GLB"];
  if (typeof url !== "string" || url.length === 0) {
    return createPlaceholderCharacter();
  }

  try {
    return await loadGlbCharacter(url);
  } catch (error) {
    log.error(`failed to load character GLB from ${url}; falling back to placeholder`, error);
    return createPlaceholderCharacter();
  }
}
