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
│   │       ├── physics/      Rapier world, colliders, shape queries
│   │       ├── world/        Arena description and construction
│   │       ├── character/    Asset loading, bone mapping, IK, weapon pose, clips
│   │       ├── net/          WebSocket client, prediction, reconciliation (Phase 3)
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

**How `shared` is consumed (as of Phase 1).** It is resolved as TypeScript
*source* through a path alias — `@nullpoint/shared` → `packages/shared/src` — in
both `tsconfig.json` and `vite.config.ts`, rather than being built to `dist`
first. That keeps hot reload working across the package boundary and removes a
build step that buys nothing while there is only one consumer. The one-way
dependency rule is unchanged. Revisit when the server package lands in Phase 3.

**The `server` package does not exist yet.** Its directories are in place but it
has no `package.json`, because an empty TypeScript package fails to build. It is
created in Phase 3.

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

Phase 1 added two more tables of the same kind: `PLAYER_CONFIG` (speeds,
acceleration, gravity, jump, capsule dimensions, slope and step limits) and
`CAMERA_CONFIG` (boom length, pivot heights, sensitivity, pitch limits,
smoothing, collision radius). Both live in `shared/src/constants`, and no
gameplay file is permitted to hardcode a value that belongs in them.

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
- **Horizontal look is unbounded.** The camera's yaw accumulates without limit
  and is never wrapped, clamped or reset — turning right past a full circle
  continues to 2π, 4π and beyond. Rendering uses that raw value; only gameplay
  consumers that want a canonical angle take the wrapped one.

  An Euler angle of 7π and one of π describe the same orientation, so
  normalising is invisible in a still frame. It is not invisible to anything that
  *interpolates* the value: damping across a ±π step sweeps the long way round
  and snaps. Keeping the rendered angle unbounded means no such seam can be
  introduced by a later change. Vertical pitch is the opposite — clamped, never
  wrapped, so it cannot roll over the top.
- The camera never drives the character's facing directly. The character turns on
  a deadzone (§4.6), so the two headings are deliberately independent and the
  camera may rotate freely without the body following one-to-one.
- Y-up, right-handed, metres. Model forward is −Z.
- Lighting, post-processing and material strategy are **OPEN (Q10)** — deferred
  to Phase 8/9. Until then: flat grey-box materials and a single directional
  light.

### 4.3 Input (`input/`)

- Pointer Lock API for mouse look. **Relative deltas only** — `movementX`/
  `movementY` accumulated per event and consumed once per frame. Nothing reads
  the cursor's screen position: a locked cursor does not move, so a
  position-based camera would stop turning almost immediately. Raw deltas, no
  smoothing by default.
- Losing pointer lock clears held keys and any pending mouse delta, so a delta
  accumulated while the page was not in control cannot be applied as one jump
  when it returns.
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

### 4.6 The character (`character/`)

The rendered character is an **adapter over an asset**, not a hard-coded rig. Four
layers sit between a downloaded glTF and the gameplay code:

```
GLTF file  ──►  characterAssets  ──►  CharacterAsset  ──►  humanoidRig  ──►  weaponPose
               (URL resolution)      (load, fallback)     (bone mapping)    (posing, IK)
```

1. **`characterAssets.ts` — URL resolution.** A glTF references its `.bin` and
   textures by bare filename, and the bundler fingerprints emitted assets, so
   those references cannot resolve on their own. Each file is imported for its
   URL and a basename → URL map is handed to `GLTFLoader` via a `LoadingManager`.
   The source asset is never copied into `public/` and never edited.
2. **`CharacterAsset.ts` — loading.** Loads the glTF, disables frustum culling on
   skinned meshes (they cull against an un-posed bounding box), matches whatever
   animation clips the file carries against the movement states, and falls back
   to the procedural placeholder rig if anything fails. The placeholder is kept
   deliberately: it keeps the game runnable without an asset, and it keeps a
   second rig honest about the assumptions in the posing code.
3. **`humanoidRig.ts` — bone mapping.** Real bone names appear here and nowhere
   else. Gameplay asks for `HumanoidBone.RightHand`, not `hand_r`. A rig missing
   a gameplay-required joint fails the load rather than substituting a plausible
   neighbour. Segment lengths for IK are **measured from the asset's own bind
   pose**, never assumed.
4. **`weaponPose.ts` — posing.** Places the weapon from the aim direction, then
   solves both arms onto its grips.

Three conventions make an arbitrary asset usable:

- **Orientation.** The glTF specification places an asset's front on **+Z**;
  NULLPOINT uses **−Z**. The correction is a single rotation on a model-root group
  *above* the skeleton — never on individual bones, which would corrupt every
  pose written afterwards. A frame node under the chest carries the inverse, so
  weapon offsets stay written in character space.
- **Scale.** The asset is normalised so its rendered height matches
  `PLAYER_CONFIG.standHeight`, then shifted so its lowest vertex sits on the
  character's ground plane. The physics capsule is authoritative; the mesh
  conforms to it.
