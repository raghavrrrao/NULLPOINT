# NETWORK_PROTOCOL.md — NULLPOINT

**`PROTOCOL_VERSION = 1`**

> **Status:** Specification for the planned protocol. Nothing is implemented yet.
> **This document is normative.** Code follows it. If code and document disagree,
> the document is corrected in the same change that corrects the code.
> Message shapes that depend on undecided design are marked **OPEN** and
> **reserved** — their ids exist, their payloads do not.

---

## 1. Rules

1. Gameplay traffic uses **WebSockets only**. Firebase is never in the realtime
   loop.
2. All gameplay messages are **binary** (`ArrayBuffer`), **little-endian**.
   JSON is permitted only for pre-connection diagnostics.
3. **One WebSocket frame carries exactly one protocol message.** No batching of
   distinct message types into one frame. (Repeated *records* inside a single
   message — input commands, entities — are batching within a message and are
   allowed.)
4. Every message begins with a **1-byte type id**.
5. `PROTOCOL_VERSION` is bumped for **any** change to a payload layout, a field
   meaning, a message id, or an enum value. Changes are logged in §10.
6. Unknown type id, bad length, or version mismatch → **clean close with a
   reason code**. Never a crash, never a partial read, never a best-effort parse.
7. The client is the source of **intent only**. It never reports position,
   damage, hits, kills, or score.

### 1.1 Notation

| Token | Meaning |
| ----- | ------- |
| `u8` `u16` `u32` | Unsigned little-endian integer |
| `i16` `i32` | Signed little-endian integer |
| `f32` | IEEE-754 single, little-endian |
| `str(n)` | `u16` byte length, then that many UTF-8 bytes |
| `[]` | Repeated record, count given by a preceding field |

Time on the wire is **milliseconds as integers**. Distance is **metres**,
angles **radians**, both in the Y-up right-handed frame defined in `CLAUDE.md`.

### 1.2 Quantisation

| Quantity | Encoding | Formula |
| -------- | -------- | ------- |
| Yaw | `u16` | `round(wrap(yaw) / (2π) * 65536) & 0xFFFF` |
| Pitch | `i16` | `round(clamp(pitch, −π/2, π/2) / (π/2) * 32767)` |
| Position | `f32` per axis | No quantisation in v1 |
| Velocity | `f32` per axis | No quantisation in v1 |

Position/velocity quantisation to fixed-point is a deliberate **Phase 4
optimisation**, not a v1 feature. Adding it bumps `PROTOCOL_VERSION`.

---

## 2. Message ids

Ranges are fixed so direction is readable from the first byte.

| Range | Direction |
| ----- | --------- |
| `0x01`–`0x3F` | Client → Server |
| `0x80`–`0xBF` | Server → Client |
| all others | Invalid — disconnect |

### Client → Server

| Id | Name | Phase | Purpose |
| -- | ---- | ----- | ------- |
| `0x01` | `C_HELLO` | 3 | Handshake, version check, Firebase ID token |
| `0x02` | `C_INPUT` | 4 | Input commands + snapshot acknowledgement |
| `0x03` | `C_PING` | 3 | RTT probe |
| `0x04` | `C_LEAVE` | 3 | Voluntary, graceful disconnect |
| `0x05` | *reserved* | 6 | Match/loadout request — **OPEN (Q2, Q4)** |

### Server → Client

| Id | Name | Phase | Purpose |
| -- | ---- | ----- | ------- |
| `0x81` | `S_WELCOME` | 3 | Handshake accepted, assigned identity |
| `0x82` | `S_REJECT` | 3 | Handshake refused, with reason |
| `0x83` | `S_SNAPSHOT` | 4 | Authoritative world state |
| `0x84` | `S_PONG` | 3 | RTT probe reply |
| `0x85` | `S_PLAYER_JOIN` | 4 | A player entered the room |
| `0x86` | `S_PLAYER_LEAVE` | 4 | A player left the room |
| `0x87` | *reserved* | 5 | Combat events (hit, death) — **OPEN (Q4, Q5)** |
| `0x88` | *reserved* | 6 | Match state (score, round, timer) — **OPEN (Q2, Q3)** |

