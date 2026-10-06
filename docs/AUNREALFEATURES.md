# AUnrealFeatures integration

Orion Copy Server is the **deployment** layer. It hosts the backend services;
game / platform logic lives in the AUnrealFeatures service projects it is built
from. You don't need the upstream repo to run this — the needed sources are in
`backend/src/` — but this page maps the pieces so you know what talks to what.

## Architecture

```
Orion-compatible client
        │  HTTPS (login, stations, EOS)          UDP (gameplay)
        v                                        │
AUnrealFeatures / backend (this repo)            │
  :90  Mothership (auth)                         │
  :78  StationDb (stations/roles)                │
  :50/:80 EOS gateway + websocket (server list)  │
        │                                        │
        v                                        v
Orion Copy Server deployment  ──registers──▶  Game server instance
        │                                     (registers, heartbeats,
        v                                      serves players)
Operator dashboard (:8080 / :3000)
```

## Service map (`backend/src/`)

| Project | Role in this deployment |
|---|---|
| `AUnrealFeatures.Ares` | Host: StationDb (`:78`), dashboard API (`:8080`), wiring, startup |
| `AUnrealFeatures.AAMothership` | Mothership (`:90`): client login, attestation, player data, join gate |
| `AUnrealFeatures.EOSSDK` | EOS-compatible gateway (`:50`) + websocket (`:80`): server list, sessions, lobbies, presence, TURN/RTC issuance |
| `AUnrealFeatures.HalcyonSocket` | Orchestrator (`:9095` control, `:9100` agent TCP) + server watchdog (legacy component name, see below) |
| `AUnrealFeatures.Hosting` | HTTP + websocket framework (concurrent dispatch, bounded), LiteDB layer |
| `AUnrealFeatures.DependencyInjection` | DI container used by Hosting |

> **Legacy compatibility names retained on purpose.** `AUnrealFeatures.HalcyonSocket`
> (namespace, assembly, log tags, and the `HalcyonSocketServer` class) is a
> wire/API-compatible component identifier: allocator agents and game-server
> payloads speak this protocol, so renaming the assembly would break binary
> compatibility. Operator-facing names (scripts, tasks, services, docs) use
> Orion naming instead (`windows/OrionAgent.ps1`, `OrionCopyServer` task,
> `orion-copy-server` service).

## Retained third-party compatibility values

These are not Orion Copy Server secrets and are not presented as ours. They stay
because compatible clients/SDKs require their exact shape:

| Value | Where | Why it stays |
|---|---|---|
| `graph.oculus.com/*` endpoints | `MothershipServer`, StationDb nonce checks | Meta platform attestation API (operator credentials via `ORION_META_*`) |
| `https://api.epicgames.dev/auth/v1/oauth` as JWT `iss` | `EosJwtFactory` | EOS SDK clients expect Epic-shaped token issuers from the gateway |
| `SocialSPAClientId`, Epic URL suffixes | EOS endpoint tables | Epic SDK default table entries; the SDK parses their shape |
| `stun.l.google.com:19302` | EOS endpoint tables (P2P ICE) | Public Google STUN; clients need at least one reachable STUN |
| `api.oriondrift.net` (comment only) | StationDb v2 routes | Documents the live service host clients default to (overridable via `DashboardApiUrl`) |
| `a2-sandboxprojects.s3.amazonaws.com` (comment only) | `windows/Start-Server.ps1` | Explains which game download host requires the bundled root CA |

No private operator values hide in this list: TURN/RTC hosts, EOS identity IDs,
and all credentials are tokens or environment-driven (see Configuration).

## How the pieces interact

- **Ares (StationDb)** — game servers `POST /register_server`; the dashboard
  manages stations/roles/deployments. Must know the fleet build
  (`ORION_BUILD_VERSION`) because sessions are stamped with it.
- **EOS / session services** — `EosGatewayServer` keeps the in-memory session
  list that `/matchmaking/.../filter` serves. StationDb upserts sessions on
  registration; the watchdog drops them when a deployment goes offline.
- **Mothership** — verifies platform attestation (Meta `graph.oculus.com`)
  using `ORION_META_APP_ID` / `ORION_META_APP_SECRET`, issues player JWTs
  (signed with `ORION_JWT_SECRET`), and answers the game server's join gate.
- **GameSocket / server communication** — game servers report over plain HTTP
  to StationDb (`update_player_count`, `server_heartbeat`); players connect to
  the allocated `IP:UDP_PORT` directly. `ORION_PUBLIC_HOST` / `RegisterIp` is
  the address clients are told to dial — it must be the public one.
- **Backend host configuration** — game servers and clients need the same
  backend: `-MothershipHost/Port`, `-BackendHost/Port`, `DashboardApiUrl`
  (see `docs/GAME-SERVERS.md`).

## EOS endpoint table

The gateway serves its SDK endpoint table at `/sdk/v1/default` (product table
at `/sdk/v1/product/{id}`) from the embedded
`Responses/{custom,default}_endpoints.json`. The sources carry a
`__ORION_EOS_HOST__` token instead of a hostname:

- `install.ps1` / `install.sh` substitute the token with your EOS public host
  before publishing (default: `orion-eos.<domain>`, else the public host).
- `ORION_EOS_HOST` at **runtime** overrides the baked value, so a moved
  deployment can be repointed without republishing.
- If neither is set, the token stays literal and clients fail loudly instead
  of reaching a wrong server.

## What is intentionally NOT here

PlayFab-compatible services, content-delivery networks, and game-specific
payload sources are out of scope for the deployment toolkit (no PlayFab signing
code ships here, so no `ORION_PLAYFAB_*` variables exist): bring your own
compatible game build + payload DLL (see `docs/GAME-SERVERS.md`) and point them
at this backend. No private deployment values are embedded anywhere — every
operator-specific value arrives via `.env` / environment.
