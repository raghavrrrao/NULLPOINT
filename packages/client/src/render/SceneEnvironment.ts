import * as THREE from "three";

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

export function createSceneEnvironment(): SceneEnvironment {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151b);
  scene.fog = new THREE.Fog(0x11151b, 60, 190);

  // Generous fill relative to the key light. With a single directional source
  // the corridor and the area under the crouch gate read as black, and a
  // grey-box has to stay legible in exactly those places.
  const hemisphere = new THREE.HemisphereLight(0xa8bed4, 0x3c434c, 1.9);
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffffff, 0.42);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.1);
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