Reserved ids are allocated so that adding them later does not renumber anything.
A reserved id received in v1 is treated as unknown → disconnect.

---

## 3. Connection lifecycle

```
client                                            server
  │                                                  │
  │  WebSocket open (wss://)                         │
  ├─────────────────────────────────────────────────►│
  │                                                  │
  │  C_HELLO { version, idToken }                    │
  ├─────────────────────────────────────────────────►│
  │                                   verify version │
  │                          verify token (Admin SDK)│
  │                                  assign playerId │
  │  S_WELCOME { playerId, serverTime, tick, rates } │
  │◄─────────────────────────────────────────────────┤
  │        …or S_REJECT { reason } then close        │
  │                                                  │
  │  C_INPUT  (INPUT_HZ = 60)      ──────────────────►│
  │  S_SNAPSHOT (SNAPSHOT_HZ = 20) ◄──────────────────│
  │  C_PING / S_PONG               ◄─────────────────►│
  │                                                  │
  │  C_LEAVE ───────────────────────────────────────►│
  │                              close(1000, normal) │
```

Rules:

- `C_HELLO` **must** be the first message. Any other message before it →
  disconnect `REASON_PROTOCOL_ERROR`.
- A second `C_HELLO` on the same connection → disconnect `REASON_PROTOCOL_ERROR`.
- A connection that has not sent `C_HELLO` within **5000 ms** of opening is
  closed with `REASON_HANDSHAKE_TIMEOUT`.
- A connection sending nothing for **10000 ms** after handshake is closed with
  `REASON_TIMEOUT`.
- The server may close at any time; the client must handle close without
  throwing and must not auto-reconnect in a tight loop.

---

## 4. Client → Server messages

### 4.1 `C_HELLO` (`0x01`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x01` | |
| 1 | `u16` | `protocolVersion` | Must equal server's `PROTOCOL_VERSION` |
| 3 | `str(n)` | `idToken` | Firebase ID token (JWT), UTF-8. Max **4096** bytes |

Minimum size 5 bytes. Anything shorter → disconnect.

The server **verifies the token with the Firebase Admin SDK** before admitting
the connection. Until verification succeeds the connection has no identity and
no room. Display name and uid are taken from the verified token, never from a
client-supplied field.

> **OPEN (Q16):** which sign-in methods are permitted. If anonymous sign-in is
> allowed, the token is still a real, verified Firebase token — an empty
> `idToken` is never accepted.

**Phased implementation of verification.** The `idToken` field exists in the
wire format from Phase 3, but Firebase Admin SDK verification does not land
until **Phase 7** (`PROJECT_STATUS.md`). Between those phases the server runs an
explicit development auth mode that accepts a local dev token and assigns a
throwaway identity. That mode is gated behind an environment flag, is refused
when the server starts in production mode, and ceases to be a valid path at
Phase 7. This is a scheduling decision, not a protocol variation: **the wire
format is identical in both modes**, and `REASON_AUTH_FAILED` is implemented and
exercised from Phase 3 onward.

### 4.2 `C_INPUT` (`0x02`)

Sent at `INPUT_HZ` (60). Carries the most recent commands **redundantly** so a
single dropped frame does not create a gap the server must wait out.

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x02` | |
| 1 | `u32` | `ackSnapshotTick` | Newest snapshot tick received; `0` = none |
| 5 | `u8` | `commandCount` | **1–8**. Outside range → disconnect |
| 6 | `[]` | `commands` | `commandCount` × `InputCommand` (10 bytes each) |

Total size: `6 + commandCount * 10` bytes. A mismatch → disconnect.

**`InputCommand` (10 bytes)**

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u32` | `sequence` | Strictly increasing per connection |
| 4 | `u16` | `buttons` | Bitfield, §4.2.1 |
| 6 | `u16` | `yaw` | Quantised, §1.2 |
| 8 | `i16` | `pitch` | Quantised and clamped, §1.2 |

