# ARCHITECTURE.md — NULLPOINT

> **Status:** Design document. No implementation exists yet.
> This describes the intended system. Where a decision is not yet made it is
> marked **OPEN** and cross-referenced to `PROJECT.md` §6.

---

## 1. Guiding shape

```
                    ┌──────────────────────────────┐
                    │        Firebase              │
                    │  Auth  ·  Firestore          │
                    │  (identity + persistence)    │
                    └───────┬──────────────┬───────┘
                            │              │
                  ID token  │              │  Admin SDK
                  (client)  │              │  (server, verify + write)
                            │              │
┌────────────────────┐      │      ┌───────┴────────────────────┐
│   Browser client   │◄─────┘      │   Node.js game server      │
│                    │             │                            │
│  Three.js render   │             │  Rapier simulation         │
│  Rapier prediction │◄═══════════►│  Room / match state        │
│  Input capture     │  WebSocket  │  Authoritative decisions   │
│  Interpolation     │  (binary)   │  Lag compensation          │
└────────────────────┘             └────────────────────────────┘
                            ▲
                            │
                  ┌─────────┴──────────┐
                  │  packages/shared   │
                  │  protocol · sim ·  │
                  │  math · constants  │
                  └────────────────────┘
```

Two runtimes, one shared core. **The shared package is the contract.** Anything
both sides must agree on — wire format, movement integration, collision shapes,
tunable constants — lives there and is imported by both. Nothing is duplicated.

---

## 2. Repository layout

A single npm workspace monorepo.

```
NULLPOINT/
├── CLAUDE.md                 Development rules (binding)
├── PROJECT.md                What the game is
├── ARCHITECTURE.md           This file
├── PROJECT_STATUS.md         Phases and current state
├── NETWORK_PROTOCOL.md       Wire format
├── ASSET_CREDITS.md          Third-party asset ledger
│
├── packages/
│   ├── shared/               Imported by BOTH client and server
│   │   └── src/
│   │       ├── protocol/     Message IDs, encoders, decoders, versioning
│   │       ├── types/        Wire and domain types (single definition)
│   │       ├── constants/    Tick rates, speeds, limits — one source of truth
│   │       ├── math/         Vec3/Quat helpers, fixed-point quantisation
│   │       └── sim/          Deterministic step: movement, collision queries
│   │
│   ├── client/               Browser bundle (Vite)
│   │   └── src/
│   │       ├── core/         Bootstrap, game loop, scene lifecycle
│   │       ├── render/       Three.js: renderer, camera rig, scene graph
│   │       ├── input/        Keyboard/mouse, pointer lock, input buffer
│   │       ├── net/          WebSocket client, prediction, reconciliation
│   │       ├── entities/     Local view models of replicated entities
│   │       ├── ui/           HUD, menus, DOM overlay
│   │       ├── audio/        Web Audio playback (Phase 9)
│   │       └── debug/        Netgraph, hitbox overlay, dev-only panels
│   │
│   └── server/               Node.js authoritative server
│       └── src/
│           ├── net/          ws server, connection lifecycle, validation
│           ├── sim/          Rapier world, fixed-tick loop, snapshots
│           ├── rooms/        Room container, player registry
│           ├── match/        Match rules, scoring, respawn (Phase 6)
│           ├── persistence/  Firebase Admin, stat writes (Phase 7)
│           └── config/       Env parsing, runtime configuration
│
├── assets/
│   ├── source/               Editable originals (.blend, .wav) — committed
│   ├── manifest/             Asset manifests — committed
│   └── build/                Generated GLB/KTX2 — GITIGNORED
│
├── tools/
│   └── asset-pipeline/       Source → runtime asset conversion
│
├── tests/
│   ├── unit/                 Node test runner: protocol, sim, math
│   ├── integration/          Real server, headless clients, no browser
│   ├── e2e/                  Playwright, real browsers
│   └── fixtures/             Shared test data
│
└── docs/
    └── adr/                  Architecture Decision Records
```

**Dependency direction is strictly one-way:**

```
shared  ←  client
shared  ←  server
```

`shared` imports nothing from `client` or `server`. `client` and `server` never
import each other. This is enforced by review, and later by a lint rule.

---

## 3. The shared package

### 3.1 Why it exists

The single largest failure mode in a predicted-movement shooter is the client
and server disagreeing about what a given input does. The only reliable fix is
to make it impossible: **there is exactly one movement implementation**, in
`shared/src/sim`, and both runtimes call it.

