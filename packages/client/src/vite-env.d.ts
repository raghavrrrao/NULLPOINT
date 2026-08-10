/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional URL of a rigged humanoid GLB to use instead of the built-in
   * placeholder character. Unset by default, so no request is made.
   * See `ASSET_CREDITS.md`.
   */
  readonly VITE_CHARACTER_GLB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
