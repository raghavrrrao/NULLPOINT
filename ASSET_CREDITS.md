# ASSET_CREDITS.md — NULLPOINT

Ledger of **every** third-party asset in this repository: models, textures,
animations, audio, fonts, icons and HDRIs.

> **Binding rule (`CLAUDE.md` §8): the entry is added _before_ the asset is
> committed. No entry, no commit.**

**Current state: one third-party asset is in use** — the Quaternius base
character (§4.1). The rifle, the arena and all weapon audio remain self-made
placeholders — see §6.

---

## 1. Rules

1. **Record before commit.** An asset without a row here does not enter the
   repository.
2. **License must be verified.** Not "probably fine", not "it was free on a
   site". Read the license. Save a copy of the license text in
   `assets/source/licenses/<asset-slug>.txt`.
3. **If the license is unclear or unstated, the asset is not used.** No
   exceptions. Silence is not permission.
4. **Check the attribution requirement.** CC-BY and similar require visible,
   in-product credit — not just a repository file. Those assets are listed in
   §5 and must appear on the in-game credits screen.
5. **No AI-generated asset is committed without recording the tool, the prompt,
   and the tool's output-license terms.**
6. **No hot-linking.** Assets are served from this project's own origin
   (`CLAUDE.md` §8). A remote URL is a source record, never a runtime path.
7. **Modified assets are still third-party.** Record the original and describe
   the modification.
8. **Removed assets are not deleted from this file** — they move to §7 with the
   removal date, so the history stays auditable.

---

## 2. License quick reference

| License | Commercial | Attribution | Share-alike | Usable here |
| ------- | ---------- | ----------- | ----------- | ----------- |
| CC0 / Public Domain | Yes | No | No | ✅ Preferred |
| CC-BY 3.0 / 4.0 | Yes | **Required** | No | ✅ With credit in §5 |
| CC-BY-SA | Yes | **Required** | **Yes** | ⚠️ Ask first — viral terms |
| CC-BY-NC | **No** | Required | No | ⚠️ Personal project only — ask first |
| CC-BY-ND | Yes | Required | No | ⚠️ No modification permitted |
| MIT / Apache-2.0 | Yes | Required (notice) | No | ✅ Common for fonts and code-adjacent assets |
| OFL (fonts) | Yes | Required | Yes (for fonts) | ✅ For fonts |
| "Free for personal use" | No | Varies | — | ⚠️ Read the actual terms — usually not a license |
| Unstated / unknown | — | — | — | ❌ **Never** |

NULLPOINT is a non-commercial personal project (`PROJECT.md` §1), but
**NC-licensed assets are still flagged for a decision** rather than assumed
acceptable — the definition of non-commercial varies by license, and a project
that is later shared publicly can drift across the line.

> **Q19 answered 2026-08-10:** third-party assets **are** acceptable where the
> licence permits this use, with CC0 preferred (Quaternius, Poly Pizza,
> Mixamo-compatible rigs). Licence-unclear assets remain banned outright.

---

## 3. Entry template

Copy this for each new asset.

```markdown
### <asset name>

| Field | Value |
| ----- | ----- |
| File(s) | `assets/source/models/<file>` |
| Type | Model / Texture / Animation / Audio / Font / HDRI |
| Author | <name or handle> |
| Source URL | <permalink> |
| License | <exact SPDX id or license name and version> |
| License copy | `assets/source/licenses/<slug>.txt` |
| Attribution required | Yes / No |
| Date acquired | YYYY-MM-DD |
| Modified | No / Yes — <what was changed> |
| Used in | <where in the game> |
| Notes | <anything relevant> |
```

---

## 4. Assets in use

### 4.1 Models

#### Superhero Male (Universal Base Characters)

| Field | Value |
| ----- | ----- |
| File(s) | `assets/source/models/Superhero_Male_FullBody.gltf`, `Superhero_Male_FullBody.bin` |
| Type | Model — rigged humanoid, 65-bone skeleton, 14,318 triangles |
| Author | Quaternius |
| Source URL | https://quaternius.itch.io/universal-base-characters |
| License | Creative Commons Zero v1.0 Universal (CC0) |
| License URL | https://creativecommons.org/publicdomain/zero/1.0/ |
| Attribution required | No — CC0. Credited here voluntarily. |
| Date acquired | 2026-08-10 |
| Modified | No. The glTF and its buffer are used exactly as supplied; scale, orientation and bone naming are adapted at load time, never in the file. |
| Used in | The player character |
| Notes | Ships with **no animation clips**. Contains no clothing beyond shorts. |

### 4.2 Textures & materials

Supplied with the Quaternius character above, same author, source and CC0
license. Stored in `assets/source/textures/`.

| File | Used for |
| ---- | -------- |
| `T_Superhero_Male_Dark.png` | Body base colour |
| `T_Superhero_Male_Normal.png` | Body normal map |
| `T_Superhero_Male_Roughness.png` | Body roughness/metalness |
| `T_Hair_1_BaseColor.png` | Hair base colour |
| `T_Hair_1_Normal.png` | Hair normal map |
| `T_Eye_Brown.png` | Eye base colour |
| `T_Eye_Normal.png` | Eye normal map |

Also present but **not referenced** by this character, so not bundled:
`T_Hair_2_*`, `T_Superhero_Female_Normal.png`, `T_Superhero_Male_Ligh.png`, and
the `Normals Unity - Godot/` directory (normal maps in other engines'
conventions).

### 4.3 Animations

*None.* The character in §4.1 ships with no animation clips, and no compatibly
licensed clip library has been added. All locomotion is **generated at runtime**
from hand-authored pose data and retargeted onto whichever skeleton is loaded —
self-made, see §6.

