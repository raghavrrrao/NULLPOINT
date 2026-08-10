import * as THREE from "three";

import { CAMERA_CONFIG } from "@nullpoint/shared";

/**
 * Owns the WebGL renderer, the perspective camera and the canvas sizing.
 *
 * Deliberately thin: a prototype does not need a render-graph abstraction, and
 * `ARCHITECTURE.md` §12 rules out building an engine layer over Three.js.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly onResize = (): void => this.resize();

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      // Kept so Playwright can read pixels back without a separate render pass.
      preserveDrawingBuffer: true,
    });

    // Capping at 2 keeps 4K and Retina displays from quadrupling fragment cost
    // for a difference nobody can see at this art fidelity.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated as of three 0.185 and now silently falls
    // back to PCF anyway; asking for PCF directly avoids the console warning.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.fov,
      1,
      CAMERA_CONFIG.near,
      CAMERA_CONFIG.far,
    );

    container.appendChild(this.renderer.domElement);
    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene): void {
    this.renderer.render(scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
