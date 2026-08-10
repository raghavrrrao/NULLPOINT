/**
 * Resolves the character asset's files to URLs the browser can fetch.
 *
 * The source glTF references its `.bin` and its textures by **bare filename**,
 * and Vite fingerprints emitted assets, so those relative references cannot
 * resolve on their own — in a production build `Superhero_Male_FullBody.bin`
 * no longer exists at that path.
 *
 * Rather than copying the asset into `public/` (two copies to keep in sync) or
 * editing the glTF (the source stays pristine), each file is imported for its
 * URL so the bundler emits and fingerprints it. A basename → URL map is built
 * once, and `GLTFLoader` is pointed at it through a `LoadingManager`, which
 * behaves identically in dev and in the build.
 *
 * Imports are listed explicitly rather than globbed: the texture directory also
 * holds variants for other characters and other engines, and a glob would ship
 * about 13 MB of images this character never references.
 */

import gltfUrl from "../../../../assets/source/models/Superhero_Male_FullBody.gltf?url";
import binUrl from "../../../../assets/source/models/Superhero_Male_FullBody.bin?url";
import bodyBaseColorUrl from "../../../../assets/source/textures/T_Superhero_Male_Dark.png?url";
import bodyNormalUrl from "../../../../assets/source/textures/T_Superhero_Male_Normal.png?url";
import bodyRoughnessUrl from "../../../../assets/source/textures/T_Superhero_Male_Roughness.png?url";
import hairBaseColorUrl from "../../../../assets/source/textures/T_Hair_1_BaseColor.png?url";
import hairNormalUrl from "../../../../assets/source/textures/T_Hair_1_Normal.png?url";
import eyeBaseColorUrl from "../../../../assets/source/textures/T_Eye_Brown.png?url";
import eyeNormalUrl from "../../../../assets/source/textures/T_Eye_Normal.png?url";

/**
 * Canonical lower-case basename → emitted URL.
 *
 * Keys are written as the **glTF** requests them. Two of its texture URIs carry
 * an extra `_png` before the extension — a Blender exporter artefact — which
 * `canonicalise` strips so both spellings land on the same entry.
 */
const URL_BY_NAME = new Map<string, string>([
  ["superhero_male_fullbody.gltf", gltfUrl],
  ["superhero_male_fullbody.bin", binUrl],
  ["t_superhero_male_dark.png", bodyBaseColorUrl],
  ["t_superhero_male_normal.png", bodyNormalUrl],
  ["t_superhero_male_roughness.png", bodyRoughnessUrl],
  ["t_hair_1_basecolor.png", hairBaseColorUrl],
  ["t_hair_1_normal.png", hairNormalUrl],
  ["t_eye_brown.png", eyeBaseColorUrl],
  ["t_eye_normal.png", eyeNormalUrl],
]);

function canonicalise(fileName: string): string {
  return fileName.replace(/_png\.png$/i, ".png").toLowerCase();
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

/** The character glTF's emitted URL. */
export const CHARACTER_GLTF_URL: string = gltfUrl;

/**
 * Maps a URL requested by `GLTFLoader` onto the emitted asset.
 *
 * The loader resolves the glTF's relative references against the glTF's own
 * URL, so requests arrive looking like `/assets/<hash>/T_Eye_Normal_png.png`.
 * Only the basename is meaningful. Anything unrecognised passes through
 * untouched so unrelated loads still work.
 */
export function resolveCharacterResource(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  return URL_BY_NAME.get(canonicalise(basename(withoutQuery))) ?? url;
}

/** Files the bundler emitted for the character. Development hook. */
export const CHARACTER_ASSET_FILE_COUNT = URL_BY_NAME.size;