Commands are ordered oldest → newest. The server applies **at most one command
per player per tick**, ignores any `sequence` at or below the last one it
applied, and drops the whole message if sequences are not strictly increasing
within it.

There is **no client timestamp** in an `InputCommand`. Timing is derived from
the server's own tick and the measured RTT — a client cannot claim when it acted.

#### 4.2.1 `buttons` bitfield

| Bit | Meaning |
| --- | ------- |
| 0 | Forward |
| 1 | Back |
| 2 | Left |
| 3 | Right |
| 4 | Jump |
| 5 | Crouch |
| 6 | Sprint |
| 7 | Fire (**reserved until Phase 5**) |
| 8 | Aim (**reserved until Phase 5**) |
| 9–15 | Reserved — **must be zero**. Non-zero → disconnect |

> **OPEN (Q9):** additional movement abilities (dash, slide, mantle) would each
> claim a bit here and bump `PROTOCOL_VERSION`.

### 4.3 `C_PING` (`0x03`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x03` | |
| 1 | `u32` | `clientTimeMs` | Client monotonic ms, truncated to 32 bits |

Size 5 bytes exactly. `clientTimeMs` is **echoed, never trusted** — it is used
only by the client to compute its own RTT.

### 4.4 `C_LEAVE` (`0x04`)

| Offset | Type | Field |
| ------ | ---- | ----- |
| 0 | `u8` | `type` = `0x04` |

Size 1 byte exactly. The server removes the player and closes with code `1000`.

---

## 5. Server → Client messages

### 5.1 `S_WELCOME` (`0x81`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x81` | |
| 1 | `u16` | `protocolVersion` | Server's version |
| 3 | `u16` | `playerId` | Server-assigned. Authoritative identity |
| 5 | `u32` | `serverTimeMs` | For clock offset estimation |
| 9 | `u32` | `currentTick` | Server tick at send time |
| 13 | `u8` | `simHz` | `SIM_HZ` (60) |
| 14 | `u8` | `snapshotHz` | `SNAPSHOT_HZ` (20) |

Size 15 bytes exactly.

`playerId` is `1`–`65534`. `0` is reserved for "none"/"world"; `65535` is
reserved for "invalid". Ids are unique **within a room** and may be reused after
that player leaves.

### 5.2 `S_REJECT` (`0x82`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x82` | |
| 1 | `u16` | `reasonCode` | §7 |
| 3 | `str(n)` | `detail` | Human-readable, diagnostics only. Max **256** bytes |

The server sends `S_REJECT` then closes. `detail` is for the developer console;
the client must key its behaviour off `reasonCode`, never off the text.

### 5.3 `S_SNAPSHOT` (`0x83`)

