# Security

## Firewall

- Public ingress: **443/tcp** (reverse proxy) and **`7777–7787/udp`** (game traffic).
  That's the default. In raw-IP mode without a domain, client-facing service
  ports (Mothership, EOS gateway + websocket) are also opened because clients
  must reach them directly — but **never StationDb (`:78`) or the dashboard
  (`:8080`)** unless explicitly enabled (see below).
- StationDb (`:78`) carries open game-server self-registration. The installers
  leave it closed (`ORION_EXPOSE_STATIONDB=0`). Open it only when game servers
  run on other hosts, and scope it with `ORION_STATIONDB_CIDR` (a VPC range or
  the game hosts' IPs). Optional `ORION_REQUIRE_REGISTRATION_KEY=1` adds a
  server-key check — enable only after confirming your payloads authenticate on
  `POST /register_server`.
- Your hosting provider may have an **external firewall in its panel** in addition
  to the host firewall (`ufw` / Windows Firewall). Both must allow the traffic;
  "the port is open but nobody can connect" is usually the external one — and the
  UDP range is the rule people forget.
- Keep `9095/9100` (orchestrator) and `8080/3000` (dashboard) off the internet.
  Agent hosts authenticate to `:9100` with `ORION_AGENT_KEY`, but the port must
  still stay private (tunneled or firewalled to agent hosts).
- Reach the dashboard over SSH: `ssh -L 8080:127.0.0.1:8080 user@host`.

## Secrets

- All secrets live in `.env` (never committed — it is gitignored) and reach the
  backend as environment variables. The installers refuse to run while required
  keys are still placeholders (`CHANGE_ME` / `YOUR_*`), and auto-generate
  `ORION_DB_PASSWORD` + `ORION_AGENT_KEY` into `.env` on first run (never printed).
- Set `ORION_ENVIRONMENT=Production` for public deployments: the backend then
  refuses to start on placeholder/short secrets, enabled debug endpoints,
  attestation fail-open, or insecure mode. Development (default) stays
  frictionless with warnings only.
- Canonical dashboard variables are `ORION_DASHBOARD_ADMIN_KEY` /
  `ORION_DASHBOARD_SESSION_SECRET` everywhere (backend, dashboard UI,
  installers, docs). Bare `DASHBOARD_*` names still work as legacy fallbacks —
  if logins fail after an upgrade, a randomly-generated key in the log means
  the canonical variable wasn't picked up.
- Rotate any credential that was ever pasted into a log, chat, or screenshot.
- Generate keys with `openssl rand -hex 32`.
- The backend fails safe when unconfigured:
  - Missing `ORION_SERVER_API_KEY` → server-gated routes deny (placeholder never matches).
  - Missing `ORION_META_APP_*` → platform attestation cannot pass; client logins are denied.
  - Missing `ORION_DASHBOARD_API_KEY` → station-key auth denies, even against the literal placeholder.
  - Missing `ORION_JWT_SECRET` → a random secret is generated per run (sessions reset on restart).
- Dashboard secrets (`ORION_DASHBOARD_ADMIN_KEY`, `ORION_DASHBOARD_SESSION_SECRET`)
  are env-only: if unset, the backend generates random ones per run and prints them
  once. Set them in `.env` for stable logins.

## What must never be committed

- `.env`, `windows/server.config.psd1`, `run/` (generated wrappers embed secrets),
  `server_api_key.txt`, tunnel credential JSONs, `*.db`, `logs/`, certificates.
- The installer-generated `run/backend.cmd` / `backend.env` contain real secrets.

## TLS / reverse proxy

- Terminate TLS at the reverse proxy (Caddy, see `deploy/Caddyfile.example`).
  Backend service ports stay on loopback; only 443 is public.
- Game traffic is raw UDP and cannot go through the proxy — it needs the public
  IP:port directly (that's `ORION_PUBLIC_HOST` / `RegisterIp`).

## Auth model (know what you're operating)

- `POST /register_server` on StationDb is **open by design** — game servers
  self-register without a key. Keeping `:78` private is the actual access control;
  anyone who can reach it can plant ghost stations in the browser. Delete ghosts
  with `DELETE /stations/{id}` (key-gated). The public Caddy host blocks
  server-control paths (`/register_server`, `/server_heartbeat`,
  `/update_player_count`, `/stations/create`, `/v1/server/admin/*`,
  `/v1/board/upload`) — see `docs/PORTS.md` — so closing firewall `:78` is not
  bypassed by the proxy. Optional `ORION_REQUIRE_REGISTRATION_KEY=1` adds an
  `x-server-api-key` check on the three reporting routes (enable only after
  confirming your payloads authenticate there).
- Game-server privileged calls (join gate, quest fetch, spec routes) require
  `ORION_SERVER_API_KEY` (`x-server-api-key`) or `ORION_AUTOMATION_KEY`
  (`x-automation-key`), compared in constant time.
- Allocator agents authenticate to `:9100` with `ORION_AGENT_KEY`
  (constant-time compare; loopback skips it). Unauthenticated peers are dropped
  before any message is honored, oversize input (>64 KB) or a >10 s handshake
  disconnects, and failures log the remote address only — never key material.
- Dashboard `/api/*` requires the admin key header or a session cookie.
- StationDb writes from outside the host additionally pass `StationApiGuard`
  (deny-by-default for non-loopback writes); `ORION_INSECURE`-style bypasses
  (`ORION_INSECURE=1`, `ORION_ALLOW_NONSTORE=1`) are dev-only and the installer
  makes you confirm before enabling them.
- Because Caddy reaches StationDb over loopback, public proxy traffic carries
  `X-Orion-Public-Proxy: 1` (set by Caddy, exact match, loopback sockets only)
  and the guard treats it as external — a public request is never mistaken for
  trusted localhost traffic. Direct remote clients sending the header gain
  nothing (remote is already external).
- Orchestrator mutating routes (`POST /spinup`, `/watchdog/retire|resume` on
  `:9095`) require loopback or `ORION_SERVER_API_KEY`. The agent wire protocol
  (`:9100`) authenticates remote agents via `ORION_AGENT_KEY` — the port must still
  stay private regardless.
- Debug introspection (`/debug/storage`) is disabled unless
  `ORION_ENABLE_DEBUG_ENDPOINTS=true`. The `/storage/{key}` admin routes always
  require the server/automation credential, and API-key records are returned
  metadata-only (secret material never leaves the backend).
- Platform verification fails closed: `ORION_ALLOW_ATTESTATION_FAIL_OPEN`
  defaults to `false`. Provider errors deny; enable fail-open for local
  development only.
- The backend binds loopback by default (`ORION_HTTP_BIND`, `ORION_AGENT_BIND`).
  Proxy IP headers are ignored unless `ORION_TRUST_PROXY_HEADERS=true` — enable
  only behind a trusted reverse proxy, or clients can spoof the IPs that gating
  decisions depend on.

## Operations

- Run the backend as a dedicated low-privilege user (`ORION_SERVICE_USER`;
  systemd unit / scheduled task provided by the installers) with restart-on-failure.
- File permissions: `.env` / `backend.env` readable only by the service user
  (the installer sets mode 600 on Linux).
- Logs can contain usernames, IPs, and login decisions. Account IDs in routine
  auth/userdata logs are short hashes (`user=a91f27c4`), with full IDs only
  under `ORION_VERBOSE_AUTH_LOGGING=true` (dev only). Redact before sharing;
  rotate `ORION_SERVER_API_KEY` / `ORION_AUTOMATION_KEY` if a log leaks.
- Back up the production database file (`*.db` in the backend working dir)
  before upgrades; never commit it.
