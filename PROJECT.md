# PROJECT.md — NULLPOINT

> **Status:** Pre-production. No game code exists yet.
> Design decisions marked **OPEN** are undecided and must not be assumed.

---

## 1. What NULLPOINT is

NULLPOINT is a **browser-based, third-person, multiplayer shooter**.

It runs in a desktop browser with no install and no plugin. Players load a URL,
join a session, and control a character from an over-the-shoulder third-person
camera. The game is authoritative-server multiplayer: a Node.js process owns the
simulation and clients render it.

It is built for **personal entertainment** — a project made to be enjoyed and to
be interesting to build. It is not a commercial product and has no revenue,
marketing, or launch goal.

---

## 2. Confirmed requirements

These come directly from the developer and are not open to reinterpretation.

| # | Requirement |
| - | ----------- |
| R1 | Third-person perspective |
| R2 | Multiplayer |
| R3 | Runs in the browser, no install |
| R4 | Shooter |
| R5 | Built for personal entertainment |
| R6 | TypeScript throughout |
| R7 | Three.js for rendering |
| R8 | Rapier for physics |
| R9 | Node.js game server |
| R10 | WebSockets for realtime transport |
| R11 | Firebase for identity and persistence |
| R12 | GLB/glTF for 3D assets |
| R13 | Playwright for end-to-end testing |
| R14 | Git for version control |

Everything not in this table is either derived in `ARCHITECTURE.md` as a
technical consequence, or is **OPEN** and listed in §6.

---

## 3. Design pillars

Pillars are the tie-breakers when two designs are both defensible.

1. **Readable combat.** A player must always be able to tell what killed them
   and why. Clarity beats spectacle.
2. **It feels good before it looks good.** Movement, camera and shooting feel are
   tuned before any art passes.
3. **Server truth, client comfort.** The server decides. The client hides latency
   well enough that the decision feels immediate.
4. **Instant to enter.** From URL to in-game in seconds. No launcher, no lobby
   ceremony, no mandatory account creation.
5. **Small and finishable.** A narrow game that is complete beats a broad game
   that is perpetually half-built.

---

## 4. Scope

### In scope

- Third-person character control: move, look, sprint, jump, crouch, aim.
- Over-the-shoulder camera with aim-down-sights framing and collision handling.
- Hitscan and/or projectile weapons (**OPEN** which — see §6).
- Server-authoritative shooting with lag compensation.
- Health, damage, death and respawn.
- Multiple players in a shared match on a shared map.
- Firebase identity, player profile, and persistent lifetime statistics.
- A small number of hand-built maps.
- Desktop browser support.

### Explicitly out of scope

Listed so they are never quietly added:

- Mobile and touch controls.
- Console or native builds.
- Voice chat.
- Monetisation, cosmetics economy, battle pass, loot boxes.
- Ranked matchmaking, ELO, leaderboards beyond personal stats.
- Anti-cheat beyond ordinary server authority and input validation.
- Destructible or player-built environments.
- Vehicles.
- Large player counts (battle-royale scale).
- Localisation.
- User-generated content.

### Non-goals

- **Not** a competitive esport. No frame-perfect netcode guarantees.
- **Not** infinitely scalable. A handful of concurrent matches is success.
- **Not** a game engine. Nothing is generalised for reuse in other projects.

---

## 5. Target experience

- **Platform:** desktop browser, mouse and keyboard. *(Follows from R3 and the
  exclusion of mobile in §4.)*
- **Required capabilities:** WebGL2 and WebAssembly. *(Technical consequence of
  R7 and R8 — Three.js and Rapier need them. Not a preference.)*

The following two are **ASSUMPTIONS, not confirmed requirements.** They are
written down here so they are visible and can be corrected, per `CLAUDE.md` §3.

- **ASSUMPTION — browser support:** current Chromium-based browsers are the
  development target; Firefox and Safari are best-effort. *Not specified by the
  developer.* See **Q20**.
- **ASSUMPTION — performance target:** 60 FPS at 1080p on a mid-range discrete
  GPU. *A placeholder figure, not a measured budget and not a stated
  requirement.* See **Q21**.
- **ASSUMPTION — session shape:** drop in, play a short match, drop out. This
  follows from design pillar 4 and the out-of-scope list, but match length is
  formally **Q3**.

---

## 6. OPEN questions

**These are unresolved. Do not assume an answer, do not build against a guess.**
Each must be decided by the developer before the phase that depends on it.

### Game design