The core message. Sent at `SNAPSHOT_HZ` (20).

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x83` | |
| 1 | `u32` | `tick` | Server tick this snapshot represents |
| 5 | `u32` | `serverTimeMs` | Server time at that tick |
| 9 | `u32` | `ackInputSequence` | Last `InputCommand.sequence` applied **for this client** |
| 13 | `u8` | `flags` | bit0 = `FULL` (baseline). Other bits reserved, zero |
| 14 | `u32` | `baselineTick` | Tick this delta is against. `0` when `FULL` |
| 18 | `u8` | `entityCount` | |
| 19 | `[]` | `entities` | `entityCount` × `EntityState` |

`ackInputSequence` is what drives client reconciliation (`ARCHITECTURE.md` §4.4).

**Baselines.** A `FULL` snapshot is sent to a client on join, whenever it has not
acknowledged a snapshot within **1000 ms**, and at least once every **5 seconds**
regardless. A client that receives a delta whose `baselineTick` it no longer
holds **discards it and waits** for the next `FULL` — it never guesses.

**`EntityState` (variable length)**

| Type | Field | Notes |
| ---- | ----- | ----- |
| `u16` | `playerId` | |
| `u16` | `fieldMask` | Which fields follow, in ascending bit order |

Fields, always serialised in ascending bit order, present only if their bit is set:

| Bit | Field | Type | Size | Phase |
| --- | ----- | ---- | ---- | ----- |
| 0 | `position` | 3 × `f32` | 12 | 4 |
| 1 | `velocity` | 3 × `f32` | 12 | 4 |
| 2 | `yaw` | `u16` | 2 | 4 |
| 3 | `pitch` | `i16` | 2 | 4 |
| 4 | `stateFlags` | `u8` | 1 | 4 |
| 5 | `health` | `u16` | 2 | **5 — reserved in v1** |
| 6–15 | reserved | — | — | must be zero |

In a `FULL` snapshot every implemented bit is set. In a delta, only changed
fields are set; a player with no changes is omitted from the entity list
entirely.

**`stateFlags` (bit 4)**

| Bit | Meaning |
| --- | ------- |
| 0 | Grounded |
| 1 | Crouched |
| 2 | Sprinting |
| 3–7 | Reserved, zero |

> **OPEN:** entity kinds other than players (projectiles, pickups) are not in
> v1. Adding them requires an entity-type discriminator and a version bump.
> Depends on **Q5, Q6**.

### 5.4 `S_PONG` (`0x84`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x84` | |
| 1 | `u32` | `clientTimeMs` | Echoed verbatim from `C_PING` |
| 5 | `u32` | `serverTimeMs` | Server time at send |

Size 9 bytes exactly. `RTT = clientNow − clientTimeMs`.

### 5.5 `S_PLAYER_JOIN` (`0x85`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x85` | |
| 1 | `u16` | `playerId` | |
| 3 | `str(n)` | `displayName` | From the **verified** token. Max **32** bytes |

Sent for every player already present when a client joins, and for each player
that joins afterwards.

### 5.6 `S_PLAYER_LEAVE` (`0x86`)

| Offset | Type | Field | Notes |
| ------ | ---- | ----- | ----- |
| 0 | `u8` | `type` = `0x86` | |
| 1 | `u16` | `playerId` | |
| 3 | `u16` | `reasonCode` | §7 |

Size 5 bytes exactly.

---

## 6. Validation

Applied **in this order**, before any field is interpreted:

| # | Check | Failure |
| - | ----- | ------- |
| 1 | Frame is binary, not text | `REASON_PROTOCOL_ERROR` |
| 2 | Frame length ≤ `MAX_FRAME_BYTES` (**8192**) | `REASON_MESSAGE_TOO_LARGE` |
| 3 | Frame length ≥ 1 | `REASON_PROTOCOL_ERROR` |
| 4 | Type id is a known **client → server** id | `REASON_UNKNOWN_MESSAGE` |
| 5 | Handshake completed, unless type is `C_HELLO` | `REASON_PROTOCOL_ERROR` |
| 6 | Frame length matches the type's declared size | `REASON_BAD_LENGTH` |
| 7 | Rate limit for this type not exceeded | `REASON_RATE_LIMITED` |
| 8 | Every field within its documented domain | `REASON_INVALID_FIELD` |

Every failure is a **clean close** — send `S_REJECT` where the connection is
still usable, then `close(4000 + reasonCode)`. Never throw out of the read path.
Never process a partially validated message.

### 6.1 Rate limits

Token bucket per connection, per message type. Initial values:

| Type | Sustained | Burst |
| ---- | --------- | ----- |
| `C_HELLO` | 1 per connection | 1 |
| `C_INPUT` | 90 / s | 120 |
| `C_PING` | 4 / s | 8 |
| `C_LEAVE` | 1 per connection | 1 |

`C_INPUT` is limited above `INPUT_HZ` (60) to tolerate jitter and bunching
without admitting a flood. These numbers are **initial engineering defaults**,
expected to be tuned in Phase 4 with measurements.

### 6.2 Field domains

