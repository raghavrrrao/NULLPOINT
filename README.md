# NULLPOINT

A browser-based, third-person, multiplayer shooter. Personal project, single
developer, built for entertainment.

> **Status: pre-production.** Phase 0 (documentation and structure) is complete.
> No game code, no dependencies installed, nothing runs yet.
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

Not yet applicable. Phase 1 sets up the toolchain and will add the commands
here.
