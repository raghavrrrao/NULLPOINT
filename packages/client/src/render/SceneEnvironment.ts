import * as THREE from "three";

import type { MapLighting } from "../map/types.ts";

/**
 * Scene background, fog and lighting.
 *
 * One directional key light with a tight shadow frustum plus hemisphere fill.
 * `PROJECT.md` §4 keeps art direction open (Q10), so this is deliberately
 * neutral grey-box lighting chosen to read depth and slope clearly, not to look
 * good.
 */
export interface SceneEnvironment {
  readonly scene: THREE.Scene;
  readonly keyLight: THREE.DirectionalLight;
  /** Keeps the shadow frustum centred on the player as they move. */
  update(focusX: number, focusZ: number): void;
}

const SHADOW_EXTENT = 26;
const LIGHT_OFFSET = new THREE.Vector3(-18, 26, 12);

/**
 * Builds the scene, its fog and its three lights from a map's lighting.
 *
 * Taken from the map rather than fixed, so a map can set its own mood — but
 * the *structure* is fixed at key + hemisphere + ambient with no
 * post-processing, because a player silhouette staying readable against cover
 * matters more than atmosphere.
 */
export function createSceneEnvironment(lighting: MapLighting): SceneEnvironment {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(lighting.fogColour);
  // Exponential rather than linear: linear fog needs near/far tuned per map
  // size, and a density reads the same in a 48 m arena and a 60 m one.
  scene.fog = new THREE.FogExp2(lighting.fogColour, lighting.fogDensity);

  // Generous fill relative to the key light. With a single directional source
  // the corridor and the area under the crouch gate read as black, and a
  // grey-box has to stay legible in exactly those places.
  const hemisphere = new THREE.HemisphereLight(
    lighting.skyColour,
    lighting.groundColour,
    lighting.hemisphereIntensity * 2.5,
  );
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffffff, lighting.ambientIntensity);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(lighting.keyColour, lighting.keyIntensity);
  // The map gives a direction; the offset is that direction pushed back out
  // to the shadow camera's working distance.
  LIGHT_OFFSET.set(-lighting.keyDirection[0], -lighting.keyDirection[1], -lighting.keyDirection[2])
    .normalize()
    .multiplyScalar(34);
  keyLight.position.copy(LIGHT_OFFSET);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 90;
  keyLight.shadow.camera.left = -SHADOW_EXTENT;
  keyLight.shadow.camera.right = SHADOW_EXTENT;
  keyLight.shadow.camera.top = SHADOW_EXTENT;
  keyLight.shadow.camera.bottom = -SHADOW_EXTENT;
  // Without a bias the flat arena floor self-shadows into visible acne bands.
  keyLight.shadow.bias = -0.0009;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  scene.add(keyLight.target);

  return {
    scene,
    keyLight,
    update(focusX: number, focusZ: number): void {
      keyLight.target.position.set(focusX, 0, focusZ);
      keyLight.target.updateMatrixWorld();
      keyLight.position.set(
        focusX + LIGHT_OFFSET.x,
        LIGHT_OFFSET.y,
        focusZ + LIGHT_OFFSET.z,
      );
    },
  };
}
