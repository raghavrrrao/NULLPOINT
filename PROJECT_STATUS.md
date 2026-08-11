# PROJECT_STATUS.md — NULLPOINT

**Last updated:** 2026-08-10
**Current phase:** Phase 5 Session A — Multiplayer Foundation ✅ **complete**
Sessions B–D (transport, simulation, prediction, combat) ⛔ **not started**
**Next phase:** ⛔ **none started — awaiting explicit go-ahead.** See the
numbering note below: the developer used "Phase 3" for character integration,
which collides with the roadmap's Phase 3 (Server Core & Transport). That phase
is untouched and still not started.

> **Phases 1 and 2 were redefined by the developer** on 2026-08-10. Phase 1 now
> means "first playable single-player third-person prototype", merging the
> original Phase 1 (Toolchain & Workspace) with the original Phase 2 (Client
> Sandbox). Phase 2 now means "first playable single-player combat". Phases 3–10
> keep their original numbering and scope, so the later Phase 5 (networked,
> server-authoritative combat) still stands — Phase 2 is its single-player
> foundation, not a replacement.

> **Numbering collision, unresolved (2026-08-10).** The developer directed a
> "Phase 3: Real Character Integration". The roadmap below already assigns
> Phase 3 to Server Core & Transport. The character work is recorded under its
> own heading, **out of roadmap order**, and no roadmap phase has been
> renumbered — renumbering would invalidate 60-odd cross-references across the
> canonical documents, and how to resolve it is the developer's call, not an
> assumption to be made here. Recorded as **Q23** in `PROJECT.md` §6.

> Per `CLAUDE.md` §2: **no phase begins until the developer explicitly says to
> start it.** A phase is complete only when *every* exit criterion is true.
> Partial completion is reported as partial.

---

## Progress

| Phase | Name | Status |
| ----- | ---- | ------ |
| 0 | Foundation & Documentation | ✅ Complete |
| 1 | Toolchain & First Playable Third-Person Prototype | ✅ Complete |
| 2 | First Playable Combat (single-player) | ✅ Complete |
| — | Real Character Integration *(out of roadmap order — see note above)* | ✅ Complete |
| — | Natural TPP Locomotion + Combat Sandbox *(out of roadmap order)* | ✅ Complete |
| — | Camera & Mouse-Look Stabilisation *(out of roadmap order)* | ✅ Complete |
| — | Map 01 — Playable Combat Map *(out of roadmap order)* | ✅ Complete |
| — | Phase 5 Session A — Multiplayer Foundation | ✅ Complete |
| 3 | Server Core & Transport | ⛔ Not started |
| 4 | Networked Movement — **first playable multiplayer** | ⛔ Not started |
| 5 | Combat | ⛔ Not started |
| 6 | Match Flow | ⛔ Not started |
| 7 | Firebase Identity & Persistence | ⛔ Not started |
| 8 | Assets & Content | ⛔ Not started |
| 9 | Polish — audio, UI, performance | ⛔ Not started |
| 10 | Hardening & Deployment | ⛔ Not started |

Legend: ✅ complete · 🔄 in progress · ⛔ not started · ⏸️ blocked

---

## Phase 0 — Foundation & Documentation ✅

**Goal:** Establish the rules, the shape of the system, and the directory
structure before any application code exists.

**Delivered**

- Directory skeleton for `packages/{shared,client,server}`, `assets/`, `tools/`,
  `tests/`, `docs/`.
- `CLAUDE.md` — binding development rules.
- `PROJECT.md` — what the game is, scope, pillars, open questions.
- `ARCHITECTURE.md` — client, server, networking, physics, assets, Firebase, testing.
- `PROJECT_STATUS.md` — this file.
- `NETWORK_PROTOCOL.md` — v1 wire specification.
- `ASSET_CREDITS.md` — third-party asset ledger (empty, structure in place).
- `README.md` (expanded from the existing one-line placeholder), `.gitignore`,
  `.editorconfig`.

**Pre-existing state found on inspection**

The directory was not bare. It already contained:

- A git repository on branch **`master`**, with remote `origin` pointing at
  `https://github.com/raghavrrrao/NULLPOINT.git` and one commit (`dfc8e6f`,
  "first commit") containing a single-line placeholder `README.md`.
- `.claude/skills/playwright-cli/` — Claude Code tooling configuration.
- An empty `.playwright/` directory.

**Nothing has been committed or pushed** — commits happen only when the
developer asks (`CLAUDE.md` §10).

> **Discrepancy to resolve:** `CLAUDE.md` §10 says "`main` stays working", but
> the repository's default branch is `master` and the remote tracks
> `origin/master`. One of the two must change. **Awaiting the developer's
> decision** — no branch was renamed.

**Exit criteria** — all met

- [x] Directory inspected before creation; pre-existing contents recorded above.
- [x] All six canonical documents exist.
- [x] No application code written.
- [x] No dependencies installed.
- [x] Undecided design is recorded as an **OPEN** question, never assumed.
- [x] Documents reviewed against each other for contradictions.

---

## Phase 1 — Toolchain & First Playable Third-Person Prototype ✅

**Goal:** A repository that builds, type-checks and tests, and a playable
single-player third-person prototype whose movement, camera and physics already
feel correct.

**Redefined by the developer on 2026-08-10**, merging the original Phase 1
(Toolchain & Workspace) and Phase 2 (Client Sandbox). Multiplayer, Firebase,
weapons and audio were explicitly excluded.

**Unblocked by:** Q9, Q12 and Q19, all answered in `PROJECT.md` §6 by the
Phase 1 brief.

### Delivered — toolchain

- npm workspaces: `@nullpoint/shared`, `@nullpoint/client`. The `server`
  package is intentionally **not** created yet — it has no code until Phase 3,
  and an empty package breaks `tsc --build`.
- TypeScript strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, plus `noUnusedLocals`, `noUnusedParameters` and
  `verbatimModuleSyntax`. Zero `any`, zero non-null assertions.
- Vite 8 for the client; Node's built-in test runner for unit tests; Playwright
  for end-to-end.
- The project logger in `shared/src/util/logger.ts` — the only sanctioned
  `console` usage. No `console.log` anywhere.
- Scripts: `dev`, `build`, `preview`, `typecheck`, `test`, `test:e2e`.

### Delivered — prototype

- **Rendering:** WebGL2, capped device pixel ratio, resize handling, PCF shadow
  maps, sRGB output, ACES tone mapping, hemisphere + ambient fill + directional
  key light whose shadow frustum follows the player.
- **Physics:** Rapier 0.20 kinematic capsule with a `KinematicCharacterController`
  (autostep, ground snapping, slope limits). Rapier's own gravity is zero —
  gravity lives in the shared simulation so the server can run it identically.
- **Movement:** camera-relative, acceleration/deceleration, walk/run/sprint/crouch
  speeds, air control, coyote time, jump buffering. All of it in
  `packages/shared/src/sim/movement.ts`, free of Three.js, Rapier and the DOM.
- **Camera:** over-the-shoulder boom, mouse orbit under pointer lock, clamped
  pitch, exponential follow smoothing, sphere-cast collision that pulls in
  instantly and eases back out. The player's own capsule is excluded from the
  sweep, the collision result is never overridden upward, and a compressed boom
  lifts over the character rather than jamming into the back of their head.
- **Character:** procedural humanoid rig with authored `AnimationClip`s played
  through `AnimationMixer` with cross-fades and speed-scaled playback. Covers
  IDLE, WALK, RUN, SPRINT, JUMP, FALL and CROUCH.
- **Arena:** grey-box built from one data table, so every mesh has a matching
  collider by construction — perimeter walls, ramp to an elevated platform,
  staircase to a ledge, crouch gate, tight corridor, inside corner, pillars and
  graded crates.
- **HUD:** temporary development overlay — FPS, frame time, worst frame, physics
  ms, draw calls, triangles, movement state, grounded, speed, position, velocity,
  character source. `F3` toggles it.

### Exit criteria — all met