| Field | Domain |
| ----- | ------ |
| `protocolVersion` | must equal server's |
| `idToken` length | 1 – 4096 |
| `commandCount` | 1 – 8 |
| `buttons` | bits 9–15 must be zero |
| `sequence` | strictly increasing within a message and across messages |
| `ackSnapshotTick` | ≤ server's current tick |
| `pitch` | −32767 – 32767 (decodes to ±π/2) |

Out-of-domain values are **rejected, not clamped**, on the server's read path.
Clamping is for values the server itself derives; a client sending an
out-of-domain field is a protocol violation.

---

## 7. Reason codes

`u16`. WebSocket close code is `4000 + reasonCode` (inside the 4000–4999
application range).

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 0 | `REASON_NORMAL` | Graceful close |
| 1 | `REASON_PROTOCOL_ERROR` | Message out of sequence or malformed framing |
| 2 | `REASON_VERSION_MISMATCH` | `protocolVersion` differs from server |
| 3 | `REASON_UNKNOWN_MESSAGE` | Unrecognised or wrong-direction type id |
| 4 | `REASON_BAD_LENGTH` | Length does not match the type |
| 5 | `REASON_INVALID_FIELD` | A field outside its documented domain |
| 6 | `REASON_MESSAGE_TOO_LARGE` | Frame over `MAX_FRAME_BYTES` |
| 7 | `REASON_RATE_LIMITED` | Token bucket exhausted |
| 8 | `REASON_AUTH_FAILED` | Firebase ID token missing, invalid or expired |
| 9 | `REASON_HANDSHAKE_TIMEOUT` | No `C_HELLO` within 5000 ms |
| 10 | `REASON_TIMEOUT` | No traffic within 10000 ms |
| 11 | `REASON_ROOM_FULL` | Room at capacity — **OPEN (Q1)** |
| 12 | `REASON_SERVER_SHUTDOWN` | Server stopping |
| 13 | `REASON_KICKED` | Removed by the server |
| 14 | `REASON_INTERNAL_ERROR` | Server fault; not the client's doing |

On `REASON_VERSION_MISMATCH` the client must show "update / reload required" and
must **not** reconnect automatically.

---

## 8. Bandwidth estimate

Rough, for sanity only — not a budget until Phase 4 measures it.

Full player entity: `2 + 2 + 12 + 12 + 2 + 2 + 1` = **33 bytes**.
Snapshot header: **19 bytes**.

For *N* players in a room, per client, at 20 Hz, worst case (all entities full):

| N | Bytes / snapshot | Down (KB/s) |
| - | ---------------- | ----------- |
| 4 | 19 + 3×33 = 118 | ~2.4 |
| 8 | 19 + 7×33 = 250 | ~5.0 |
| 16 | 19 + 15×33 = 514 | ~10.3 |

Up: `6 + 3×10` = 36 bytes at 60 Hz ≈ **2.1 KB/s** (3 redundant commands).

Delta encoding and idle players reduce the down figure substantially in
practice. Actual player count is **OPEN (Q1)**.

---

## 9. Testing requirements

Binding, per `CLAUDE.md` §9:

- **Every message type has a round-trip encode/decode test** — encode a known
  value, decode it, assert structural equality.
- Every message type has a **malformed input** test: truncated by one byte,
  over-long by one byte, wrong type id, reserved bits set.
- `MAX_FRAME_BYTES` + 1 is rejected without allocating a parse buffer.
- Quantisation round-trip: yaw and pitch survive encode → decode within the
  documented precision, at the boundaries (`0`, `±π`, `±π/2`) and across wrap.
- Delta/baseline: a client that misses the baseline and receives only deltas
  recovers correctly on the next `FULL`.
- Sequence handling: out-of-order, duplicate and replayed `sequence` values are
  ignored without corrupting state.
- Every reason code is reachable and produces a clean close in an integration
  test.

---

## 10. Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 1 | 2026-08-10 | Initial specification. Handshake, input, snapshot, ping, join/leave. Combat (`0x87`) and match state (`0x88`) reserved, not defined. |

Every future entry states what changed and why. A protocol change without an
entry here is an incomplete change.
