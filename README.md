# Orion Copy Server

Orion Copy Server is a deployment and server toolkit for developers running their own Orion Drift-compatible reimplementations or compatible multiplayer infrastructure.

It provides the backend services an Orion-compatible client and its dedicated game servers need — login/auth, station registry, an EOS-compatible server list, an operator dashboard, and a game-server orchestrator — plus one-command installers for Windows and Linux, and the scripts to run game servers on Windows.

## Features

- **Mothership (`:90`)** — player login, platform attestation, player data, game-server join gate
- **StationDb (`:78`)** — station/deployment registry, roles, self-registration (`POST /register_server`), heartbeats, station config
- **EOS-compatible gateway (`:50` + websocket `:80`)** — server list / matchmaking, sessions, lobbies, presence
- **Operator dashboard** — full UI (`:3000`, loopback) over the control API (`:8080`), with master + revocable scoped operator keys, RBAC, and audit logging
- **Orchestrator** — dashboard *Spin Up* launches game servers on connected allocator agents (`:9095`/`:9100`) with freeze/crash watchdog
- **One-command installs** — `install.ps1` (Windows: backend + game server on one box) and `install.sh` (Linux: backend)
- **Secrets as configuration** — everything operator-specific lives in `.env`; placeholders are rejected, missing config fails safely

## Architecture

```
Orion-compatible client
   │ HTTPS (login, stations, EOS)            UDP 7777+ (gameplay)
   ▼                                         │
┌─ host ─────────────────────────────────────┼──────────────────┐
│ Caddy / tunnel (TLS 443, optional)         │                  │
│   orion-ms.<domain>   → 127.0.0.1:90  Mothership              │
│   orion.<domain>      → 127.0.0.1:78  StationDb               │
│   orion-eos.<domain>  → 127.0.0.1:50  EOS gateway (+ :80 WS)  │
│                                                               │
│ Backend (.NET 6, single process)           │                  │
│ Game server(s), Windows (headless exe + payload DLL) ◄────────┘
│   self-register via POST /register_server, listen UDP 7777+   │
│ Orchestrator :9095 (control) / :9100 (agent TCP, private)     │
└───────────────────────────────────────────────────────────────┘
```

The backend runs on Linux or Windows; **game servers are Windows-only** and
connect out to the backend, so they can live on the same box or a separate host.
You supply the compatible game build + payload DLL yourself — this repo ships
no game binaries. See `docs/GAME-SERVERS.md` and `docs/AUNREALFEATURES.md`.

## Requirements

- **Backend host**: Windows 10/11 / Server 2019+ **or** Ubuntu 22.04+ (Debian-family);
  .NET 6 runtime (installers handle it); public IPv4 for production
- **Game host**: Windows 10/11 / Server 2019+ (.NET 6 + your game build + payload DLL)
- **Public deploy**: a domain you control (short — see below) **or** a tunnel;
  firewall control (host + provider panel); UDP `7777–7787` reachable
- **Clients**: your own Orion-compatible client build + platform app credentials
  (Meta App ID/secret for attestation)

> The in-game dashboard URL is patched in place inside the client and must stay
> **≤ 26 characters** including `https://`. E.g. `https://orion.example.com`
> (25 chars) fits; longer hosts do not.

## Quick start

```powershell
Copy-Item .env.example .env
notepad .env          # set hosts, generate secrets (openssl rand -hex 32)
.\install.ps1         # Windows: backend + game server on one box
```

```bash
cp .env.example .env && nano .env && sudo ./install.sh   # Linux: backend only
```

Then start a game server (Windows):

```powershell
cd windows
Copy-Item server.config.psd1.example server.config.psd1   # first time only
.\Start-Server.ps1
```

## Windows setup

Elevated PowerShell, from the repo root: `.\install.ps1`. It installs .NET,
validates `.env` (refuses placeholders), publishes the backend, reserves the
low ports (`urlacl`), configures the firewall (public: service TCP + game UDP
only), optionally sets up a tunnel, registers the backend as the
`OrionCopyServer` scheduled task (boot + survives logoff, restart-on-failure),
optionally builds + registers the dashboard UI task, imports bundled root CAs,
and pairs `windows\server.config.psd1` to the box (backend over loopback,
`RegisterIp` = public host).

