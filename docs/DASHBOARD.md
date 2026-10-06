# Dashboard

The operator UI lives in `backend/dashboard/` (Next.js, React 19). It serves
operator pages (Home, Users, Stations + detail, Deployments, Events, Fleets,
Moderation, Operators, Players, Reports, Telemetry, WS Monitor, Audit) and
proxies two backend APIs with server-side credentials — the browser never sees
any key:

| Browser path | Proxied to | Credential (server-side) |
|---|---|---|
| `/api/*` | Control API `:8080` (`ORION_DASHBOARD_API_ORIGIN`) | `x-dashboard-key: ORION_DASHBOARD_ADMIN_KEY` |
| `/game/*` | StationDb `:78` (`ORION_STATIONDB_ORIGIN`) | `x-api-key: ORION_DASHBOARD_API_KEY` |

## Enable it

Windows: `install.ps1` installs, builds, and registers the full UI automatically
as the `OrionCopyServerDashboardUi` startup task **if Node.js 20+ is on PATH**
(requires `npm` + `node`). Without Node it warns, skips, and everything else
still works. Add it later with:

```powershell
winget install OpenJS.NodeJS.LTS   # then open a NEW shell so PATH updates
.\install.ps1 -NoBuild             # skips dotnet publish, still does the UI
```

Set `ORION_INSTALL_DASHBOARD_UI=0` in `.env` to opt out (or `-NoDashboardUi`).
Linux: `install.sh` does not install the UI — run it manually:

```bash
cd backend/dashboard && npm install && npm run build
ORION_DASHBOARD_ADMIN_KEY=<key> ORION_DASHBOARD_SESSION_SECRET=<secret> \
ORION_DASHBOARD_API_KEY=<station-key> \
npm run start -- -p 3000 -H 127.0.0.1
```

Dev loop: `backend\run-dashboard.cmd` (`npm run dev` on `localhost:3000`), or
`backend/dashboard/.env.local` (see `backend/dashboard/.env.example`).

It binds **127.0.0.1 only**, so it is not reachable from the internet even if the
port were open.

## Authentication

- Browser login (`/login` → `POST /dash-login`, rate-limited with a hard-capped
  bounded limiter, same-origin enforced) mints an `httpOnly` + `SameSite=Lax`
  session cookie (`orion_auth`), HMAC-signed with `ORION_DASHBOARD_SESSION_SECRET`
  (falls back to the admin key). `secure` is set automatically in production builds.
- Master sessions are bound to the credential that minted them (keyed fingerprint):
  rotating `ORION_DASHBOARD_ADMIN_KEY` (or the session secret) invalidates
  outstanding master cookies. Scoped keys are governed by the key registry instead.
- Secrets are validated in-app: placeholders, obvious values, short admin keys
  (<20 chars) or session secrets (<32 chars) are refused with 503 — a manual run
  with insecure values can never silently become an insecure deployment.
- Operator keys: the master key plus revocable scoped keys (`operators` page)
  with per-station and per-permission scoping (`stations:view/manage/launch`,
  `users:view/ban`, `global:levels/netvars`). Optional
  `ORION_DASHBOARD_EXTRA_KEYS` adds generic extra full-access keys.
- Scoped-key revocation and the audit log persist only when a Redis-compatible
  store is configured (`OPERATOR_STORE_REST_URL/TOKEN`, Upstash/Vercel-KV
  compatible); without it, keys still verify but revocation/audit are
  best-effort in-memory. The store token travels only as a server-side
  `Authorization: Bearer` header, never to the browser.
- Pages are split by role: global views need master, station views need the
  matching station scope; API routes re-check every call (never trust the page).
- Optional Meta SSO (`/auth/login` on `:8080`) needs `ORION_META_ORG_ID` plus
  `ORION_DASHBOARD_ORIGIN` registered as the redirect origin; without them the
  route refuses and the operator key remains the way in.

Unauthenticated page visits redirect to `/login`; unauthenticated API calls get
401 (never a redirect, so `fetch` callers can't mistake HTML for JSON).

## Access it safely (SSH tunnel — recommended)

Keep 3000 and 8080 firewalled off and forward them:

```bash
ssh -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080 user@your-host
```

Then browse `http://localhost:3000` on your own machine. On the host itself,
just open `http://localhost:3000` (RDP/console — no tunnel needed).

Login rate limiting is per-IP only when `ORION_TRUST_PROXY_HEADERS=true` behind
a trusted reverse proxy; otherwise all direct clients share one global budget
(which still stops brute force, without pretending per-IP precision exists).

## Exposing it on a subdomain (after hardening)

1. Confirm auth is enforced: unauthenticated `/api/*` calls get 401 (check the log).
2. Add a DNS A record `orion-dash.<domain>` → your host.
3. Add to the Caddyfile (see `deploy/Caddyfile.example`):

```caddy
orion-dash.YOUR_DOMAIN {
	reverse_proxy 127.0.0.1:8080
}
```

`systemctl reload caddy` (or restart the Windows proxy). Keep 8080 closed in
the firewall — Caddy on 443 is the only public path in.

## Backend route coverage

Core operator flows are served by this repo's backend on `:8080` (stations,
users, deployments, events, spin-up, bans, roles, whitelist, config, sessions,
telemetry, WS monitor, netvar dumps, spec levels). Extended sections need
backend routes outside this trimmed tree and show backend errors until then:

| Section | Backend routes | Status here |
|---|---|---|
| Stations, Users, Deployments, Events, Telemetry, WS, Audit (local), Account | `:8080` `/api/*` | ✅ served |
| Spin Up, station create/launch | `:8080` spinup, `/game` StationDb | ✅ served |
| Netvar catalog | bundled synthetic example (`data/netvar-catalog.example.json`) | ✅ example data |
| Fleets (list/read) | StationDb `v2/fleets` reads | ⚠️ read-only; management needs extended routes |
| Players, Drafters, Reports | extended Mothership/StationDb routes | ⚠️ needs extended backend |

## What you can control from it

- **Stations** — list, inspect, delete; per-station config (info-board texture
  URLs, announcements the game reads as config)
- **Deployments** — the running server instances behind each station
- **Users** — roles, kick, mute, warn, ban
- **Orchestrator** — *Spin Up* launches + injects a game server on the
  least-loaded connected agent (agents connect to `:9100`)
- **Operators** — issue/revoke scoped operator keys (persistent with a store)
- **Audit** — mutation history (persistent with a store)
- **Server events / telemetry / WS monitor** — EOS gateway observability

> **Ghost stations:** a station row persists after its game server dies. If the
> browser shows something unjoinable, delete it (`DELETE /stations/{id}` on
> StationDb with the station key). The EOS seed (`Responses/matchmaking.json`)
> must stay `"sessions": []`.