| ID | Question | Blocks phase |
| -- | -------- | ------------ |
| Q1 | How many players per match? | Phase 4 |
| Q2 | Game mode(s)? Free-for-all deathmatch, team deathmatch, objective? | Phase 6 |
| Q3 | Match length and win condition? Score limit, time limit, rounds? | Phase 6 |
| Q4 | Weapon roster — how many, and what kinds? | Phase 5 |
| Q5 | Hitscan, projectile, or both? | Phase 5 |
| Q6 | Ammo, reloading, and weapon pickups — present or absent? | Phase 5 |
| Q7 | Health regeneration, health pickups, or neither? | Phase 5 |
| Q8 | Respawn rules — instant, timed, wave-based? | Phase 6 |
| Q9 | Movement abilities beyond walk/sprint/jump/crouch (dash, slide, mantle)? | Phase 2 |
| Q10 | Art direction — realistic, stylised, low-poly, sci-fi, contemporary? | Phase 8 |
| Q11 | Number and size of maps at first playable build? | Phase 8 |
| Q12 | Does the character have a visible body and animation set from the start, or is a capsule acceptable through Phase 5? | Phase 2 |

### Technical / operational

| ID | Question | Blocks phase |
| -- | -------- | ------------ |
| Q13 | Where does the game server run? (local only, VPS, container host) Firebase Hosting **cannot** host it — it serves static files only. | Phase 3 |
| Q14 | How do players find a match — a fixed server URL, a room code, or a server list? | Phase 6 |
| Q15 | Which Firebase products are in use? Auth and Firestore are assumed necessary; Hosting, Storage and Analytics are undecided. | Phase 7 |
| Q16 | Which sign-in methods? (anonymous, Google, email/password) | Phase 7 |
| Q17 | Is there any persistent progression, or are stats display-only? | Phase 7 |
| Q18 | Is a dedicated audio pass in scope, and is there an audio asset budget? | Phase 9 |
| Q19 | Are third-party (free/CC) assets acceptable, or is all art to be self-made? | Phase 8 |
| Q20 | Which browsers must be supported, and to what standard? §5 currently *assumes* Chromium-first, Firefox/Safari best-effort. | Phase 10 |
| Q21 | What is the performance target, and on what reference hardware? §5 currently *assumes* 60 FPS at 1080p on a mid-range discrete GPU. | Phase 9 |
| Q22 | The repository's default branch is `master` (tracking `origin/master`), but `CLAUDE.md` §10 refers to `main`. Which is correct? | Phase 1 |
| Q23 | "Phase 3" now names two different things: the roadmap's Server Core & Transport, and the character integration delivered on 2026-08-10. Renumber the roadmap, or keep character work outside the numbering? | Nothing — but every phase reference stays ambiguous until answered |

### Answered

| ID | Date | Decision |
| -- | ---- | -------- |
| Q9 | 2026-08-10 | Movement is walk, run, sprint, jump and crouch only. Sliding is explicitly deferred; dash and mantle are not in scope. Decided by the Phase 1 brief. |
| Q12 | 2026-08-10 | A **visible humanoid is required from the first playable build** — a capsule is not acceptable as the player representation. A clearly-marked placeholder may stand in until a licensed rigged asset is supplied. |
| Q19 | 2026-08-10 | Third-party assets **are** acceptable provided the licence permits this use; CC0 is preferred (Quaternius, Poly Pizza, Mixamo-compatible). Licence-unclear assets remain banned (`CLAUDE.md` §8). |

---

## 7. Risks

| Risk | Why it matters | Current mitigation |
| ---- | -------------- | ------------------ |
| Netcode complexity | Prediction, reconciliation and lag compensation are where hobby shooters die. | Phase it: replication before prediction, prediction before lag compensation. Build the debug tooling in Phase 4, not later. |
| Physics divergence | Client-predicted and server-authoritative Rapier states can drift. | One shared, fixed-timestep simulation module. Never fork movement logic. |
| Browser performance ceiling | WebGL2 + WASM physics on a main thread is a real budget. | Measure from Phase 2 onward. Keep the art budget deliberately low. |
| Asset acquisition | Art is the usual stall point for a solo developer. | Placeholder-first. Grey-box everything. Q19 decides sourcing early. |
| Scope creep | A shooter invites endless features. | The out-of-scope list in §4 is binding. |
| Solo bandwidth | One developer, personal project, finite evenings. | Small phases with hard exit criteria; a playable build as early as Phase 4. |

---

## 8. Definition of success

NULLPOINT succeeds when the developer and a few friends can open a URL, land in
the same match, and have a genuinely fun ten minutes — with movement that feels
good, shooting that feels fair, and no visible desync.

Anything beyond that is optional.