- `.\install.ps1 -Status` — backend, servers, listening ports
- `.\install.ps1 -NoBuild` — re-apply config + restart (after editing `.env`)
- `.\install.ps1 -Uninstall` — stop + remove tasks (leaves data)
- Backend logs: `run\backend\logs\`; restart: `Restart-ScheduledTask -TaskName OrionCopyServer`

## Linux setup

Ubuntu 22.04+ assumed: `sudo ./install.sh`. It installs dependencies + .NET 6,
validates `.env`, publishes to `ORION_INSTALL_DIR` (default
`/opt/orion-copy-server`), writes a mode-600 `backend.env`, grants the .NET
bind capability for low ports, writes + enables the `orion-copy-server`
systemd service (see `deploy/orion-copy-server.service.example`), configures
`ufw`, and sets up Caddy with auto-TLS when `ORION_DOMAIN` is set (see
`deploy/Caddyfile.example`).

- `sudo systemctl status orion-copy-server` / `sudo journalctl -u orion-copy-server -f`
- Reconfigure: edit `.env`, re-run `sudo ./install.sh` (or `--no-build` to skip publish)

## Configuration

Everything lives in `.env` (copy of `.env.example`, never committed):

| Variable | Purpose |
|---|---|
| `ORION_PUBLIC_HOST` | public IP/hostname clients reach |
| `ORION_DOMAIN` | optional domain (enables Caddy/TLS path) |
| `ORION_SERVER_API_KEY` | backend ↔ game-server secret (`-ServerApiKey`) |
| `ORION_AGENT_KEY` | allocator-agent wire credential (`:9100`; auto-generated) |
| `ORION_ENVIRONMENT` | `Development` (default) or `Production` (strict startup validation) |
| `ORION_DASHBOARD_API_KEY` | StationDb key (`-DashboardApiKey` / `x-api-key`) |
| `ORION_DASHBOARD_ADMIN_KEY` / `ORION_DASHBOARD_SESSION_SECRET` | dashboard auth (canonical; legacy `DASHBOARD_*` still accepted) |
| `ORION_DASHBOARD_EXTRA_KEYS` | optional extra full-access dashboard keys |
| `ORION_DASHBOARD_API_ORIGIN` / `ORION_STATIONDB_ORIGIN` | dashboard proxy targets (loopback defaults) |
| `ORION_AUTOMATION_KEY` | server-only automation routes (`x-automation-key`) |
| `ORION_BOOTSTRAP_ADMIN_IDS` | comma-separated global-admin accounts (default: none) |
| `ORION_ENABLE_DEBUG_ENDPOINTS` | debug routes (default `false`) |
| `ORION_REQUIRE_REGISTRATION_KEY` | key-gate `POST /register_server` (default `false`, payload-dependent) |
| `ORION_ALLOW_SHARED_PC_IDENTITY` | shared PC identity mode (default `false`) |
| `ORION_JWT_SECRET` / `ORION_DB_PASSWORD` | token signing / local DB password |
| `ORION_HTTP_BIND` / `ORION_AGENT_BIND` | listener bind (loopback defaults; `0.0.0.0` opt-in) |
| `ORION_TRUST_PROXY_HEADERS` | honor proxy IP headers (default `false`) |
| `ORION_META_APP_ID` / `ORION_META_APP_SECRET` | platform attestation (required for real logins) |
| `ORION_META_PACKAGE_NAME` / `ORION_META_CERT_SHA256` | client package/cert pins (`ORION_QUEST_PACKAGE` / `ORION_QUEST_CERT_SHA256` also read) |
| `ORION_RIFT_APP_ID` / `ORION_RIFT_APP_SECRET` (+ `_FED_`) | optional second app creds |
| `ORION_RIFT_EXTERNAL_ID` / `ORION_RIFT_ORG_SCOPED_ID` | shared PC-flow identity (opaque) |
| `ORION_ENVIRONMENT_ID` / `ORION_TENANT_ID` | deployment IDs echoed in auth responses |
| `ORION_VERBOSE_AUTH_LOGGING` | attestation diagnostics (default `false`, dev only) |
| `ORION_ALLOW_ATTESTATION_FAIL_OPEN` | provider-error fail-open (default `false`, dev only) |
| `ORION_META_ORG_ID` / `ORION_DASHBOARD_ORIGIN` | dashboard SSO (optional) |
| `ORION_QUEST_PACKAGE` / `ORION_QUEST_CERT_SHA256` | client package/cert pins (optional) |
| `ORION_EOS_PRODUCT_ID` / `ORION_EOS_SANDBOX_ID` / `ORION_EOS_DEPLOYMENT_ID` | EOS gateway identity |
| `ORION_EOS_ORG_ID` / `ORION_EOS_CLIENT_ID` | EOS gateway identity |
| `ORION_EOS_HOST` | EOS endpoint-table host (default derived) |
| `ORION_RTC_URL` / `ORION_RTC_API_KEY` / `ORION_RTC_SECRET` | voice provider (room issuance refuses when unset) |
| `ORION_TURN_HOST` / `ORION_TURN_PORT` / `ORION_TURN_SECRET` | TURN server (refuses when unset) |
| `ORION_BUILD_VERSION` | fleet build — must equal the client build |
| `ORION_BACKEND_PORT_*` / `ORION_GAME_UDP_*` | ports (see `docs/PORTS.md`) |
| `ORION_INSECURE` / `ORION_ALLOW_NONSTORE` | dev-only auth relaxations (never public) |

Missing required keys abort the install; missing attestation creds deny logins
loudly at runtime instead of silently misbehaving.

## Ports

| Port | Purpose | Public? |
|---|---|---|
| 443/tcp | reverse proxy (TLS) | yes |
| 7777–7787/udp | game traffic | **yes (UDP)** |
| 90/78/50/80 | backend services (behind proxy) | no (loopback) |
| 8080/3000 | dashboard API/UI | no (tunnel only) |
| 9095/9100 | orchestrator (no auth) | **never** |

Full table: `docs/PORTS.md`. Security model: `docs/SECURITY.md`.

## AUnrealFeatures integration

Backend sources live in `backend/src/` (`Ares` host, `AAMothership` auth,
`EOSSDK` gateway, `HalcyonSocket` orchestrator, `Hosting` framework). The EOS
endpoint tables carry a `__ORION_EOS_HOST__` token the installers substitute
(`ORION_EOS_HOST` overrides at runtime). Details: `docs/AUNREALFEATURES.md`.

## Game-server registration

Servers `POST /register_server` to StationDb (`:78`) with ip/port/name/build,
then heartbeat (`update_player_count`, `server_heartbeat`). The dashboard
*Spin Up* path uses allocator agents (`windows\OrionAgent.ps1` → backend
`:9100`). Details + quest checklist: `docs/GAME-SERVERS.md`.

## Updating

1. Pull / copy the new tree (keep your `.env` and `windows\server.config.psd1`).
2. Windows: `.\install.ps1` (or `-NoBuild` for config-only). Linux: `sudo ./install.sh`.
3. Confirm: `-Status` / `systemctl status`, then check the browser lists stations.
4. Back up the production `*.db` before major updates. Stale ghost stations:
   `DELETE /stations/{id}` with the station key.

## Logs

- Windows: `run\backend\logs\*.txt`, game logs `windows\logs\`, payload log `%TEMP%`
- Linux: `journalctl -u orion-copy-server -f`
- Login/auth lines are tagged `[AUTH]` / `[QUEST-ATT]`; registration lines say `register_server`

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Install refuses to run | placeholder still in `.env` — generate real secrets |
| Clients can't log in | `ORION_META_APP_*` unset/mismatched; check attestation log lines |
| Login works, browser empty | `ORION_BUILD_VERSION` ≠ client build; or no server registered yet |
| Listed but can't join | UDP `7777+` blocked, or `RegisterIp` is a private/loopback address |
| Quests never appear | `DashboardApiUrl`/`DashboardApiKey` missing on the game server; client + server on different backends |
| Ghost stations | dead servers never unregistered — `DELETE /stations/{id}` |
| Dashboard 401s | admin key mismatch — re-enter key, check `ORION_DASHBOARD_ADMIN_KEY` |

## Repository structure

```
.env.example            all operator configuration (placeholders only)
install.ps1             Windows one-shot install (backend + game server)
install.sh              Linux one-shot install (backend)
backend/
  src/                  .NET 6 backend (Mothership, StationDb, EOS, orchestrator)
  dashboard/            Next.js operator UI (stations, users, fleets, moderation,
                        operators, audit, telemetry — proxies :8080 + :78)
  run-backend.cmd       dev loop (needs .NET 6 SDK)
  run-dashboard.cmd     dev loop (needs Node.js)
  *.example.txt         optional quest/cosmetic seed formats (synthetic examples)
windows/
  server.config.psd1.example  game-server config template
  Start-Server.ps1      launch + inject + report game servers
  OrionAgent.ps1        allocator agent for dashboard Spin Up
  Inject.ps1            DLL injection helper
  certs/                public root CAs the game host may need
deploy/
  orion-copy-server.service.example  systemd unit (install.sh writes the live one)
  Caddyfile.example     reverse-proxy + auto-TLS template
docs/                   PORTS, SECURITY, GAME-SERVERS, DASHBOARD, AUNREALFEATURES
```

## Known limitations

- Game servers are Windows-only (UE + injected payload); Linux hosts run the backend only.
- The client needs its own compatible build with backend URLs patched in — the
  dashboard URL cap (26 chars) constrains domain choice.
- `POST /register_server` is open by design; `:78` must stay private (see `docs/SECURITY.md`).
- Orchestrator agent protocol (`:9100`) requires `ORION_AGENT_KEY` (loopback skips
  it), with handshake/message limits — still private network only, never Internet.
- Dashboard Meta SSO is a stub until `ORION_META_ORG_ID` is configured; the admin-key header is the supported path.

## License

MIT — see [LICENSE](LICENSE).
