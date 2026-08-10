# ASSET_CREDITS.md — NULLPOINT

Ledger of **every** third-party asset in this repository: models, textures,
animations, audio, fonts, icons and HDRIs.

> **Binding rule (`CLAUDE.md` §8): the entry is added _before_ the asset is
> committed. No entry, no commit.**

**Current state: no third-party assets are in use.** Every third-party table
below is empty. The player character, the rifle, the arena and all weapon audio
are self-made placeholders — see §6.

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

*None.*

### 4.2 Textures & materials

*None.*

### 4.3 Animations

*None.*

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
| Placeholder humanoid rig | `packages/client/src/character/rig.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Placeholder locomotion clips | `packages/client/src/character/clips.ts` | Written by hand (Three.js keyframe tracks) | 2026-08-10 |
| Grey-box arena | `packages/client/src/world/arenaLayout.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Placeholder assault rifle | `packages/client/src/combat/RifleModel.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Training range and targets | `packages/client/src/world/trainingRange.ts`, `TrainingTarget.ts` | Written by hand (Three.js primitives) | 2026-08-10 |
| Muzzle flash glow texture | `packages/client/src/combat/MuzzleFlash.ts` | Generated at runtime on a 64 px canvas | 2026-08-10 |
| Weapon sounds (fire, dry fire, reload, hit) | `packages/client/src/audio/AudioSystem.ts` | Synthesised at runtime with Web Audio | 2026-08-10 |

### 6.1 Why the player character is a placeholder

The Phase 1 brief calls for a real CC0 humanoid (Quaternius SWAT or similar) and
says not to spend excessive time acquiring one automatically. Searching found no
**directly downloadable** rigged humanoid with a verifiable licence:

- Quaternius and Kenney distribute through itch.io/Gumroad landing pages with no
  stable direct asset URL.
- three.js ships `Soldier.glb` with locomotion clips, but its `examples/models`
  directory carries **no stated licence**. `CLAUDE.md` §8 forbids using an asset
  whose licence is unclear, so it was not used.
- Bypassing a download gate, CAPTCHA or paywall to obtain one is out of the
  question.

Rather than stall the phase, the prototype ships a clearly-marked procedural
humanoid: a bone hierarchy with box limbs, amber accent parts and a visible nose
wedge so facing is readable, driven by hand-authored `AnimationClip`s through a
normal `AnimationMixer`.

**To replace it with a real asset**, no code changes are required beyond a name
map:

1. Put the GLB somewhere the client serves, e.g. `packages/client/public/models/`.
2. Set `VITE_CHARACTER_GLB=/models/<file>.glb`.
3. Add the asset to §4.1 above **before** committing it.

`loadCharacterAsset()` scales any GLB to `PLAYER_CONFIG.standHeight`, matches
clip names case-insensitively against the usual Mixamo/Quaternius spellings, and
warns about (rather than breaks on) any locomotion state the asset lacks. Until
`VITE_CHARACTER_GLB` is set, **no network request for a character is made**.

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
