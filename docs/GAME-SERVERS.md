# Game servers

Game servers are **Windows-only**: a headless UE server exe plus an injected
payload DLL that talks to this backend. They connect *out* to the backend, so
they can run anywhere with a public UDP port — same box as the backend or a
separate Windows host. This repo ships **no game binaries**; you supply a
compatible game build and payload yourself.

## What "compatible" means

- The payload registers against StationDb and stamps the backend's
  `ORION_BUILD_VERSION` onto every session. The client filters the server list
  by build: **game build = `ORION_BUILD_VERSION` = client build**, or the
  station is silently filtered out ("login works, no stations" is almost always
  a build mismatch).
- The client discovers servers through the EOS gateway (`/matchmaking/.../filter`)
  served on `:50` (public via `orion-eos.<domain>`), and joins over raw UDP.

## Configure one server

1. `Copy-Item windows\server.config.psd1.example windows\server.config.psd1` and edit it:
   - `GameExe` — path to your headless server exe.
   - `DllPath` — path to your compatible payload DLL.
   - `DashboardApiUrl` — StationDb origin (e.g. `http://127.0.0.1:78` on one box,
     or `https://orion.<domain>` remote). **Required for in-game quests**: without
     it the server never completes the dashboard login and quests never initialise.
   - `DashboardApiKey` — must equal `ORION_DASHBOARD_API_KEY` in the backend `.env`.
   - `RegisterIp` — public IP clients connect to (blank = auto-detect; if detection
     fails the server refuses to register rather than publishing a wrong address).
   - `ExtraArgs` — `-MothershipHost/Port`, `-BackendHost/Port`, `-ServerName`,
     and `-ServerApiKey` (= `ORION_SERVER_API_KEY`). Use loopback + service ports
     for single-box, public hostnames + 443 behind a proxy for split setups.
2. `cd windows ; .\Start-Server.ps1` (add `-Instances N` for N servers on
   7777, 7778, …). `-Status` / `-Stop` manage running servers.
3. Confirm registration in the backend log: `register_server -> {"success":true,…}`.

## How registration works

On spin-up the payload calls:

```
POST http://<backend>:78/register_server
{
  "ip": "203.0.113.10", "port": "7777",
  "deployment_id": "<optional pre-minted id>",
  "server_name": "Orion", "region": "NAE",
  "max_players": 10
}
→ { "success": true, "station_id": "…", "deployment_id": "…" }
```

This creates a station + online deployment and an EOS session stamped with the
fleet build, which is what appears in the in-game browser. Re-registering with
the same `deployment_id` upserts (no duplicate stations); the dashboard's
Spin Up name sticks via `PendingNames`.

Runtime chatter (all StationDb, all open-by-design reporting calls):

| Call | Purpose |
|------|---------|
| `POST /update_player_count` | `{deployment_id, player_count}` — reconciles the displayed count |
| `POST /server_heartbeat` | `{deployment_id, pid, seq, dispatch_age_ms, tick_age_ms, uptime_ms, players}` every ~5s — feeds the watchdog |
| `GET /v1/deployments/{id}?include_station_config=true` | station config / board URLs (needs `DashboardApiUrl` + key) |
| `POST /v1/server/authorized` (Mothership `:90`) | join gate — key-gated, checks the player session |

Unregister on shutdown where your payload supports it; otherwise delete ghosts
with `DELETE /stations/{id}` (key-gated, see below).

## Orchestrator (Spin Up button)

The dashboard's **Spin Up** relays through the in-process HalcyonSocket server
(control `:9095`, agent TCP `:9100`). An `OrionAgent.ps1` on each game host
connects to `:9100`:

```powershell
# Same box (loopback): no key needed.
.\OrionAgent.ps1 -HubHost 127.0.0.1 -Capacity 2
# Remote host: authenticate with the backend's ORION_AGENT_KEY.
$env:ORION_AGENT_KEY = "<from backend .env>"
.\OrionAgent.ps1 -HubHost <backend-host> -Capacity 2
```
Spin Up mints a deployment id and the least-loaded agent launches + injects a
server with `-DashboardDeploymentId=<id>`, which then self-registers under it.
The watchdog probes agents before replacing dead servers. **Keep 9095/9100
private** — remote agents authenticate with `ORION_AGENT_KEY` (constant-time
compare; unauthenticated peers are dropped before any message is honored), and
the `:9095` control
routes additionally require loopback or `ORION_SERVER_API_KEY`. For agents on
other hosts, set `ORION_AGENT_BIND` on the backend and firewall `:9100` to
those hosts (see `docs/PORTS.md`).

## Remote game servers (split deployment)

1. On the backend: set `ORION_PUBLIC_BIND=0.0.0.0` (installers do this when no
   domain/tunnel is set), `ORION_EXPOSE_STATIONDB=1` with `ORION_STATIONDB_CIDR`
   scoped to your game hosts, and `ORION_AGENT_BIND` to a LAN IP (or `0.0.0.0`)
   with `:9100` firewalled to those hosts.
2. Copy `ORION_SERVER_API_KEY`, `ORION_DASHBOARD_API_KEY`, and `ORION_AGENT_KEY`
   from the backend `.env` — never commit or transmit them insecurely.
3. On the game host: `windows/server.config.psd1` points at the backend's public
   hostnames/ports; `OrionAgent.ps1` uses `-HubHost` + the agent key above.
4. Prefer a private network (VPC/VNet) between backend and game hosts over raw
   Internet exposure.

## Quests checklist (when quests don't appear)

1. `DashboardApiUrl` + `DashboardApiKey` set on the game server (StationDb, key matches).
2. Client and game server point at the **same** backend (mothership + dashboard URLs agree).
3. `ORION_BUILD_VERSION` equals the client build.
4. No `-NoAuthGate`-style testing flags in production `ExtraArgs`.
5. Backend log shows the dashboard login succeeding for the deployment.

## Useful launch flags (payload-dependent)

| Flag | Effect |
|------|--------|
| `-ServerName=` | station name in the browser |
| `-ServerApiKey=` | backend shared secret (required) |
| `-MothershipHost=` / `-MothershipPort=` | login/auth + quest fetch endpoint |
| `-BackendHost=` / `-BackendPort=` | registration + heartbeat endpoint |
| `-DashboardDeploymentId=` | pin to a pre-minted deployment (orchestrator) |
| `-RegisterIp=` | override advertised public IP |

## Operator API (StationDb, key = `ORION_DASHBOARD_API_KEY` in `x-api-key`)

```bash
S=http://127.0.0.1:78   # or https://orion.<domain>
# list stations (source of truth for the browser)
curl -s -H "x-api-key: $KEY" $S/stations
# delete a ghost station
curl -s -X DELETE -H "x-api-key: $KEY" $S/stations/<station_id>
```
