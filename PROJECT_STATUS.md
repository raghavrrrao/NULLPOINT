# PROJECT_STATUS.md — NULLPOINT

**Last updated:** 2026-08-10
**Current phase:** Phase 1 — Toolchain & First Playable Prototype ✅ **complete**
**Next phase:** Phase 3 — Server Core & Transport ⛔ **not started, awaiting explicit go-ahead**

> **Phase 1 was redefined by the developer** on 2026-08-10 to mean "first
> playable single-player third-person prototype". That merges the original
> Phase 1 (Toolchain & Workspace) and Phase 2 (Client Sandbox) into one phase.
> Phases 3–10 keep their original numbering, so Phase 2 is retired rather than
> renumbered.

> Per `CLAUDE.md` §2: **no phase begins until the developer explicitly says to
> start it.** A phase is complete only when *every* exit criterion is true.
> Partial completion is reported as partial.

---

## Progress

| Phase | Name | Status |
| ----- | ---- | ------ |
| 0 | Foundation & Documentation | ✅ Complete |
| 1 | Toolchain & First Playable Third-Person Prototype | ✅ Complete |
| 2 | *(retired — merged into Phase 1)* | — |
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
- [x] `npm test` passes — 45 unit tests.
- [x] `npm run test:e2e` passes — 31 Playwright tests in real Chromium.
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
| 2 | *(retired — merged into Phase 1)* |
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