### 4.4 Audio

*None.*

### 4.5 Fonts

*None.*

### 4.6 HDRIs & environment maps

*None.*

---

## 5. Attribution required in-product

Assets whose licenses require visible credit inside the game. Each row here
**must** appear on the in-game credits screen before release.

| Asset | Author | License | Credit line |
| ----- | ------ | ------- | ----------- |
| *(none)* | | | |

---

## 6. Self-made assets

Created for this project. No third-party license applies. Listed for
completeness, not obligation.

| Asset | File(s) | Tool | Date |
| ----- | ------- | ---- | ---- |
| Fallback humanoid rig | `packages/client/src/character/rig.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Locomotion pose library | `packages/client/src/character/clips.ts` | Written by hand; retargeted per rig by `retarget.ts` | 2026-08-10 |
| Training bot placeholder | `packages/client/src/entities/CombatBot.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Grey-box arena | `packages/client/src/world/arenaLayout.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Placeholder assault rifle | `packages/client/src/combat/RifleModel.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Training range and targets | `packages/client/src/world/trainingRange.ts`, `TrainingTarget.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Muzzle flash glow texture | `packages/client/src/combat/MuzzleFlash.ts` | Generated at runtime on a 64 px canvas | 2026-08-10 |
| Weapon sounds (fire, dry fire, reload, hit) | `packages/client/src/audio/AudioSystem.ts` | Synthesised at runtime with Web Audio | 2026-08-10 |

### 6.1 The player character, and why a procedural one is still here

**Superseded 2026-08-10.** The player character is now the CC0 Quaternius asset
in §4.1. The procedural humanoid described below remains in the codebase as the
**fallback** when the asset fails to load, and it is the second rig that keeps
the posing code honest about what it assumes.

The original reason for the placeholder is kept because it still governs how
assets are acquired: the Phase 1 brief called for a real CC0 humanoid, and
searching found no **directly downloadable** rigged humanoid with a verifiable
licence.

- Quaternius and Kenney distribute through itch.io/Gumroad landing pages with no
  stable direct asset URL. The asset in §4.1 reached the project because the
  developer downloaded it and placed it in `assets/source/`.
- three.js ships `Soldier.glb` with locomotion clips, but its `examples/models`
  directory carries **no stated licence**. `CLAUDE.md` §8 forbids using an asset
  whose licence is unclear, so it was not used.
- Bypassing a download gate, CAPTCHA or paywall to obtain one is out of the
  question.

The fallback itself is a bone hierarchy with box limbs, amber accent parts and a
visible nose wedge so facing is readable, driven by hand-authored
`AnimationClip`s through a normal `AnimationMixer`.

**To replace the character with a different asset:**

1. Put the GLB where the client can serve it, e.g.
   `packages/client/public/models/`.
2. Set `VITE_CHARACTER_GLB=/models/<file>.glb`, which overrides the bundled
   asset.
3. Add a bone map for its skeleton in
   `packages/client/src/character/humanoidRig.ts` if its naming differs.
4. Add the asset to §4.1 above **before** committing it.

`loadCharacterAsset()` normalises any rig to `PLAYER_CONFIG.standHeight`, matches
clip names case-insensitively against the usual Mixamo/Quaternius spellings, and
warns about (rather than breaks on) any locomotion state the asset lacks.

### 6.2 Why the rifle is a placeholder (Phase 2)

Same reason and same rule. No weapon model with a verifiable licence is in the
repository, and the Phase 2 brief forbids stalling the phase on asset
acquisition or bypassing any download gate to obtain one.

`RifleModel.ts` builds a low-poly rifle from eight boxes plus an empty at the
barrel tip. The amber magazine matches the character's placeholder accents, so
it reads as temporary at a glance.

**To replace it with a real asset**, only `RifleModel.ts` changes: load the GLB,
return its root and an object positioned at the muzzle. Nothing else in the
combat system refers to the weapon's geometry — `WeaponSystem` only ever touches
`root` and `muzzle`. Record the asset in §4.1 **before** committing it.

### 6.3 Why the weapon audio is synthesised

No licensed weapon audio is present. `AudioSystem` synthesises short
approximations with Web Audio — a filtered noise burst plus a pitch sweep for
the shot, filtered clicks for reload and dry fire.

`GameSound` is the seam: combat code calls `play(GameSound.WeaponFire)` and
knows nothing about how the sound is made, so swapping in real samples touches
only `AudioSystem.ts`. There is also a silent fallback for when `AudioContext`
is unavailable, so audio can never block combat.

---

## 7. Removed assets

Kept for audit history. Never delete a row from here.

| Asset | License | Added | Removed | Reason |
| ----- | ------- | ----- | ------- | ------ |
| *(none)* | | | | |

---

## 8. Software dependency licenses

Runtime code dependencies, tracked separately from art assets. The approved
stack (`CLAUDE.md` §4); versions are pinned once Phase 1 installs them.

| Package | License | Role |
| ------- | ------- | ---- |
| `three` | MIT | Rendering |
| `@dimforge/rapier3d-compat` | Apache-2.0 | Physics |
| `ws` | MIT | Server WebSockets |
| `firebase` | Apache-2.0 | Client auth and persistence |
| `firebase-admin` | Apache-2.0 | Server-side token verification |
| `typescript` | Apache-2.0 | Language tooling (dev) |
| `vite` | MIT | Client bundler (dev) |
| `@playwright/test` | Apache-2.0 | E2E testing (dev) |

Licenses stated from each project's published terms and **re-verified at install
time in Phase 1**, when exact versions are pinned. A new dependency requires
explicit approval (`CLAUDE.md` §4) and a row here.
