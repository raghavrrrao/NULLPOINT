# ASSET_CREDITS.md — NULLPOINT

Ledger of **every** third-party asset in this repository: models, textures,
animations, audio, fonts, icons and HDRIs.

> **Binding rule (`CLAUDE.md` §8): the entry is added _before_ the asset is
> committed. No entry, no commit.**

**Current state: no third-party assets are in use.** Every table below is empty.

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

> **OPEN (Q19, `PROJECT.md` §6):** whether third-party assets are used at all,
> or all art is self-made. Undecided. This ledger is ready either way.

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
| *(none)* | | | |

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
