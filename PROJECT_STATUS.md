# PROJECT_STATUS.md — NULLPOINT

**Last updated:** 2026-08-10
**Current phase:** Phase 2 — First Playable Combat ✅ **complete**
**Next phase:** Phase 3 — Server Core & Transport ⛔ **not started, awaiting explicit go-ahead**

> **Phases 1 and 2 were redefined by the developer** on 2026-08-10. Phase 1 now
> means "first playable single-player third-person prototype", merging the
> original Phase 1 (Toolchain & Workspace) with the original Phase 2 (Client
> Sandbox). Phase 2 now means "first playable single-player combat". Phases 3–10
> keep their original numbering and scope, so the later Phase 5 (networked,
> server-authoritative combat) still stands — Phase 2 is its single-player
> foundation, not a replacement.

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
- The character is a **procedural placeholder**, not a licensed rigged asset.
  See `ASSET_CREDITS.md` §6 and **Q10**/**Q11**.
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
