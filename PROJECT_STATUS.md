# PROJECT_STATUS.md — NULLPOINT

**Last updated:** 2026-08-10
**Current phase:** Phase 0 — Foundation & Documentation ✅ **complete**
**Next phase:** Phase 1 — Toolchain & Workspace ⛔ **not started, awaiting explicit go-ahead**

> Per `CLAUDE.md` §2: **no phase begins until the developer explicitly says to
> start it.** A phase is complete only when *every* exit criterion is true.
> Partial completion is reported as partial.

---

## Progress

| Phase | Name | Status |
| ----- | ---- | ------ |
| 0 | Foundation & Documentation | ✅ Complete |
| 1 | Toolchain & Workspace | ⛔ Not started |
| 2 | Client Sandbox — third-person movement | ⛔ Not started |
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

## Phase 1 — Toolchain & Workspace ⛔

**Goal:** A repository that builds, type-checks, lints and tests — with nothing
in it yet.

**Blocked on:** **Q22** (branch naming — `master` vs `main`). Trivial, but it
should be settled before the first commit. Otherwise ready to start on the
developer's word.

**Scope**

- Root `package.json` with npm workspaces.
- Per-package `package.json` for `shared`, `client`, `server` — exact-pinned
  versions, no carets.
- TypeScript config: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. Project references so
  `shared` builds once and both consumers use its output.
- Vite for the client. `tsc` for the server.
- Node built-in test runner wired up; Playwright installed and configured.
- The project logger (`shared`) — a small level-based wrapper. No `console.log`
  anywhere else.
- npm scripts: `build`, `typecheck`, `lint`, `test`, `test:e2e`, `dev`.

**Dependencies installed** (approved stack only — nothing else without asking):
`typescript`, `three`, `@dimforge/rapier3d-compat`, `ws`, `firebase`,
`firebase-admin`, `vite`, `@playwright/test`, and their required `@types/*`.

**Exit criteria**

- [ ] `npm run typecheck` passes across all three packages with zero errors.
- [ ] `npm run build` produces a client bundle and a server build.
- [ ] `npm test` runs and passes (even with a single placeholder test).
- [ ] `npm run test:e2e` launches Playwright and passes a trivial page-loads test.
- [ ] `shared` is importable from both `client` and `server`; neither imports the other.
- [ ] No `any` in any committed file. No `console.log`.
- [ ] Lockfile committed; every version exact-pinned.

---

## Phase 2 — Client Sandbox ⛔

**Goal:** One player, no network. Third-person movement that already feels good.

**Blocked on:** **Q9** (movement abilities), **Q12** (visible character or capsule).
Both must be answered before this phase starts.

**Scope**

- Three.js scene: grey-box test level, single directional light, no post-processing.
- Rapier world on the client; kinematic capsule character controller.
- `shared/src/sim` — the movement step, written here **once**, fixed timestep.
- Third-person spring-arm camera with collision pull-in; pointer lock; pitch clamp.
- Fixed-timestep accumulator loop with render interpolation.
- Debug overlay: position, velocity, grounded state, frame time.

**Exit criteria**

- [ ] A capsule (or character, per Q12) moves, sprints, jumps and crouches under keyboard input.
- [ ] Camera orbits with the mouse, never clips through level geometry, and never gimbal-flips.
- [ ] Movement runs at a fixed `SIM_DT` and is frame-rate independent — verified by running at 30, 60 and 144 Hz render rates and comparing traversal distance.
- [ ] Movement logic lives entirely in `shared/src/sim` and imports no Three.js and no DOM.
- [ ] Unit tests cover the movement step: gravity, ground clamp, jump arc, slope limits.
- [ ] 60 FPS at 1080p on the developer's machine with the grey-box level. *(Uses the placeholder target from `PROJECT.md` §5 — **Q21** replaces it with a real one.)*

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
| 1 | Q22 (branch name — trivial, but decide before the first commit) |
| 2 | Q9, Q12 |
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
