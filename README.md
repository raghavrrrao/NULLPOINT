# NULLPOINT

A browser-based, third-person, multiplayer shooter. Personal project, single
developer, built for entertainment.

> **Status: playable single-player combat prototype.** Phases 1 and 2 are
> complete — a third-person character with movement, camera, physics and
> animation, plus an assault rifle with aiming, hitscan, damage, reloading and
> training targets. No multiplayer and no Firebase yet.
> See [PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## Documents

Read them in this order.

| Document | What it owns |
| -------- | ------------ |
| [CLAUDE.md](CLAUDE.md) | Development rules. **Binding** — these outrank convenience. |
| [PROJECT.md](PROJECT.md) | What the game is, scope, design pillars, open questions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Client, server, networking, physics, assets, Firebase, testing |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Phases, exit criteria, current state |
| [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md) | Wire format, message contracts, validation |
| [ASSET_CREDITS.md](ASSET_CREDITS.md) | Every third-party asset and its license |

## Stack

TypeScript · Three.js · Rapier · Node.js · WebSockets (`ws`) · Firebase ·
Vite · Playwright · Git

Adding anything to this list requires explicit approval — see `CLAUDE.md` §4.

## Layout

```
packages/shared    Protocol, simulation, math, constants — imported by both sides
packages/client    Browser: Three.js rendering, input, prediction
packages/server    Node.js: authoritative Rapier simulation, WebSocket transport
assets/            Source art (committed) and built runtime assets (ignored)
tools/             Asset pipeline
tests/             unit · integration · e2e
docs/adr/          Architecture Decision Records
```

`shared` imports nothing. `client` and `server` never import each other.

## Two rules worth repeating

1. **The server is authoritative.** The client renders, predicts and requests.
   It never decides a hit, a death, a score or a spawn.
2. **No phase starts until the developer says so.** See `PROJECT_STATUS.md`.

## Getting started

Requires Node 22 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Vite dev server for the client |
| `npm run build` | Production client bundle |
| `npm run preview` | Serve the production bundle |
| `npm run typecheck` | `tsc --noEmit` across every package |
| `npm test` | Unit tests (Node's built-in runner) |
| `npm run test:e2e` | Playwright end-to-end tests |

Playwright needs its browser once: `npx playwright install chromium`.

## Controls

| Input | Action |
| ----- | ------ |
| `W` `A` `S` `D` | Move, relative to the camera |
| Mouse | Look (click the canvas to capture the cursor, `Esc` to release) |
| Left mouse | Fire (automatic) |
| Right mouse | Aim |
| `R` | Reload |
| `Shift` | Sprint |
| `Alt` | Walk |
| `Space` | Jump |
| `Ctrl` or `C` | Crouch |
| `F3` | Toggle the development HUD |

The player character is a **clearly-marked placeholder** — no suitably licensed
rigged humanoid is in the repository yet. To use a real one, drop a GLB in
`packages/client/public/models/`, set `VITE_CHARACTER_GLB` to its URL, and record
it in [ASSET_CREDITS.md](ASSET_CREDITS.md) first.
