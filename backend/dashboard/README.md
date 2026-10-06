# Orion Copy Server Dashboard

Operator UI for Orion Copy Server. Proxies the backend control API (`:8080`)
and StationDb (`:78`) with server-side credentials — the browser never sees keys.

## Configure

Copy `.env.example` to `.env.local` and set `ORION_DASHBOARD_ADMIN_KEY`
(generate with `openssl rand -hex 32`). For production, values come from the
repo-root `.env` via `install.ps1` / `install.sh`.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the build (loopback only: next start -H 127.0.0.1)
```

Requires Node.js 20+.

## Auth model

- Browser login (`/dash-login`) mints an `httpOnly` + `SameSite=Lax` session
  cookie (`orion_auth`), HMAC-signed with the session secret.
- Operator keys: master key(s) plus revocable scoped keys (`operators` page,
  persisted only when a Redis-compatible store is configured).
- Same-origin enforcement on mutations; role + station scoping on every proxy
  route; mutations appended to the audit log (best-effort).
- Keep this UI on loopback and reach it over SSH/RDP. See `docs/DASHBOARD.md`.