- [x] `npm run typecheck` passes with zero errors.
- [x] `npm run build` produces a client bundle.
- [x] `npm test` passes — 45 unit tests (88 as of Phase 2).
- [x] `npm run test:e2e` passes — 31 Playwright tests in real Chromium (64 as of Phase 2).
- [x] `shared` is imported by `client`; `client` imports nothing from a server.
- [x] No `any`, no non-null assertions, no `console.log` in committed code.
- [x] Lockfile committed; every dependency version exact-pinned.
- [x] Dev server starts and the game loads in Chromium.
- [x] Arena and a visible third-person humanoid render correctly.
- [x] WASD movement works and is camera-relative.
- [x] Sprint, walk modifier, jump, crouch and gravity all work.
- [x] Ground detection, wall collision, stairs and ramps all work.
- [x] Camera orbits, smooths, clamps pitch and does not clip through geometry.
- [x] Pointer lock engages on click and releases on Escape without stuck keys.
- [x] Idle, walk, run, sprint, jump, fall and crouch animations all play.
- [x] Movement is frame-rate independent — unit-tested at 30, 60 and 144 Hz.
- [x] Browser resize works.
- [x] No uncaught browser errors and no failed network requests.
- [x] **Measured 60 FPS at 1280×720 in Chrome with a GPU** — median frame time
      16.5 ms, p95 21.7 ms, physics step 0.3–0.9 ms, 87 draw calls, ~1000 triangles.
      *(`PROJECT.md` §5's 1080p figure remains an assumption — **Q21** stands.)*

### Deviations from `ARCHITECTURE.md`, and why

Recorded rather than silently absorbed:

1. **No TypeScript project references.** A single root `tsconfig.json` covers all
   packages. Project references need each package to emit declarations, which is
   pointless while `shared` is consumed as source. Revisit in Phase 3 when the
   server package lands.
2. **`shared` is consumed through a path alias, not a built package.** Vite and
   `tsc` both map `@nullpoint/shared` to `packages/shared/src`. Keeps HMR working
   across the boundary and removes a build step; the one-way dependency rule is
   unchanged.
3. **Three client directories added** beyond those listed in `ARCHITECTURE.md` §2:
   `character/` (rig, clips, asset loading, animation control), `physics/`
   (Rapier world and queries) and `world/` (arena data and construction).
   `net/` and `audio/` remain empty, awaiting Phases 3 and 9.
4. **The `server` package is not scaffolded.** See above.

### Camera collision — fixed after manual testing (2026-08-10)

Two defects were reported from manual play and fixed:

1. **Jumping pulled the camera in on open ground.** The collision sweep starts
   at the pivot, which is inside the character, and the player's own collider was
   not excluded. While rising, the damped pivot lagged to torso height where the
   capsule is at full radius, the probe sphere started penetrating, and Rapier's
   `stopAtPenetration` reported a time-of-impact of zero. Measured: the boom
   collapsed from 5.03 m to 1.07 m for the whole ascent.
2. **`minDistance` was applied as a lower clamp on the collision result**, so a
   boom shorter than the floor was extended back out *through* whatever the sweep
   had just hit. Measured: cornered against a wall whose face is at z = 29.5, the
   camera sat at z = 29.64.

A minimum distance can never be enforced by overriding a collision result. It is
now earned by tilting the boom up over the character when space behind runs out,
and `minDistance` is a small floor that is itself capped by the contact distance.

### Known limitations

- **A player pressed flat against a tall wall still gets a close, steeply
  overhead camera** (boom ≈ 0.4–0.5 m at the capsule's contact limit). With only
  ~0.36 m between the pivot and the wall, and a 0.22 m probe sphere, no camera
  position exists that is both further back and outside the wall. The camera
  stays out of geometry, which is the property that matters; framing in that
  pocket is inherently poor. Fading the character out at very short boom lengths
  would be the next step, and belongs with the art pass in Phase 8/9.
- Cornering produces a noticeable rise to ~72°. This is deliberate and is the
  only way to keep a usable distance without clipping, but it is a large view
  change; the rate is tunable via `CAMERA_CONFIG.liftDamp`.
- The over-the-shoulder lateral offset is not reduced as the boom shortens, so a
  fully compressed camera is still offset ~0.55 m to the side.
- ~~The character is a **procedural placeholder**, not a licensed rigged asset.~~
  **Resolved 2026-08-10** by the character integration below; the procedural rig
  is now only the fallback. See `ASSET_CREDITS.md` §4.1.
- The client bundle is ~3.5 MB (~1.26 MB gzipped), dominated by Rapier's inlined
  WASM and Three.js. No code splitting yet — a Phase 9 concern.
- `@types/three` pulls in a second, older copy of `@dimforge/rapier3d-compat`
  (0.12.0) at the workspace root. The client resolves the pinned 0.20.0 from its
  own `node_modules`; the duplicate is unused but present in the lockfile.
- Headless Chromium has no GPU and renders at roughly 12 FPS through SwiftShader.
  End-to-end tests therefore wait on game state, never on frame counts.

---

## Phase 2 — First Playable Combat ✅

**Goal:** The first complete single-player combat loop — equip, aim, fire, hit,
reload — on top of the Phase 1 controller, without rebuilding any of it.

**Redefined by the developer on 2026-08-10.** This is not the original Phase 2
(Client Sandbox, retired into Phase 1) but a new single-player combat phase.
Multiplayer, networking, Firebase and server authority remain out of scope.

### Weapon architecture

All weapon *rules* live in `packages/shared/src/combat`, free of Three.js,
Rapier and the DOM:

| Module | Owns |
| ------ | ---- |
| `weapon.ts` | `WeaponDefinition` — every tunable number for a weapon |
| `weaponState.ts` | The state machine: IDLE / FIRING / RELOADING / EMPTY, fire rate, ammunition, reload |
| `ballistics.ts` | Damage falloff, spread cone, recoil accumulation and recovery, seeded PRNG |
| `damage.ts` | The `Damageable` contract and the `applyDamage` arithmetic |

The client half is orchestration only: `WeaponSystem` connects those rules to the
physics world and the renderer. That split is deliberate — Phase 4 moves damage
behind server authority, and the rules should move without being rewritten
(Phase 2 brief §30). Nothing in the shared half trusts its caller: damage clamps
and rejects non-finite input, and the movement speed multiplier is clamped too.

Adding a second weapon means adding a `WeaponDefinition`, not touching any of
the above.

### Rifle configuration

| Setting | Value |
| ------- | ----- |
| Damage | 25 (four hits kill a 100 HP target) |
| Fire rate | 700 RPM, automatic |
| Magazine / reserve | 30 / 120 |
| Reload | 2.1 s |
| Range | 120 m, full damage to 40 m, ×0.55 at maximum |
| Spread | 0.006 rad aimed, 0.038 rad from the hip |
| Recoil | 0.013 rad/shot pitch, capped at 0.24, recovers at 7/s |
| Aim | FOV 72 → 54, boom 5.0 → 2.1 m, movement ×0.55 |

### Delivered

- **Aiming from the camera, not the character.** A ray from screen centre finds
  the world point under the crosshair; the shot is then traced from the *muzzle*
  toward that point, so shots agree with the crosshair despite the weapon sitting
  half a metre from the eye.
- **Hitscan** against Rapier, resolved through a collider-handle → `Damageable`
  registry, so the physics layer knows nothing about targets and the weapon knows
  nothing about colliders.
- **Five training targets** — close, medium, long, behind cover, elevated — plus a
  narrow firing lane, an open lane and a backstop.
- **Feedback:** pooled muzzle flash, pooled tracers and impact marks, hit marker,
  kill marker, target flash/kick/tip-over, health bars, synthesised audio.
- **Combat HUD** (crosshair that tightens on aim, hit marker, ammunition) kept
  separate from the development HUD, which gained weapon, ammo, state, aim,
  target and last-damage lines.
- **Upper-body weapon pose** applied after the animation mixer, so the character
  carries and aims the rifle while the legs keep running the Phase 1 locomotion
  clips untouched.

### Exit criteria — all met

- [x] Rifle equipped, visible, and follows the character's movement and rotation.
- [x] Aim mode: smooth blend of FOV, boom length, shoulder offset and pivot.
- [x] Camera collision, jump-boom, self-collider and lift behaviour all unchanged.
- [x] Crosshair, hit marker on a hit, no marker on a miss.
- [x] Left mouse fires, automatic, fire rate enforced and frame-rate independent.
- [x] Hitscan works; camera-based aiming works; muzzle flash, recoil and spread work.
- [x] All five targets take damage; damage is exactly 25 inside falloff.
- [x] Magazine decrements, reserve works, empty magazine prevents firing.
- [x] Reload works, moves the right rounds, and blocks firing while it runs.
- [x] Weapon state machine prevents every invalid combination.
- [x] Debug HUD shows weapon state and ammunition.
- [x] Audio abstraction works, with a silent fallback.
- [x] No console errors; typecheck, unit tests, build and Playwright all pass.
- [x] **Measured 60 FPS under sustained fire** — median frame 16.6 ms, p95 20.7 ms,
      physics 0.4–3.5 ms, ~118 draw calls.

### Bugs found during verification, and fixed

1. **Fire rate quantised to the frame rate.** Clamping the shot cooldown at zero
   discarded the sub-tick remainder, so 700 RPM fired at 600. The remainder is
   now carried, with a guard so credit cannot bank up while the trigger is
   released.
2. **Aiming threw the shot off the crosshair.** The camera looked *at* the pivot,
   so changing boom length and shoulder offset rotated the view. Orientation now
   comes from yaw and pitch directly — screen centre means the aim direction and
   nothing else.
3. **The anti-corner camera lift fired on every aim.** The aim boom (2.1 m) is
   shorter than `comfortableDistance` (2.4 m), which looked like an obstruction
   and tilted the view 13° up. The comfort threshold is now capped by the boom
   length actually wanted.
4. **Destroyed targets still blocked shots.** The plate tipped over visually while
   its collider stayed upright, silently absorbing everything aimed behind it.
   The collider is now disabled on death and restored on reset.
5. **The three range targets were collinear** from the firing line, so the near
   plate absorbed every round aimed at the two behind it. They are now staggered
   in z, measured from the camera rather than the player because the
   over-the-shoulder offset moves the eye ~0.8 m sideways.
6. **The new range geometry reached into ground a Phase 1 test relied on.** A lane
   wall crossed x = 0, blocking the approach the cornered-camera regression test
   walks down. The lane was shortened.
7. **Arm pose rotations were inverted**, pointing the arms behind the character,
   and the carry tilt raised the muzzle 26° skyward. Both signs corrected.

### Known limitations

- The rifle and all weapon audio are **placeholders** (`ASSET_CREDITS.md` §6.2,
  §6.3), as is the character.
- **Camera/muzzle parallax near cover.** The crosshair ray starts at the camera
  and the bullet starts at the muzzle, roughly a metre apart, so at a cover edge
  the two can disagree about what is blocked. This is inherent to third person
  rather than a defect, and every commercial TPS lives with some version of it.
  Aiming at the muzzle's own line instead would decouple the shot from the
  crosshair, which is worse.
- The weapon mounts on the **chest**, not the hand. Hanging it off the hand makes
  it inherit the whole arm chain's rotation and need a counter-transform that
  breaks whenever an arm angle is touched. The arms are posed to meet the weapon
  instead. A real rigged GLB should bring its own aim poses and hand attachment.
- Recoil fully recovers to the original aim, so a burst climbs and settles rather
  than requiring the player to pull down. Predictable and testable, but less
  demanding than a real shooter.
- Damage is applied **client-side**. That is correct for a single-player phase and
  the architecture is ready to move it, but nothing is authoritative yet.
- No weapon switching, inventory, or second weapon — one rifle, by design.
- Targets are stationary with no AI, and there is no player health, death or
  respawn; those belong to Phases 5 and 6.

---

### Character and weapon handling polish (2026-08-10)

A follow-up pass on presentation only; the combat rules were not touched.

**The problem.** The rifle sat diagonally across the torso and did not connect to
the hands, and the character rotated to face the camera every frame like a
turret on a base.

**Weapon handling.** The chain was inverted. It used to pose the arms from
hand-authored angles and mount the weapon at a fixed chest offset, hoping the
two would line up. It now runs:

```
aim direction  →  weapon transform  →  grip points  →  two-bone arm IK  →  hands
```

The weapon is placed first from the aim direction, and both arms are solved onto
grip anchors on the weapon itself, so the grip is correct by construction rather
than by tuning. Measured hand-to-grip error is **0.000 m** in every stance except
sprint (0.07 m, where the carry is deliberately across the body).

Three stances — HIP, AIM and SPRINT — blend by two independent weights, so
aiming out of a sprint pulls the weapon up smoothly without a special case.

**Character rotation.** Replaced "face the camera while aiming" with a deadzone
model, which is the main thing separating a prototype from a shooter:

- Moving: the legs follow the direction of travel, or the aim direction while
  aiming so a strafing player keeps the weapon on target.
- Standing: the legs hold still while the torso absorbs the offset, and only
  turn once the aim leaves the deadzone (48° aiming, 85° at the hip). The turn
  over-rotates slightly past the limit so the aim is not left pinned to the edge.
- Every turn is capped by `maxTurnSpeed`, because exponential damping alone
  starts a large swing with a lurch.

**Upper body.** The torso twists up to 55° toward the aim and pitches with it;
the head takes the remainder, so the character keeps watching the target even
when the torso has run out of twist. Legs stay entirely on the locomotion clips.

**Rig correction.** The bone table had the left and right sides mirrored: with a
−Z forward axis the character's right is +X, but `ArmR` sat at −X. The weapon was
therefore held on the side away from the camera's shoulder offset and hid behind
the torso. Sides are now correct and the weapon is visible over the shoulder.

**Camera.** Aim framing widened from 2.1 m / 54° to 2.7 m / 58°, where the body
no longer dominates the frame. All Phase 1 collision behaviour is untouched and
still passes its regression tests.

**Prepared for a real character.** `AttachmentPoint` names the sockets
semantically (`RIGHT_HAND`, `LEFT_HAND`, `WEAPON_SOCKET`, `HEAD`) and arm
segment lengths are read from the joint table, so a rigged GLB maps its own
bones without the weapon system knowing anything about placeholder geometry.

**Remaining limitations.**

- The mannequin is boxy and roughly as wide as the rifle is long, so from
  directly behind the weapon is largely occluded — it points away from the
  camera and is foreshortened. A real character with human proportions fixes
  this; further tuning of the placeholder is not worth the effort
  (`ASSET_CREDITS.md` §6.1). **Resolved 2026-08-10** — the real character has
  human proportions.
- The support hand falls ~0.07 m short of its grip during sprint, where the
  weapon is carried across the body at the edge of the arm's reach.
- There are no dedicated fire or reload animations; the weapon kick and the
  recoil offset carry that feedback.

---

## Real Character Integration ✅

**Directed by the developer on 2026-08-10 as "Phase 3".** Out of roadmap order —
see the numbering note at the top of this file. It does not begin, replace or
partially deliver the roadmap's Phase 3 (Server Core & Transport) below, and it
touches nothing networked.

**Goal:** replace the procedural mannequin with a real rigged humanoid, driving
it through the existing camera, movement, weapon and IK systems rather than
rebuilding those around the asset.

### The asset

| Field | Value |
| ----- | ----- |
| Asset | Superhero Male, from *Universal Base Characters* |
| Author | Quaternius |
| Source | https://quaternius.itch.io/universal-base-characters |
| License | **CC0 1.0 Universal** |
| Format | glTF 2.0 + external `.bin` + 7 PNG textures |
| Geometry | 3 skinned meshes, 14,318 triangles |
| Skeleton | 65 bones, Unreal-style naming |
| Animation clips | **none** |
| Source height | 1.8196 m, feet at y = −0.0095 |
| Axes | up +Y, forward +Z |

Recorded in full in `ASSET_CREDITS.md` §4.1–4.2. The source files are used
exactly as supplied — nothing renamed, moved or edited.

### Delivered

Four adapters, each isolating one mismatch between the asset and the engine.

**Asset URL resolution** — `client/src/character/characterAssets.ts`. The glTF
references its buffer and textures by bare filename, and Vite fingerprints
emitted assets, so those relative paths cannot resolve in a build. Each file is
imported for its URL so the bundler emits it, and a basename → URL map is fed to
`GLTFLoader` through a `LoadingManager`. This also absorbs an exporter artefact
where the glTF asks for `*_png.png` but the file on disk is `*.png`. Imports are
explicit rather than globbed: the texture directory holds variants for other
characters and other engines, and a glob shipped ~13 MB the character never
references.

**Semantic bone mapping** — `client/src/character/humanoidRig.ts`. A fixed
vocabulary (root, pelvis, spine, chest, neck, head, and left/right upper arm,
forearm, hand, thigh, shin, foot) mapped onto the asset's names. Gameplay code
never sees a bone name. A missing required joint fails the load rather than
substituting a plausible neighbour.

| Semantic joint | Quaternius bone |
| -------------- | --------------- |
| root · pelvis | `root` · `pelvis` |
| spine · chest | `spine_01` · `spine_03` |
| neck · head | `neck_01` · `Head` |
| upper arm · forearm · hand | `upperarm_*` · `lowerarm_*` · `hand_*` |
| thigh · shin · foot | `thigh_*` · `calf_*` · `foot_*` |

**Orientation** — the glTF specification places an asset's front on **+Z**;
NULLPOINT uses **−Z** (`CLAUDE.md` §5, corrected in this change: it previously
described −Z as the glTF convention, which is wrong). The half-turn is applied
once to a model-root group above the skeleton, never to individual bones. A
frame node under the chest carries the inverse, so weapon stance offsets stay
written in character space and work unchanged for both rigs.

**Scale and grounding** — normalised 1.8196 m → 1.8 m (×0.9892) to match
`PLAYER_CONFIG.standHeight`, then shifted so the lowest vertex sits on the
character's ground plane. The physics capsule was not touched.

**Arm IK generalised** — the two-bone solver's mathematics is unchanged. What was
hard-coded, the direction a bone points at rest, is now a per-chain property: the
mannequin's limbs hang along −Y, the Quaternius bones run along +Y toward their
child. Both rigs remain valid, and the placeholder is still the fallback when the
asset fails to load. Two robustness fixes fell out of the real skeleton:
`setFromUnitVectors` has no defined answer when a bone's rest axis is exactly
opposite its target, so the bend plane's normal now picks the axis deliberately;
and elbow poles are expressed in character space rather than chest-local space,
because a pole written against a bone's own axes lands on the wrong side as soon
as an asset with a different forward axis is loaded.

### Measured

Hand-to-grip error, metres, via the existing development hook:

| Stance | Right | Left |
| ------ | ----- | ---- |
| Aiming — level, up, down | 0.0000 | 0.0000 |
| Crouch + aim | 0.0000 | 0.0000 |
| Jump + aim | 0.0000 | 0.0000 |
| 360° sweep, worst sample | 0.0000 | 0.0000 |
| Hip idle / running | 0.0000 | 0.0079 |
| Sprinting | 0.0000 | 0.0346 |

Barrel direction tracks `−sin(aimPitch)` while shouldered. Feet sit at 0.095 m
(the ankle joint's natural height above the sole), symmetric to 2 dp. 58–60 FPS,
~99 draw calls, ~29,700 triangles including the shadow pass — up from ~1,400
with the placeholder.

### Known limitations

- **No animations.** The asset ships zero clips, so the character holds its bind
  pose: legs straight, torso upright, arms driven entirely by the weapon IK.
  Locomotion, jump and fall have no visual representation. Nothing here invents
  animation data (`CLAUDE.md` §3).
- **Crouch has no visual pose,** and this breaks one Phase 2 test — see
  Regressions below. The capsule shrinks and the camera lowers correctly, so the
  player can still move under low cover, but the mesh stays standing and the head
  visibly sits above the crouched collider. A procedural knee-bend was attempted
  and reverted: it moved the pelvis without the thigh following, which lifted the
  feet ~0.09 m off the floor.
- **The base character wears only shorts.** It is a base mesh, not a soldier.
- The support hand sits ~0.03 m off its grip while sprinting, where the weapon is
  carried across the body at the edge of the arm's 0.495 m reach.
- Triangle count is the project's first real geometry budget. No measurable
  frame-time cost at this scale.

### Regressions

- `combat.spec.ts` › "crouching folds the torso forward, not backward"
  **fails.** It asserts that the crouch clip folds the spine; with no clips the
  spine holds its bind rotation in both stances, so the two readings are
  identical. The test has been left failing rather than weakened
  (`CLAUDE.md` §9) — it is a true statement about behaviour the asset cannot
  currently provide, and it should pass again once crouch clips exist.
  **Decision needed from the developer:** leave it red, or skip it with a
  documented reason until animations land.
- `combat.spec.ts` › "deals the configured damage per hit" was flaky and is
  fixed. It polled from the test process while holding an automatic trigger; a
  poll costs a round trip, four hits destroy the plate, and the heavier scene
  slowed the headless frame rate enough that the poll began landing after the
  target died. It now samples per frame inside the page and asserts on the first
  round fired — a tighter test, not a relaxed one.

---

## Natural TPP Locomotion + Combat Sandbox ✅

**Directed by the developer on 2026-08-10 as "Phase 3B".** Out of roadmap order,
like the character integration above; the roadmap's Phase 3 (Server Core &
Transport) is still untouched and still not started. Nothing here is networked.

**Goal:** make the third-person character actually move like one, then give it
something to fight.

### Locomotion

The Quaternius character ships **no animation clips** and `assets/source/animations/`
is empty, so per the brief's fallback the locomotion is generated rather than
imported. No third-party animation was downloaded and no licence was assumed.

What made this more than "write some keyframes" is that a clip written as joint
angles is welded to one skeleton. The placeholder's limbs hang along local −Y
from identity bind rotations; the Quaternius skeleton's run along +Y from bind
rotations nowhere near identity. So poses are authored once in **character
space** and retargeted per rig:

```
local = parentBind⁻¹ · q · parentBind · localBind
```

`clips.ts` holds the pose library, `retarget.ts` does the conversion. A useful
side effect: every authored angle is now about one set of axes in one space,
which retires the two-opposite-sign-conventions trap that caused both the
inverted-aim and inverted-crouch bugs in earlier phases.

**States delivered:** idle, walk, run, sprint, crouch idle, crouch move, jump,
fall, landing. Crouch splits in two because the movement state machine does not
distinguish a stationary crouch, and a shuffle played at zero speed is the
classic sliding-feet artefact. Landing is a one-shot compression.

**An asset's own clips always win**, per state, so a real animation library can
replace these piecemeal with no code change.

**Foot grounding.** Joint angles do not know how long a character's legs are.
The same crouch that sat correctly on the placeholder pushed the Quaternius
character's feet 26 mm through the floor, and the run cycle floated its planted
foot 50 mm above it. Rather than retune every clip for every future character,
`footGrounding.ts` measures the lower foot each frame and offsets the pelvis to
put it back where the **asset's own bind pose** has it. Damped, not exact, so it
removes the average error without cancelling the bob that gives a stride its
weight; released while airborne.

Measured, character space, metres:

| State | Stride (fore/aft foot travel) | Lowest foot |
| ----- | ----------------------------- | ----------- |
| Idle | 0.007 | 0.094 |
| Walk | 0.78 | 0.083 |
| Run | 1.16 | 0.065 |
| Sprint | 1.30 | 0.004 |
| Crouch idle | 0.086 | 0.090 *(was 0.002)* |
| Crouch move | 0.22 | 0.079 *(was −0.026 — through the floor)* |

**No root motion.** The mixer poses bones beneath the character root; the root is
placed by the physics step. An idle character drifts < 0.02 m over a full clip
cycle, which is the assertion that proves it.

### Weapon and animation layering

Unchanged in architecture, and verified not to have regressed. The order is still

```
movement state → locomotion clip → body pose → weapon pose → arm IK → hands
```

The locomotion clips write the arm bones too; the weapon pose runs after the
mixer and wins. Worst hand-to-grip error across idle, run, sprint, and aiming
while running, backpedalling and strafing: **0.000 m trigger hand, 0.021 m
support hand** (sprint, where the weapon is carried across the body at the edge
of the arm's reach).

### Combat sandbox

**Two moving targets** on the existing `Damageable` contract — `MOVER_H` crosses
the firing lane, `MOVER_V` rises and falls. Both sit on kinematic bodies whose
colliders are placed in the same call that moves their meshes.

Placing them was most of the work. Both had to stay off every static target's
sight line from the firing line, or they would intermittently eat rounds aimed at
a plate — the same defect the existing z-stagger exists to avoid, except
intermittent, so it surfaces as a flaky test rather than an obvious one.
`MOVER_H` ended up **above** the lane at 3.4 m: the lane is narrow and the sight
lines to `MEDIUM` and `LONG` run down the middle of it, so no amount of shuffling
it sideways would clear them, but 3.4 m clears them in elevation.

**A training bot** (`BOT_ALPHA`), spawned at (−14, −25) — beyond its own
`loseTargetRadius` from both the player spawn and the range firing line, so it
never wanders into the range. Lifecycle: spawn → idle → detect → chase → engage →
fire → take damage → die → respawn.

It reuses the player's machinery rather than approximating it: the same
`stepCharacterMovement`, the same kind of Rapier kinematic capsule, the same
falloff curve and `Damageable` contract. Its decisions live in `shared/sim/botBrain.ts`,
which is pure and has 12 unit tests.

- Sight is required to **acquire** a target but not to keep chasing one, with a
  2.5 s blind-pursuit window — otherwise stepping behind a crate is an off
  switch rather than cover.
- Engage/disengage radii differ (11 m / 14 m) so a player on the boundary does
  not flicker the state every frame.
- Fires only with a clear ray from its muzzle to the player's centre of mass.

**Player health**: `PlayerCombatant`, 100 HP, 2.5 s respawn. Kept out of `Player`,
which owns simulation and rendering and should not know what a hit point is.
While dead, movement input and firing are both suppressed — the intent is
blanked rather than the simulation skipped, so gravity and collision still run.

Measured end to end: bot engages at 4 m, fires every 0.85 s for 12 damage, takes
the player from 100 to 0 in nine rounds, player respawns at the arena spawn with
full health. With the elevated platform between them: **zero rounds fired, zero
damage**.

### Tests

| Suite | Count |
| ----- | ----- |
| `tests/unit/botBrain.test.ts` (new) | 12 |
| `tests/e2e/locomotion.spec.ts` (new) | 10 |
| `tests/e2e/sandbox.spec.ts` (new) | 12 |

Unit total 110, up from 98.

### Bugs found and fixed during this phase

- **Foot-grounding ran away to its clamp.** It added the measured error to the
  previous correction, but the mixer overwrites the pelvis every frame, so the
  measurement is already uncorrected and the error *is* the whole correction.
  Every clip now carries a pelvis track so there is always a clean base.
- **Moving targets could not be hit where they were drawn.** Their colliders were
  driven with `setNextKinematicTranslation` from the render loop, which is
  applied by the next fixed step — the mesh moved and the collider stayed at its
  spawn. Placed directly now, in the same call that moves the mesh.
- **`poseAngles.spine` had become meaningless.** It read the bone's local
  `rotation.x`, which is only interpretable when something writes it directly.
  Retargeted clips compose bind orientation with the authored one, so on the
  Quaternius rig a forward fold read as a *positive* local x. It now measures the
  spine→chest direction in character space, which is the same measurement on any
  rig. This is what the Phase 3 crouch-spine regression was really reporting.
- **The Phase 3 crouch-spine test now passes**, since the crouch clip exists.

### Known limitations

- **The bot does not patrol.** Unaware, it stands still. The brief allowed
  "IDLE/PATROL" and preferred simple deterministic behaviour; patrol routes would
  need waypoints the arena does not have.
- **No pathfinding.** The bot walks straight at the player and will press against
  a wall or the elevated platform if one is in the way. It cannot climb.
- **The bot has no character model or animation** — a capsule with a visor,
  self-made, in the same spirit as the training plates.
- **The bot's death is a lean, not an animation.**
- **Sprint's planted foot comes within 4 mm of the floor** at the extreme of the
  cycle. Nothing penetrates, but there is no margin left.
- Locomotion is generated, not authored by an animator. It reads correctly and
  the feet stay planted, but it is not production animation.
- One bot, one spawn point. Nothing here is networked, and none of it has been
  designed for a server to own yet.

---

## Camera & Mouse-Look Stabilisation ✅

**Directed by the developer on 2026-08-11 as "Phase 3.5".** Out of roadmap order,
like the two before it. Nothing networked; no map work.

**Goal:** lock down third-person mouse-look before the environment and
multiplayer phases build on it. Specifically: unlimited, continuous horizontal
rotation with no snap at any angle.

### What was actually found

**No rendered camera discontinuity could be reproduced.** Driving the real
pointer-lock path — synthetic `mousemove` events carrying `movementX`, which is
exactly what a locked page receives — and unwrapping the camera heading frame by
frame gave, *before any change was made*:

| Sweep | Total swept | Worst single-frame deviation |
| ----- | ----------- | ---------------------------- |
| 400 events × 12 px | −603.5° | **0.000°** |

The barrel heading tracked it identically, also 0.000°. So the ±π seam, the
`atan2` conversion, degree/radian mixing and shortest-angle interpolation are all
ruled out as causes of a visible cut.

**What the old code did do:** `applyMouseDelta` wrapped yaw into [−π, π] on every
frame. That was invisible in the rendered image, because every consumer used it
through `sin`/`cos`, through `wrapAngle`-based deltas, or as a Three.js Euler —
all of which treat 7π and π identically. It was **not** invisible in the *value*:
the exposed `cameraYaw` jumped by 2π at the seam, which makes any raw difference
of two samples wrong, and would produce a real snap the moment anything damped or
interpolated that value.

So the wrap was a latent hazard rather than the reported symptom, and it has been
removed regardless, per the brief's explicit preference for an accumulated
representation.

**Two things that can be perceived as a cut and are not the camera:**

1. **The character's deadzone turn.** The legs hold still until the aim exceeds
   48° (aiming) or 85° (hip), then swing round at `maxTurnSpeed`. During a fast
   continuous rotation that reads as the body snapping. It is the intended model
   (§6 of the brief says to preserve it) and it is the body, not the view —
   measured at up to 4.8° in a frame while the camera's own step stayed at a
   constant 1.513°.
2. **Losing pointer lock.** Esc or a focus change drops the lock; held keys and
   the pending mouse delta are cleared and the overlay returns. The camera stops
   responding until the player clicks again, which looks like the view cutting
   out.

### Changed

`ThirdPersonCamera` now keeps horizontal yaw **unbounded**: it accumulates for as
long as the player keeps turning and is never wrapped, clamped or reset. The
rendered orientation, the boom direction and the shoulder offset all use that raw
value; `viewYaw` still returns the wrapped angle for gameplay consumers that want
a canonical one. Vertical pitch is unchanged — clamped, never wrapped.

Nothing else was touched: no change to the collision system, the shoulder
framing, the character rotation model, the weapon pose or the physics tick.

### Verified

Real Chrome, real Pointer Lock engaged on the canvas, real GPU:

| Case | Swept | Raw yaw span | Step | Worst deviation |
| ---- | ----- | ------------ | ---- | --------------- |
| 1 turn clockwise | −398.3° | −398.3° | −5.042° | **0.0000°** |
| 2 turns clockwise | −801.7° | −801.7° | −5.042° | **0.0000°** |
| 3 turns clockwise | −1205.0° | −1205.0° | −5.042° | **0.0000°** |
| 3 turns anticlockwise | +1205.0° | +1205.0° | +5.042° | **0.0000°** |
| Slow, 4 px/event | −60.0° | −60.0° | −0.504° | **0.0000°** |
| Fast, 120 px/event | −892.4° | −892.4° | −15.126° | **0.0000°** |

Swept total equals the raw yaw span in every row, which is the direct evidence
that the accumulator never wraps. The per-event step is identical at every
accumulated angle, so sensitivity does not drift. Repeated while walking,
sprinting, crouching, airborne, and aiming while firing — all 0.0000°.

After roughly eleven cumulative turns the camera sat at −3942.9°, still locked,
hand-to-grip error 0.0040 m / 0.0057 m, no console errors, 52–60 FPS.

### Tests

`tests/e2e/camera-look.spec.ts` — 17 tests: relative-movement-not-cursor-position,
turn direction, 360/720/1080 clockwise, 1080 anticlockwise, constant sensitivity
across turns, ±π crossing in both directions, rapid reversal, rotation while
walking/sprinting/crouching/airborne, pitch clamp, pitch sign after three turns,
weapon aim across 1080°, grip stability per stance, deadzone independence,
backpedal, strafe.

### Known limitations

- The yaw accumulator is a float64 and grows without bound. At a sustained fast
  spin it would take on the order of a decade of continuous play to reach a
  magnitude where its resolution matters, so this is noted rather than fixed —
  a fix would reintroduce the wrap this phase removed.
- Automated verification drives `movementX` directly. Chrome's own delivery of
  pointer-lock deltas, including any OS pointer acceleration, is browser-side and
  outside what these tests can exercise.
- The character's deadzone snap during fast rotation is unchanged, by
  instruction. If it turns out to be the thing that reads as a "cut", it is a
  tuning question for `aimYawLimit` / `hipYawLimit` / `maxTurnSpeed`, not a
  camera one.

---

## Map 01 — Playable Combat Map ✅

**Directed by the developer on 2026-08-11 as "Phase 4".** Out of roadmap order.
Nothing networked.

### The one architectural decision

Map 01 is **additive**, not a replacement. The Phase 1 grey-box arena and the
Phase 2 range are kept as a second map, `TRAINING`, because their stairs, ramp,
crouch gate, corridor and inside corner exist to exercise movement and camera and
roughly sixty regression tests assert against those exact coordinates. Replacing
them would have deleted that coverage to make room for scenery.

So there is now a **map registry**. `MAP01` is the game's default — a player
opening the game gets the designed arena. `?map=<id>` selects a map, and the
regression suites ask for `TRAINING` through one line in the test helper, leaving
every existing assertion untouched.

### Map 01 — "Substation"

48 × 40 m of playable floor, boundary walls 6 m. Compact on purpose: a larger
map reads as empty with one bot in it.

| Zone | Extent | Role |
| ---- | ------ | ---- |
| Entry / spawn band | z 10…18 | Four spawns, each behind cover |
| Central arena | x −16…16, z −8…8 | Three cover tiers, the main fight |
| Elevated deck | x −16…16, z −19…−9, y 3 | High ground, long sightline, railings with a firing gap |
| West route | x −24…−16.5 | Flank, medium and low cover |
| East route | x 16.5…24 | Flank, mirrored |

**Cover tiers**, sized against the character rather than by eye: low 1.0 m (below
the 1.15 m crouch height — crouch behind it, shoot over it standing), medium
2.0 m (breaks standing line of sight), full 3.2 m (blocks entirely).

**Elevation**: stairs east at x 13 (rise 0.30 m, tread 0.90 m) and a ramp west at
x −13 (3 m over 8 m, 20.6°). Both are inside the movement system's limits by
construction — rise under `stepHeight` 0.45, tread over the 0.68 m capsule
diameter, slope under the 50° limit.

**Sightlines**: the centre lane (x ∈ [−2, 2]) is left open from the deck to the
entry band — ~25 m, the map's one long shot. Two full-height pillars flank it, so
the long shot exists but is contested, and the side routes offer a longer safe
path. Crossing the middle is a choice.

**Spawns**: four, none facing another, each behind cover. How a real match picks
one is **OPEN** — it belongs with the game mode (`PROJECT.md` Q2/Q8). The local
player currently always takes the first, which is a development convenience.

**Targets**: seven, covering short, medium, long (down the lane), elevated,
behind-cover, flank and one moving.

**Collision**: `ArenaBox` always gets a collider, `DecorBox` never does. Beams,
light fittings, floor markings and pipework are decoration and are typed as such,
so no piece of scenery can be mistaken for cover or silently become an obstacle.

### Bugs found by building the map

- **Neither climb worked.** The route walls sat at x = ±12.5, straight across the
  foot of the stairs and the ramp — the capsule jammed against a wall and never
  reached the first tread. Moved outboard to ±16.5.
- **The stairs climbed to nowhere.** The deck was 18 m wide against climbs at
  x = ±13, so both topped out beside it. The deck is 32 m wide now, and both
  climbs land on it.

Both were found by walking the map under automation rather than by looking at
screenshots, which is the only reason they were found at all.

### Verified

- Stairs and ramp both reach the 3.02 m deck, walking and sprinting.
- All four spawns stand on open floor; the boundary holds.
- Camera holds 3.5 m in the open, compresses at cover, recovers, and never
  leaves the boundary or goes underground on the deck.
- Bot detects, engages and damages the player, and can be shot back.
- Targets damageable at short and long range; player death and respawn work.
- 55–60 FPS in real Chrome, 66–141 draw calls, ~30k triangles.
- No console errors anywhere.

### Tests

`tests/e2e/map01.spec.ts` — 15 tests: default map, clean load, spawn validity,
all four spawns, targets and bot present, stairs walk + sprint, ramp, traversal
with jump and crouch, boundary, camera in the open / at cover / at the boundary /
on the stairs, target engagement at two ranges, bot engagement both ways,
death and respawn, and a frame-rate/draw-call floor.

### Known limitations

- **The bot cannot climb.** It walks straight at the player, so it will not
  follow onto the deck and will press against cover between it and its target.
  Deliberate: this phase is told not to build navigation. It is placed in the
  open centre, which reaches the entry band and both route mouths.
- **One bot, one spawn.** Enough to exercise combat, not a populated map.
- Visual language is coherent grey-industrial with emissive fittings and floor
  markings, but it is still primitives — no meshes, no textures, no art pass.
- The map has no gameplay objective. Match size, mode and win condition remain
  **OPEN** (`PROJECT.md` Q1–Q3).
- `TRAINING` and `MAP01` share one world; there is no level streaming or
  unloading, because with two small maps there is nothing to stream.

---

## Phase 5 Session A — Multiplayer Foundation ✅

**Directed by the developer on 2026-08-11.** Foundation only: no transport, no
simulation, no prediction, no multiplayer combat. Those are Sessions B–D.

### Why this session existed

Inspection found two structural blockers, neither of which was a protocol
conflict:

1. `packages/server` was directory scaffolding — `.gitkeep` files, no
   `package.json`, not a workspace member.
2. **Map collision data lived in the client.** The authoritative server must
   build its own physics world from the map, but `ARCHITECTURE.md` forbids the
   server importing the client. The data had to move before any server work
   could begin.

`NETWORK_PROTOCOL.md` turned out to be complete and self-consistent, and
`shared/src/protocol/` was empty — so there was nothing to conflict with, and no
version bump or protocol invention was needed.

### Delivered

**Gameplay geometry moved to `shared/src/map/`.** `MAP01` and `TRAINING` each
now have an authoritative half (collision boxes, spawns, bounds, metrics) in
shared and a presentation half (decoration, lighting, targets, bots) in the
client. Coordinates were moved by extracting the existing source text rather
than retyped, so they could not change in transit — and there is now exactly one
definition of each. `DecorBox` deliberately does not exist in shared at all: the
server cannot be handed decoration even by mistake.

**`packages/server` created** as a workspace member with `ws` 8.18.3 and
`@dimforge/rapier3d-compat` 0.20.0 — both already on `CLAUDE.md` §4's approved
list, and Rapier pinned to the same version the client uses so there is one
physics engine. It contains config loading, a pure map→collider conversion, and
an entry point that validates both maps and reports what a world would contain.
It runs:

```
MAP01: 39 colliders, 4 spawns — ready
TRAINING: 36 colliders, 1 spawns — ready
```

**Protocol v1 implemented** in `shared/src/protocol/` — all ten message types,
little-endian, with the documented validation order and reason codes. Decoding
never throws; every failure is a `DecodeFailure` value.

### Verified

- **61 new protocol tests**: round trips (including boundary, zero, maximum and
  negative values, multi-byte UTF-8, the ±π yaw seam), every documented
  rejection, and **literal byte-layout comparisons** against the document's
  offset tables for all ten messages.
- Dependency direction checked mechanically: no `server → client` import, no
  `client → server`, and shared imports neither. The only matches for "Three" or
  "Rapier" in shared are comments.

### Known limitations / blockers for Session B

- The server does not listen, tick or simulate. By design.
- Targets and bots remain client-side and are **not** in shared, so they are not
  yet server-authoritative. Fine for now; Session C must decide whether combat
  targets become server entities.
- `stepCharacterMovement` is already pure and shared, so it is server-ready, but
  the client couples it to Rapier inside `Player`. Session B needs an equivalent
  server-side character controller — the shared movement itself does not need to
  change.
- Development auth mode is gated behind `NULLPOINT_DEV_AUTH` and refuses to run
  under `NODE_ENV=production`, per `NETWORK_PROTOCOL.md` §4.1. Real Firebase
  verification is still Phase 7.

---

## Phase 3 — Server Core & Transport ⛔

**Goal:** A server that accepts connections, validates ruthlessly, and ticks.

**Blocked on:** **Q13** (where the server runs) — needed to know whether TLS and
a reverse proxy are in scope for this phase.

**Scope**

- Node HTTP server + `ws`, room container, connection lifecycle.
- `shared/src/protocol` — encoders and decoders for `C_HELLO`, `C_INPUT`,
  `C_PING`, `C_LEAVE`, `S_WELCOME`, `S_REJECT`, `S_PONG`.
- Fixed-tick loop at `SIM_HZ`, monotonic clock, clamped catch-up.
- Full validation pipeline and every reason code from `NETWORK_PROTOCOL.md` §6–7.
- Per-type token-bucket rate limiting.

**Deferred-auth note (deliberate, not an oversight):** `C_HELLO` carries
`idToken` from Phase 3, but **verification against the Firebase Admin SDK lands
in Phase 7**. Until then the server runs in an explicit development auth mode
that accepts a local dev token and assigns a throwaway identity. This mode is
gated behind an environment flag, is refused when the server starts in
production mode, and is removed as a valid path at Phase 7. `REASON_AUTH_FAILED`
exists and is exercised from Phase 3.

**Exit criteria**

- [ ] A client can connect, handshake, and receive `S_WELCOME`.
- [ ] Version mismatch, oversized frame, unknown id, bad length, reserved bits set, and rate-limit breach each produce the correct reason code and a clean close — proven by integration tests, one per code.
- [ ] No malformed input can crash the server. A fuzz test of random bytes leaves it running.
- [ ] Round-trip encode/decode unit tests exist for every implemented message type.
- [ ] The tick loop holds `SIM_HZ` ±1 Hz over 60 seconds under an idle load.
- [ ] Server exposes a health endpoint returning tick rate, room count and uptime.

---

## Phase 4 — Networked Movement ⛔ *first playable multiplayer*

**Goal:** Two browsers, one room, both players see each other move smoothly.
**This is the milestone that proves the project.**

**Blocked on:** **Q1** (players per match).

**Scope**

- `S_SNAPSHOT` with delta encoding, baselines and acknowledgement.
- `S_PLAYER_JOIN` / `S_PLAYER_LEAVE`.
- Client-side prediction of the local player; reconciliation replay on mismatch.
- Entity interpolation for remote players with a render-time delay buffer.
- Netgraph debug overlay: RTT, jitter, packet size, correction count and magnitude.
- Tuning pass on `SIM_HZ`, `SNAPSHOT_HZ`, `INPUT_HZ` and interpolation delay
  against measured behaviour. Position quantisation decided here (bumps
  `PROTOCOL_VERSION` if adopted).

**Exit criteria**

- [ ] Two Playwright browser contexts join one room against a real server; each observes the other's movement within a bounded number of snapshots.
- [ ] Local movement has no perceptible input latency.
- [ ] Remote movement is smooth with no visible stutter or rubber-banding under normal local conditions.
- [ ] Under 150 ms simulated latency and 5% simulated packet loss the game remains playable and self-corrects.
- [ ] Prediction corrections are rare and small in steady state; the netgraph proves it.
- [ ] A client that misses a baseline recovers on the next `FULL` snapshot — tested.
- [ ] Measured bandwidth is recorded in `NETWORK_PROTOCOL.md` §8, replacing the estimate.
- [ ] Any protocol change made during tuning is documented and the version bumped.

---

## Phase 5 — Combat ⛔

**Goal:** Shooting that is server-decided and feels fair to the shooter.

**Blocked on:** **Q4** (weapon roster), **Q5** (hitscan vs projectile),
**Q6** (ammo/reload), **Q7** (health model). None may be assumed.

**Scope**

- Message `0x87` defined and specified in `NETWORK_PROTOCOL.md` (version bump).
- Server-side hitboxes, separate from render meshes.
- World-state history ring buffer (~1 s) and lag-compensated shot resolution
  with a clamped rewind bound.
- Health, damage, death; `health` field (bit 5) activated in `EntityState`.
- Client-side feedback: muzzle flash, tracer, impact decal, hit marker — all
  cosmetic, all triggered by server events.

**Exit criteria**

- [ ] Hits are resolved **only** on the server. A modified client cannot self-report a hit.
- [ ] Lag compensation verified: at 150 ms simulated latency, shots that visually connect on the shooter's screen register.
- [ ] The rewind clamp is enforced and tested at its boundary.
- [ ] Damage, death and respawn round-trip in a two-browser Playwright test.
- [ ] Every new message type has round-trip and malformed-input tests.
- [ ] `NETWORK_PROTOCOL.md` updated, `PROTOCOL_VERSION` bumped, changelog entry written.

---

## Phase 6 — Match Flow ⛔

**Goal:** A match with a beginning, a score and an end.

**Blocked on:** **Q2** (game mode), **Q3** (length and win condition),
**Q8** (respawn rules), **Q14** (how players find a match).

**Scope**

- Message `0x88` defined and specified (version bump).
- Match state machine: warmup → active → ended → reset.
- Spawn point selection with enemy-proximity avoidance.
- Scoring, scoreboard UI, end-of-match summary.
- Room joining per Q14.

**Exit criteria**

- [ ] A full match runs start to finish and resets cleanly for another.
- [ ] Spawns never place a player inside geometry or in front of an enemy.
- [ ] Score is server-authoritative and consistent across all clients.
- [ ] Players joining mid-match are handled correctly.
- [ ] Match lifecycle is covered by a two-browser E2E test.

---

## Phase 7 — Firebase Identity & Persistence ⛔

**Goal:** Real identity and stats that survive a page reload.

**Blocked on:** **Q15** (which Firebase products), **Q16** (sign-in methods),
**Q17** (progression or display-only stats).

**Scope**

- Firebase Auth in the client; ID token sent in `C_HELLO`.
- **Firebase Admin SDK token verification on the server** — this replaces the
  Phase 3 development auth mode, which is removed as a valid path.
- Firestore profile and lifetime stats; batched, asynchronous, off-tick writes.
- Firestore security rules committed and reviewed.
- Display names sourced from the verified token only.

**Exit criteria**

- [ ] An unverified or expired token is refused with `REASON_AUTH_FAILED`.
- [ ] The development auth mode no longer admits a connection in production mode — tested.
- [ ] Stats persist across sessions and are written only by the server.
- [ ] No Firebase call occurs on the tick path — verified by inspection and by a profiling run.
- [ ] No Admin credential appears in the client bundle — verified by grepping the built output.
- [ ] Security rules deny all client writes to stat documents.

---

## Phase 8 — Assets & Content ⛔

**Goal:** The game stops looking like grey boxes.

**Blocked on:** **Q10** (art direction), **Q11** (map count and size),
**Q19** (third-party assets or self-made).

**Scope**

- `tools/asset-pipeline`: validate → optimise → pack, source to GLB/KTX2.
- Character model, rig and animation set (idle, walk, run, jump, aim, fire).
- Weapon models per the Q4 roster.
- Playable map(s) with authored collision separate from render geometry.
- Every third-party asset entered in `ASSET_CREDITS.md` **before** commit.

**Exit criteria**

- [ ] The pipeline runs from `assets/source/` to `assets/build/` reproducibly.
- [ ] The pipeline rejects assets with wrong scale, wrong forward axis or over-budget geometry.
- [ ] No built asset is committed; `assets/build/` is ignored.
- [ ] Character animation blends correctly with networked movement state.
- [ ] `ASSET_CREDITS.md` has an entry for every third-party asset, with license and date.
- [ ] Frame budget still met with real content loaded.

---

## Phase 9 — Polish ⛔

**Goal:** Game feel, audio, UI, performance.

**Blocked on:** **Q18** (audio scope and budget), **Q21** (performance target
and reference hardware).

**Scope**

- Web Audio: weapon, footstep, impact, UI sounds; positional audio.
- HUD, menus, settings (sensitivity, keybindings, quality).
- Game feel: hit-stop, screen shake, recoil, camera kick.
- Performance pass against a measured frame budget.

**Exit criteria**

- [ ] Settings persist and apply without a reload.
- [ ] Keybindings are rebindable and stored as data.
- [ ] A documented frame budget exists and is met on the target machine.
- [ ] No unbounded allocation in the frame loop — verified with a heap profile over a 10-minute session.
- [ ] Audio never blocks the main thread.

---

## Phase 10 — Hardening & Deployment ⛔

**Goal:** Friends can actually play it.

**Blocked on:** **Q13** (hosting target), **Q20** (browser support matrix).

**Scope**

- Full Playwright suite: join, play, shoot, score, disconnect, reconnect.
- Soak test at target player count.
- Deployment for client (static) and server (persistent process, per Q13).
- TLS, `wss://`, environment configuration, structured logging.

**Exit criteria**

- [ ] The full E2E suite passes against a production-mode build.
- [ ] A soak test at target player count runs without a memory or handle leak.
- [ ] Server survives abrupt client disconnects, reconnect storms and malformed traffic.
- [ ] The client bundle contains no debug hooks, no dev auth path and no secrets.
- [ ] Deployment is documented and reproducible from a clean checkout.
- [ ] The developer and at least one friend play a complete match remotely.

---

## Blocking summary

Questions are defined in `PROJECT.md` §6. Nothing below may be assumed.

| Phase | Blocked by |
| ----- | ---------- |
| 1 | ✅ complete — Q9, Q12 and Q19 were answered by the Phase 1 brief |
| 2 | ✅ complete |
| 3 | Q13 |
| 4 | Q1 |
| 5 | Q4, Q5, Q6, Q7 |
| 6 | Q2, Q3, Q8, Q14 |
| 7 | Q15, Q16, Q17 |
| 8 | Q10, Q11, Q19 |
| 9 | Q18, Q21 |
| 10 | Q13, Q20 |

---

## Decision log

Architectural decisions that shaped the plan. Detailed records go in `docs/adr/`.

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-08-10 | Monorepo with a shared package | Client and server must run identical simulation and protocol code. |
| 2026-08-10 | Binary protocol, not JSON | Bandwidth and parse cost at 20 Hz × N players. |
| 2026-08-10 | WebSocket/TCP accepted despite head-of-line blocking | WebTransport/WebRTC cost outweighs the benefit for a hobby project. |
| 2026-08-10 | Kinematic character controller, not a dynamic body | Shooter movement needs authored feel, not emergent physics. |
| 2026-08-10 | Remote players interpolated, never predicted | Simpler and adequate; smoothness over freshness. |
| 2026-08-10 | Firebase excluded from the realtime loop | Latency and cost; WebSockets own gameplay traffic. |
| 2026-08-10 | Auth verification deferred to Phase 7 behind a gated dev mode | Transport can be built and tested before identity exists. |
| 2026-08-10 | Phase 1 redefined to include the playable prototype; Phase 2 retired | Developer's call. Phases 3–10 keep their numbers so cross-references stay valid. |
| 2026-08-10 | `shared` consumed via path alias rather than a built package | Removes a build step and keeps HMR across the package boundary. The one-way import rule is unaffected. |
| 2026-08-10 | Collision does not write back into horizontal velocity | Doing so starves the character controller's step-up logic, making stairs unclimbable. `measuredSpeed` carries the real speed to animation and the HUD instead. |
| 2026-08-10 | Stair treads sized to exceed the capsule diameter | A 0.55 m tread under a 0.68 m capsule cannot be stood on, and Rapier correctly refuses to autostep onto it. |
| 2026-08-10 | Weapon rules live in `shared/combat`, orchestration in the client | Phase 4 moves damage behind server authority; the rules must move without being rewritten. |
| 2026-08-10 | Camera orientation set from yaw/pitch, not `lookAt(pivot)` | With a shoulder offset, looking at the pivot makes the view direction depend on boom length, so aiming rotated the crosshair off target. |
| 2026-08-10 | Weapon mounts on the chest joint, not the hand | Hand mounting inherits the arm chain's rotation and needs a counter-transform that breaks whenever an arm angle changes. |
| 2026-08-10 | Recoil is a decaying view offset, not a write to the player's pitch | A burst climbs and settles by itself; writing it into pitch would permanently re-aim the player every burst. |
| 2026-08-10 | Arms are solved by IK onto grips on the weapon, not posed by hand | Placing the weapon first and solving the hands onto it makes the grip correct by construction; the reverse order can only ever be approximated by tuning. |
| 2026-08-10 | The legs turn on a deadzone, not toward the camera every frame | Rotating the whole character with the camera is what makes a third-person prototype feel like a turret. |
| 2026-08-10 | Character bones reached through a semantic map, never by name | Swapping the asset must not touch gameplay code, and a rig missing a required joint should fail loudly rather than pose a guessed one. |
| 2026-08-10 | The model's forward correction lives on a root group, not on bones | Rotating bones to face the character forward corrupts every pose written afterwards and cannot be undone when the asset is replaced. |
| 2026-08-10 | The character asset is used unmodified; adaptation happens at load | Keeps the CC0 source verifiable against its origin and keeps the adaptation reviewable as code. |
| 2026-08-10 | Elbow poles expressed in character space, not chest-local space | A pole written against a bone's own axes silently flips the elbow when an asset with a different forward axis is loaded. |
| 2026-08-10 | Locomotion authored in character space and retargeted per rig | A clip written as joint angles is welded to one skeleton's bind pose and axis conventions; the same numbers pose two rigs differently. |
| 2026-08-10 | Feet grounded by measurement, not by retuning clips per character | Joint angles do not know how long a character's legs are, and the alternative is redoing every clip for every future asset. |
| 2026-08-10 | Bot decisions in `shared/sim`, bot body in the client | Keeps the state machine unit-testable without a browser, and puts it where a server-side bot would run unchanged. |
| 2026-08-10 | Bot reuses the player's movement and damage code rather than its own | One set of combat rules; a bot with its own movement would drift out of agreement with the player's. |
| 2026-08-11 | Camera yaw accumulates unbounded; only gameplay consumers see a wrapped angle | Normalising is invisible in a still frame but puts a 2π step in the value, which any future interpolation of it would turn into a snap. |