### 3.2 Constraints on shared code

- No DOM, no `window`, no Three.js.
- No Node built-ins (`fs`, `path`, `process`).
- No wall-clock reads. Time is passed in.
- No randomness without an injected, seeded PRNG.
- Pure functions where possible; explicit state objects otherwise.

This keeps it runnable in a browser, in Node, and in a unit test with no
environment at all.

### 3.3 Constants

Every tunable number lives in `shared/src/constants` and is imported. A value
that appears in two files is a bug.

| Constant | Initial value | Notes |
| -------- | ------------- | ----- |
| `SIM_HZ` | 60 | Fixed simulation rate |
| `SIM_DT` | `1 / SIM_HZ` s | Fixed timestep, never variable |
| `SNAPSHOT_HZ` | 20 | Server → client state rate |
| `INPUT_HZ` | 60 | Client → server input rate |
| `MAX_PLAYERS_PER_ROOM` | **OPEN (Q1)** | Blocks Phase 4 |
| `PROTOCOL_VERSION` | 1 | See `NETWORK_PROTOCOL.md` |

**These rates are initial engineering defaults, not design requirements.**
They are expected to be tuned in Phase 4 against measured behaviour.

---

## 4. Client architecture

### 4.1 The loop

The client runs **three decoupled clocks**:

| Clock | Rate | Responsibility |
| ----- | ---- | -------------- |
| Render | `requestAnimationFrame` (display rate) | Draw, interpolate, camera |
| Simulation | fixed `SIM_DT`, accumulator-driven | Predict local player |
| Network send | `INPUT_HZ` | Flush input commands |

```
frame(now):
  dtReal   = now - last
  acc     += dtReal
  while acc >= SIM_DT:
      cmd = input.sample()
      predictor.step(cmd, SIM_DT)     ← shared/sim
      net.queue(cmd)
      acc -= SIM_DT
  alpha = acc / SIM_DT
  remote.interpolate(renderTime)
  renderer.draw(alpha)
```

Rendering never advances simulation state. It only reads it and interpolates
between the previous and current simulation states by `alpha`.

### 4.2 Rendering (`render/`)

- One `WebGLRenderer`. WebGL2 required.
- Scene graph is a **view** of simulation state. Render objects hold a reference
  to an entity id, never authoritative data.
- Camera rig: a third-person boom arm anchored to the player's head position,
  with a spring-arm collision query so the camera pulls in rather than clipping
  through geometry. Pitch is clamped; yaw drives the character's aim direction.
- Y-up, right-handed, metres. Model forward is −Z.
- Lighting, post-processing and material strategy are **OPEN (Q10)** — deferred
  to Phase 8/9. Until then: flat grey-box materials and a single directional
  light.

### 4.3 Input (`input/`)

- Pointer Lock API for mouse look. Raw deltas, no smoothing by default.
- Input is sampled into an immutable `InputCommand` per simulation tick, each
  carrying a monotonically increasing sequence number.
- Commands are stored in a ring buffer until the server acknowledges them; they
  are needed for reconciliation replay.
- Keybindings are data, not `if` statements.

### 4.4 Prediction and reconciliation (`net/`)

1. Client applies input `n` locally and immediately (prediction).
2. Client sends input `n` to the server.
3. Server simulates and returns an authoritative state stamped with the last
   input sequence it processed, `ack`.
4. Client compares its recorded state at `ack` with the authoritative one.
   - Within tolerance → accept, do nothing.
   - Outside tolerance → snap to authoritative state and **replay** every
     buffered input after `ack` through `shared/sim`.

Remote players are **not** predicted. They are rendered in the past, at
`now - interpolationDelay`, interpolated between the two bracketing snapshots.
This is a deliberate trade: remote motion is smooth and slightly stale.

### 4.5 Physics on the client

Rapier runs on the client **only** for local prediction and camera collision.
It never determines a hit, a damage value, or another player's position.

**Assumption (to be validated in Phase 4):** the client and server run the same
Rapier WASM build and the same fixed timestep, so predicted and authoritative
movement agree closely enough that corrections are rare and small. NULLPOINT
does **not** rely on bit-exact cross-platform determinism — reconciliation is
the safety net, and correctness never depends on the client matching exactly.

---

## 5. Server architecture

### 5.1 Process shape

A single Node.js process hosting an HTTP server (health/status only) with a
`ws` WebSocket server attached. **OPEN (Q13):** where this process is deployed.
Firebase Hosting serves static files only and cannot run it.