- **Rest direction.** Two-bone IK needs to know which way a bone points at rest.
  This differs per rig (the placeholder's limbs hang along −Y, an Unreal-style
  skeleton's run along +Y), so it is a property of the arm chain rather than a
  constant. Elbow pole targets are expressed in **character space** for the same
  reason.

Rendering-only. Nothing here writes simulation state.

#### Locomotion

The character has locomotion clips even though the asset ships none. They are
**generated and retargeted**, not imported:

```
clips.ts (character-space poses)  →  retarget.ts (bind-pose composition)  →  AnimationClip
```

Poses are authored once in **character space** — "swing the thigh forward by
0.4 rad about the character's own X axis" — and `retarget.ts` converts each key
into the target skeleton's local bone frame with

```
local = parentBind⁻¹ · q · parentBind · localBind
```

Without that step a clip is welded to one skeleton: the placeholder's limbs hang
along local −Y from identity rotations, while the Quaternius skeleton's run along
+Y from bind rotations nowhere near identity, so the same numbers produce a
different pose on each. Retargeting also removes the sign-convention trap that
has bitten this project twice, because every authored angle is now about one set
of axes in one space.

An asset's own clips always take precedence over the generated ones, per state,
so dropping in a real animation library later replaces them piecemeal with no
code change.

`AnimationController` selects the clip from the simulated movement state. It
resolves two cases the movement state machine does not distinguish: a crouch that
is not moving (`CROUCH_IDLE`, so the feet do not shuffle on the spot) and
touchdown (`LAND`, a one-shot compression).

**No root motion, anywhere.** The mixer poses bones beneath the character root;
the root itself is placed by the physics step. Animation reads movement state and
never writes it.

#### Foot grounding

Joint angles do not know how long a particular character's legs are, so a clip
authored against one rig puts another's feet through the floor or floats them
above it. `footGrounding.ts` measures the lower foot each frame and offsets the
pelvis to put it back where the bind pose has it — a value read from the asset,
so it is right for any rig. The correction is damped rather than exact, which
removes the average error without cancelling the vertical bob that gives a stride
its weight, and it releases while airborne where feet should hang free.

It moves one bone inside the model. The collider, the simulation and the camera
are untouched.

### 4.7 Combat entities (`entities/`)

Three things can be damaged, and all three satisfy the same `Damageable`
contract from `shared/combat` so that there is exactly one damage system:

| Thing | Where | Notes |
| ----- | ----- | ----- |
| `TrainingTarget` | `world/` | Static, or travelling on a kinematic body |
| `CombatBot` | `entities/` | Shoots back, dies, respawns |
| `PlayerCombatant` | `entities/` | The player's own health and respawn |

`PlayerCombatant` is separate from `Player` deliberately: `Player` owns
simulation and rendering and has no business knowing what a hit point is. The
bot's hitscan resolves against the player by the identical path the player's
hitscan resolves against a target — collider handle → `DamageableRegistry` →
`takeDamage`.

**The bot reuses the player's machinery rather than approximating it.** It moves
through the same `stepCharacterMovement` on the same kind of Rapier kinematic
capsule, so it cannot accelerate impossibly, pass through walls or teleport; its
damage runs through the same falloff curve. Its decisions come from
`stepBotBrain` in `shared/sim`, which is pure — no Rapier, no Three.js — so the
state machine is unit-tested without a browser and is where a server-side bot
would run unchanged.

Line of sight is a ray from the bot's muzzle to the player's centre of mass,
excluding only the bot's own capsule. Anything else the ray reaches first means
no shot. That is the whole of "the bot cannot shoot through cover".

A travelling target sits on a **kinematic** body whose collider is placed
directly, in the same call that moves its mesh. Issuing
`setNextKinematicTranslation` from the render loop instead leaves the collider
behind at its spawn until the next fixed step, and a plate that cannot be hit
where it is drawn is worse than a stationary one.

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

## 8.5 Maps (`map/`)

A map is **data**: geometry, decoration, spawn points, targets and bot
placements, declared in one module and built by `Arena`. Two exist.

| Map | Purpose |
| --- | ------- |
| `MAP01` "Substation" | The first designed combat arena. The game's default. |
| `TRAINING` | The Phase 1 grey-box and the Phase 2 range, unchanged. |

`TRAINING` is kept because its stairs, ramp, crouch gate, corridor and inside
corner exist to exercise movement and camera, and the regression suites assert
against their exact coordinates. Deleting it to make room for a designed map
would throw that coverage away. `?map=<id>` selects one; an unknown id falls
back to the default rather than failing to start.

**Gameplay geometry and decoration are separate types.** An `ArenaBox` always
gets a collider; a `DecorBox` never does. That is a type distinction rather than
a naming convention, so neither mistake is available: no visible-but-not-solid
cover, and no invisible collision. It also means the subset the authoritative
server will need — collision and spawns, no meshes or lights — already exists
and is explicit, instead of having to be recovered from a scene graph later.

Map geometry is sized from `PLAYER_CONFIG` rather than by eye: stair rise below
`stepHeight`, tread wider than the capsule diameter, ramp under the slope limit,
low cover below crouch height. A map that needs the movement system changed in
order to be walkable is a broken map.

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
- **The pipeline does not exist yet.** Until it does, a third-party glTF is
  consumed straight from `assets/source/` and adapted **at load time**
  (§4.6) — axes, scale and bone names are corrected in code, never in the
  file, so the committed asset stays byte-identical to its licensed source.
- Built output is generated, never committed, never edited by hand.
- Assets are loaded from the app's own origin. Nothing is hot-linked.
- **Every third-party asset is entered in `ASSET_CREDITS.md` before it is
  committed.** No entry, no commit.
- Character rigs and animation sets depend on **OPEN (Q10, Q12, Q19)**. The
  current character is CC0 and carries no animation clips; see
  `ASSET_CREDITS.md` §4.1.

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
