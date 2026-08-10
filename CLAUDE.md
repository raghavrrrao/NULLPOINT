# CLAUDE.md — NULLPOINT Development Rules

These are the **permanent** rules for this repository. They outrank convenience,
speed, and any suggestion made mid-conversation. If a request conflicts with a
rule here, say so before acting.

---

## 1. Project identity

NULLPOINT is a browser-based, third-person, multiplayer shooter built for
personal entertainment. It is a hobby project with a single developer. It is
**not** a commercial product, and it is not designed for anti-cheat-grade
security or for large-scale concurrency.

Canonical documents — keep them in sync, never let them contradict each other:

| File                 | Owns                                                |
| -------------------- | --------------------------------------------------- |
| `CLAUDE.md`          | Development rules (this file)                        |
| `PROJECT.md`         | What the game is, scope, design pillars, open questions |
| `ARCHITECTURE.md`    | How the system is built                              |
| `PROJECT_STATUS.md`  | Phases, milestones, current state                    |
| `NETWORK_PROTOCOL.md`| Wire format and message contracts                    |
| `ASSET_CREDITS.md`   | Every third-party asset and its license              |

---

## 2. Phase discipline

- Work happens in **phases**, defined in `PROJECT_STATUS.md`.
- **Never begin a phase until the developer explicitly says to start it.**
- Never work ahead into a later phase because it "seems needed now". Raise it,
  record it, wait.
- A phase is done only when every item in its **Exit Criteria** is true. Partial
  completion is reported as partial, never as done.
- When a phase completes, update `PROJECT_STATUS.md` in the same change.

---

## 3. Requirements and assumptions

- **Do not invent requirements.** If a detail is missing (player count, weapon
  behaviour, map layout, scoring, hosting target), stop and ask.
- If something must be assumed to make progress, write the assumption down in
  the relevant document under an explicit *Open Question* or *Assumption*
  heading, label it as such, and flag it in the response.
- Do not silently widen or narrow the requested scope.
- Speculative features are not built. "We might want X later" is a note in
  `PROJECT.md`, not code.

---

## 4. Dependencies

- The approved stack is fixed: **TypeScript, Three.js, Rapier, Node.js,
  WebSockets (`ws`), Firebase, Playwright, Vite.**
- **Any new runtime dependency requires explicit approval.** Ask first, state
  what it is for, what it costs in bundle size, and what the alternative is.
- Prefer the platform and the standard library over a package. No utility
  grab-bags (lodash, moment, and friends).
- No dependency is added "just to try it". No dependency is left installed after
  the experiment that motivated it fails.
- Pin exact versions in `package.json`. Commit the lockfile.

---

## 5. Code standards

- **TypeScript strict mode is mandatory.** `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride` all on.
- **`any` is banned** in committed code. Use `unknown` and narrow. If a third-
  party type is genuinely wrong, write a local declaration with a comment
  explaining why.
- No non-null assertions (`!`) to silence the compiler. Handle the null case.
- Every module has a single clear responsibility. Files over ~400 lines are a
  smell — split them.
- Shared types live in `packages/shared`. **The client and the server never
  define the same wire type twice.**
- Comments explain *why*, not *what*. No commented-out code in commits.
- No `console.log` in committed code — use the project logger.

### Units and conventions (non-negotiable, everywhere)

- Right-handed, **Y-up** coordinate system (Three.js and Rapier agree on this).
- Distance in **metres**, time in **seconds**, mass in **kilograms**,
  angles in **radians**.
- Network timestamps in **milliseconds** as integers.
- Model forward axis is **−Z**. Note this is *not* the glTF convention: the
  glTF 2.0 specification places an asset's front on **+Z**. A conforming asset
  therefore needs a half-turn at import, applied once at the character root and
  never to individual bones.

---

## 6. Architecture rules

- **The server is authoritative.** The client renders, predicts, and requests.
  It never decides a hit, a death, a score, or a spawn.
- Never trust a client packet. Validate every field, clamp every range, and
  rate-limit every message type.
- Client prediction and server simulation must run the **same shared simulation
  code** from `packages/shared/src/sim`. Movement logic is never duplicated.
- **Gameplay traffic goes over WebSockets only.** Firebase is never in the
  realtime loop.
- Rendering code never mutates simulation state. Simulation code never touches
  Three.js.
- No global mutable singletons. Dependencies are passed in.

---

## 7. Networking rules

- The wire format is defined in `NETWORK_PROTOCOL.md`. **Code follows the
  document; if they disagree, the document is updated in the same change.**
- Every protocol change bumps `PROTOCOL_VERSION` and is logged in the
  changelog section of `NETWORK_PROTOCOL.md`.
- Binary messages are little-endian.
- A message with an unknown type, a bad length, or a version mismatch causes a
  clean disconnect with a reason code — never a crash, never a partial read.

---

## 8. Assets

- Runtime 3D assets are **GLB** (binary glTF). Textures are compressed
  (KTX2/Basis) once the pipeline exists; PNG/JPG are acceptable placeholders.
- **Every third-party asset is recorded in `ASSET_CREDITS.md` before it is
  committed** — source URL, author, license, and date acquired. No entry, no
  commit.
- Only assets whose licenses permit this use are allowed. If the license is
  unclear, the asset is not used.
- Editable source files (`.blend` etc.) go in `assets/source/`. Built runtime
  assets are generated by `tools/asset-pipeline` and are **not** committed.
- No asset is hot-linked from a remote host at runtime.

---

## 9. Testing

- **Playwright is the end-to-end harness.** Unit and integration tests use the
  Node built-in test runner unless a different runner is approved.
- Pure logic — protocol encode/decode, simulation step, math — must have unit
  tests. Rendering does not.
- Every protocol message type has a round-trip encode/decode test.
- Multiplayer behaviour is tested with **two real browser contexts** against a
  real server, not with mocks.
- A bug fix starts with a failing test that reproduces it.
- Tests must not depend on wall-clock timing. Inject the clock.
- Never weaken or delete a test to make a build pass.

---

## 10. Git

- `main` stays working. Feature work happens on branches.
- Commit messages: `type(scope): summary` — e.g. `feat(net): add snapshot delta`.
- **Do not commit or push unless the developer asks.**
- Never commit secrets, service-account keys, `.env` files, or Firebase Admin
  credentials.
- Built output, `node_modules/`, and generated assets are ignored, never
  committed.

---

## 11. Security and secrets

- Firebase **client** config is public by design and may be committed.
- Firebase **Admin** credentials are secrets. They live in the environment, never
  in the repository, never in the client bundle.
- Firestore access is constrained by security rules; the rules are part of the
  repository and are reviewed whenever a data shape changes.
- Client-supplied identity is meaningless until the server has verified the
  Firebase ID token.

---

## 12. Working style

- Inspect before you write. Read the existing file before editing it.
- Make the smallest change that fully solves the problem.
- Match the surrounding style rather than importing a new one.
- Report honestly: if something fails, show the output; if a step was skipped,
  say so.
- Do not run the game, install packages, or create infrastructure without being
  asked.