### 5.2 The tick loop

```
every SIM_DT (fixed, accumulator over a monotonic clock):
    1. drain and validate inbound input queues
    2. apply one input command per player per tick
    3. step the Rapier world by SIM_DT
    4. resolve gameplay events (hits, deaths, scoring)
    5. record the world state into the history ring buffer
    6. every (SIM_HZ / SNAPSHOT_HZ) ticks → build and send snapshots
```

The loop is driven by a monotonic clock (`performance.now()`), never by
`Date.now()`, and never by the arrival of packets. If the process falls behind,
it clamps the number of catch-up steps rather than spiralling.

### 5.3 Rooms (`rooms/`)

- A **room** owns one Rapier world, one player set, one match state, one tick
  loop budget.
- Rooms are isolated: no shared mutable state between them.
- Room capacity is **OPEN (Q1)**. Room discovery is **OPEN (Q14)**.

### 5.4 Trust boundary

Everything from a client is hostile until proven otherwise:

| Check | Rule |
| ----- | ---- |
| Size | Reject frames over a fixed byte cap before parsing. |
| Type | Unknown message id → disconnect with a reason code. |
| Version | `PROTOCOL_VERSION` mismatch on handshake → refuse the connection. |
| Rate | Per-message-type token bucket. Exceed it → disconnect. |
| Range | Every numeric field is clamped to a documented domain. |
| Sequence | Input sequence numbers must advance; replays and gaps are dropped. |
| Time | Client-supplied timestamps are advisory only, clamped to a sane window. |
| Identity | The `playerId` is the one the server assigned. A client-claimed id is ignored. |

The client is never asked "did you hit?" or "where are you?" — it is asked
"what did you press?".

### 5.5 Lag compensation (Phase 5)

The server retains a ring buffer of recent world states (~1 second).
When resolving a shot from player *P*:

1. Compute *P*'s view time: `serverNow - (P.rtt / 2) - P.interpolationDelay`.
2. Clamp that rewind to a maximum (a cheat and fairness bound).
3. Rewind the relevant hitboxes to that time.
4. Perform the raycast or shape-cast against rewound colliders.
5. Restore the present state.

The shooter's perspective is honoured within the clamp; beyond it, the present
wins. Weapon behaviour that this depends on is **OPEN (Q4, Q5)**.

### 5.6 Snapshots

- Sent at `SNAPSHOT_HZ`.
- Delta-encoded against the last snapshot the client acknowledged, with periodic
  full baselines so a client can always recover.
- Interest management (only sending what a player can perceive) is **not** in
  scope at current player counts. It is a note, not a plan.

---

## 6. Physics architecture (Rapier)

| Concern | Decision |
| ------- | -------- |
| Build | `@dimforge/rapier3d-compat` (WASM) on both runtimes, same version, pinned exactly. |
| Timestep | Fixed `SIM_DT`. Rapier's internal timestep is set explicitly and never driven by frame time. |
| Character | Kinematic character controller, not a dynamic rigid body. Shooter movement needs authored feel, not emergent physics. |
| Collision shape | Capsule for players. |
| World geometry | Static colliders built from level collision meshes, authored separately from render meshes. |
| Hitboxes | Separate, coarser collider set used only for shot resolution and only on the server. |
| Units | Metres, kilograms, seconds, radians. Y-up, right-handed — identical to Three.js. |

Render meshes and collision meshes are separate assets. The renderer never
derives collision from visual geometry.

---

## 7. Networking architecture

Full wire specification lives in `NETWORK_PROTOCOL.md`. This section covers only
the structural decisions.

- **Transport:** WebSocket over TLS (`wss://`) in any non-local deployment.
- **Encoding:** binary `ArrayBuffer`, little-endian. Not JSON. JSON is permitted
  only for out-of-band, non-realtime messages (handshake errors, diagnostics).
- **Reliability:** WebSocket is TCP — ordered and reliable. This causes
  head-of-line blocking under loss. Accepted deliberately: WebTransport/WebRTC
  would remove it at a large complexity cost, and this is a hobby project. The
  decision is recorded, not hidden.
- **Firebase is never in the realtime loop.** No gameplay message touches
  Firestore, Realtime Database, or any HTTP endpoint during a match.

---

## 8. Firebase architecture

### 8.1 Division of responsibility

| Firebase does | Firebase never does |
| ------------- | ------------------- |
| Authenticate a player and issue an ID token | Carry gameplay state |
| Store the player profile and lifetime stats | Arbitrate hits, deaths or score |
| Persist post-match results | Sit in any per-tick code path |

### 8.2 Auth flow

```
1. Client signs in via the Firebase Web SDK          → ID token (JWT)
2. Client opens the WebSocket
3. Client sends HELLO { protocolVersion, idToken }
4. Server verifies the token with the Firebase Admin SDK
5. Verified → server assigns a playerId and admits the connection
   Rejected → clean close with an auth reason code
```

The display name, uid, and every persisted stat come from the **verified** token
and server-side records — never from a client-supplied field.

**OPEN (Q15, Q16):** which Firebase products and which sign-in methods.
Auth and Firestore are treated as necessary; everything else is undecided.

### 8.3 Credentials

- Firebase **client** config (apiKey, projectId, …) is public by design and is
  committed.
- Firebase **Admin** service-account credentials are secrets, supplied through
  the environment, never committed, never bundled into the client.
- Firestore security rules live in the repository and are reviewed whenever a
  document shape changes.

### 8.4 Write pattern

Stat writes happen at match end, batched, from the server, asynchronously and
off the tick path. A failed write is logged and retried; it never stalls or
fails a match.

---

## 9. Asset pipeline

```
assets/source/            tools/asset-pipeline          assets/build/
  model.blend       ──►   validate → optimise → pack  ──►  model.glb
  texture.png             (scale, axes, draco, KTX2)       texture.ktx2
  (committed)                                              (gitignored)
                                       │
                                       └──►  assets/manifest/*.json  (committed)
```

Rules:

- Runtime format is **GLB**. Textures become KTX2/Basis once the pipeline exists;
  PNG/JPG are acceptable placeholders until then.
- The pipeline **validates** rather than trusts: correct scale (1 unit = 1 m),
  −Z forward, sane triangle and texture budgets, no unreferenced material.
- Built output is generated, never committed, never edited by hand.
- Assets are loaded from the app's own origin. Nothing is hot-linked.
- **Every third-party asset is entered in `ASSET_CREDITS.md` before it is
  committed.** No entry, no commit.
- Character rigs and animation sets depend on **OPEN (Q10, Q12, Q19)**.

---

## 10. Testing architecture

Four layers, each with a distinct job.

| Layer | Runner | Scope | Speed |
| ----- | ------ | ----- | ----- |
| Unit | Node built-in test runner | `shared/` — protocol codecs, sim step, math | ms |
| Integration | Node built-in test runner | Real server + scripted socket clients, no browser | seconds |
| E2E | **Playwright** | Real browsers against a real server | tens of seconds |
| Manual | — | Feel, camera, game juice — the things tests cannot judge | — |

### Non-negotiables

- **Every protocol message type has a round-trip encode/decode test.** Encode,
  decode, assert structural equality, plus malformed and truncated input.
- **Multiplayer is tested with two real browser contexts** against a real server
  — one browser cannot prove replication works.
- **Tests never read the wall clock.** The clock is injected. A test that
  `sleep`s to wait for a tick is a broken test.
- **A bug fix begins with a failing test** that reproduces it.
- Determinism check: the same input sequence through `shared/sim` produces
  identical state on client and server builds.

### Playwright specifics

- Headless Chromium is the default target; WebGL runs under SwiftShader in CI.
- The game exposes a deterministic test hook (a seeded, fixed-step mode) so E2E
  runs are reproducible. Test hooks are stripped from production builds.
- Two-client scenarios: both contexts join a room, one moves, the other must
  observe the movement within a bounded number of snapshots.

---

## 11. Build and tooling

| Concern | Choice |
| ------- | ------ |
| Language | TypeScript, strict, across all packages |
| Client bundler | Vite |
| Server build | `tsc` to ESM; run directly under Node |
| Module system | ESM everywhere |
| Workspaces | npm workspaces |
| Versions | Exact-pinned in `package.json`; lockfile committed |

Nothing here is installed yet. Toolchain setup is **Phase 1** and does not begin
until the developer says so.

---

## 12. What this architecture deliberately does not do

Recorded so they are never mistaken for oversights:

- No entity-component-system. Player counts are small; a plain entity registry
  is simpler and enough.
- No interest management / spatial partitioning for networking.
- No horizontal scaling, no matchmaking service, no server orchestration.
- No client-side rollback for remote players — they are interpolated, not
  predicted.
- No WebRTC or WebTransport.
- No shared-memory or worker-thread physics. Single-threaded until measured to
  be a problem.
- No custom engine abstraction over Three.js.
