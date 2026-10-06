#!/usr/bin/env bash
# =============================================================================
#  Orion Copy Server — one-shot install + start (Ubuntu/Debian, backend only)
#
#    cp .env.example .env && nano .env && sudo ./install.sh
#
#  The game server itself is a Windows binary and cannot run here; it lives on
#  a Windows box and connects OUT to this backend (see docs/GAME-SERVERS.md).
#
#  Idempotent: safe to re-run after editing .env (it re-publishes and restarts).
#  Flags:  --no-build     skip dotnet publish (just re-apply config + restart)
#          --no-firewall  never touch ufw
#          --status       show status and exit
#          --uninstall    stop + remove the service (keeps $INSTALL_DIR data)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

c_ok()   { printf '\033[32m[ok]\033[0m   %s\n' "$*"; }
c_info() { printf '\033[36m[info]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
c_err()  { printf '\033[31m[err]\033[0m  %s\n' "$*" >&2; }
die()    { c_err "$*"; exit 1; }

is_placeholder() {
  case "${1:-}" in
    ""|CHANGE_ME*|YOUR_*|"<FILL_ME"*) return 0 ;;
    *) return 1 ;;
  esac
}

DO_BUILD=1; DO_FIREWALL=1; MODE=install
for a in "$@"; do
  case "$a" in
    --no-build)    DO_BUILD=0 ;;
    --no-firewall) DO_FIREWALL=0 ;;
    --status)      MODE=status ;;
    --uninstall)   MODE=uninstall ;;
    -h|--help)     sed -n '2,14p' "$0"; exit 0 ;;
    *) die "unknown flag: $a" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root:  sudo ./install.sh"

# ── config ───────────────────────────────────────────────────────────────────
[ -f .env ] || die ".env not found. Run:  cp .env.example .env && nano .env"
set -a; . ./.env; set +a
: "${ORION_PUBLIC_HOST:?set ORION_PUBLIC_HOST in .env}"
: "${ORION_INSTALL_DIR:=/opt/orion-copy-server}"
: "${ORION_SERVICE_USER:=orion-copy-server}"
INSTALL_DIR="$ORION_INSTALL_DIR"
SERVICE_USER="$ORION_SERVICE_USER"
SERVICE=orion-copy-server

# ports (defaults match the backend bindings)
: "${ORION_BACKEND_PORT_MOTHERSHIP:=90}"
: "${ORION_BACKEND_PORT_STATIONDB:=78}"
: "${ORION_BACKEND_PORT_EOS:=50}"
: "${ORION_BACKEND_PORT_EOS_WS:=80}"
: "${ORION_BACKEND_PORT_DASHBOARD:=8080}"
: "${ORION_BACKEND_PORT_ORCH_CTL:=9095}"
: "${ORION_BACKEND_PORT_ORCH_AGENT:=9100}"
: "${ORION_GAME_UDP_FIRST:=7777}"
: "${ORION_GAME_UDP_LAST:=7787}"
: "${ORION_BUILD_VERSION:=22284}"

# ── validate required secrets (fail safe: never run on placeholders) ─────────
missing=()
for k in ORION_SERVER_API_KEY ORION_DASHBOARD_API_KEY ORION_DASHBOARD_ADMIN_KEY \
         ORION_DASHBOARD_SESSION_SECRET ORION_AUTOMATION_KEY; do
  v="${!k:-}"
  if is_placeholder "$v"; then missing+=("$k"); fi
done
[ "${#missing[@]}" -eq 0 ] || die "these .env values are still placeholders: ${missing[*]}. Generate real ones (openssl rand -hex 32) and re-run."
is_placeholder "${ORION_META_APP_SECRET:-}" && c_warn "ORION_META_APP_SECRET is not set — platform attestation WILL fail and clients cannot log in."
is_placeholder "${ORION_JWT_SECRET:-}" && c_warn "ORION_JWT_SECRET is not set — a random one is generated per run (sessions don't survive restarts)."

# ── generated secrets (persisted into .env on first run) ─────────────────────
# The database password and agent key must never be a known default. When still a
# placeholder, generate strong random values and write them back into .env so
# re-runs are stable. They are never printed.
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32;
  else od -vN 32 -An -tx1 /dev/urandom | tr -d ' \n'; fi
}
ensure_generated() {
  local var="$1" val="${!1:-}"
  if is_placeholder "$val"; then
    val="$(rand_hex)"
    if grep -q "^${var}=" .env; then
      sed -i "s|^${var}=.*|${var}=${val}|" .env
    else
      printf '%s=%s\n' "$var" "$val" >> .env
    fi
    export "$var=$val"
    c_ok "generated ${var} and saved it into .env (not shown)"
  fi
}
ensure_generated ORION_DB_PASSWORD
ensure_generated ORION_AGENT_KEY

# EOS public host: explicit env wins, else orion-eos.<domain>, else the public host.
if [ -z "${ORION_EOS_HOST:-}" ]; then
  if [ -n "${ORION_DOMAIN:-}" ]; then ORION_EOS_HOST="orion-eos.${ORION_DOMAIN}";
  else ORION_EOS_HOST="$ORION_PUBLIC_HOST"; fi
fi

# Bind policy: loopback by default (proxy on this box reaches it). Raw-IP mode
# has no proxy, so client-facing services must listen publicly to be reachable.
if [ -z "${ORION_DOMAIN:-}" ] && { [ -z "${ORION_PUBLIC_BIND:-}" ] || [ "$ORION_PUBLIC_BIND" = "127.0.0.1" ] || [ "$ORION_PUBLIC_BIND" = "localhost" ]; }; then
  ORION_PUBLIC_BIND="0.0.0.0"
  c_warn "no ORION_DOMAIN set: binding client-facing services to 0.0.0.0 (ORION_PUBLIC_BIND)."
  c_warn "management services stay on loopback. Restrict service ports by firewall (see below)."
fi

if [ "$MODE" = status ]; then
  systemctl --no-pager status "$SERVICE" || true
  echo; c_info "listening sockets:"; ss -lntup 2>/dev/null | grep -E ":(${ORION_BACKEND_PORT_MOTHERSHIP}|${ORION_BACKEND_PORT_STATIONDB}|${ORION_BACKEND_PORT_EOS}|${ORION_BACKEND_PORT_DASHBOARD})\b" || echo "  (none)"
  exit 0
fi
if [ "$MODE" = uninstall ]; then
  systemctl stop "$SERVICE" 2>/dev/null || true
  systemctl disable "$SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICE.service"; systemctl daemon-reload
  c_ok "removed $SERVICE (data left in $INSTALL_DIR)"; exit 0
fi

if [ "${ORION_INSECURE:-0}" = "1" ] || [ "${MOTHERSHIP_INSECURE:-0}" = "1" ]; then
  c_warn "ORION_INSECURE=1 — ALL identity checks are disabled."
  c_warn "This is an open auth bypass. Never leave it on for a public server."
  read -r -p "Continue anyway? [y/N] " r; [ "${r:-N}" = y ] || exit 1
fi

# ── dependencies ─────────────────────────────────────────────────────────────
c_info "installing dependencies…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates ufw libicu-dev >/dev/null

if ! command -v dotnet >/dev/null 2>&1; then
  c_info "installing .NET 6 runtime…"
  # Microsoft's feed varies by release; the official script is version-stable.
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 6.0 --runtime aspnetcore --install-dir /usr/share/dotnet
  ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
fi
command -v dotnet >/dev/null || die "dotnet install failed"
c_ok "dotnet $(dotnet --version 2>/dev/null || echo present)"

# ── build ────────────────────────────────────────────────────────────────────
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR"

# Secrets are env-driven now, so there is nothing to patch into C# constants.
# The only build-time value is the EOS public host inside the embedded endpoint
# tables: substitute the __ORION_EOS_HOST__ token before publishing.
apply_env_to_source() {
  for f in backend/src/AUnrealFeatures.EOSSDK/AUnrealFeatures.EOSSDK/Responses/custom_endpoints.json \
           backend/src/AUnrealFeatures.EOSSDK/AUnrealFeatures.EOSSDK/Responses/default_endpoints.json; do
    [ -f "$f" ] || { c_warn "$f not found; skipping"; continue; }
    if grep -q "__ORION_EOS_HOST__" "$f"; then
      sed -i "s/__ORION_EOS_HOST__/${ORION_EOS_HOST}/g" "$f"
      c_ok "pointed $(basename "$f") at ${ORION_EOS_HOST}"
    fi
    if [ -n "${ORION_TURN_HOST:-}" ] && grep -q "__ORION_TURN_HOST__" "$f"; then
      case "$ORION_TURN_HOST" in CHANGE_ME*|YOUR_*) c_warn "ORION_TURN_HOST is still a placeholder — leaving the TURN token for runtime config." ;; *) sed -i "s/__ORION_TURN_HOST__/${ORION_TURN_HOST}/g" "$f"; c_ok "pointed $(basename "$f") TURN at ${ORION_TURN_HOST}" ;; esac
    fi
  done

  # never ship a seeded ghost station or stale session state
  local MM=backend/src/AUnrealFeatures.EOSSDK/AUnrealFeatures.EOSSDK/Responses/matchmaking.json
  if [ -f "$MM" ] && grep -q '"sessions"[[:space:]]*:[[:space:]]*\[[[:space:]]*{' "$MM"; then
    c_warn "matchmaking.json seeds a fake session — emptying it"
    printf '{\n    "count": 0,\n    "sessions": []\n}\n' > "$MM"
  fi
  rm -f "$INSTALL_DIR/backend/sessions.json" "$INSTALL_DIR/backend/lobbies.json" 2>/dev/null || true
}

if [ "$DO_BUILD" = 1 ]; then
  [ -d backend/src/AUnrealFeatures.Ares ] || die "backend/src/AUnrealFeatures.Ares not found (run from the repo root)"
  c_info "applying .env into backend sources…"
  apply_env_to_source
  if ! command -v dotnet >/dev/null || ! dotnet --list-sdks 2>/dev/null | grep -q .; then
    c_info "installing .NET 6 SDK (needed to publish)…"
    bash /tmp/dotnet-install.sh --channel 6.0 --install-dir /usr/share/dotnet 2>/dev/null || \
      { curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh; bash /tmp/dotnet-install.sh --channel 6.0 --install-dir /usr/share/dotnet; }
  fi
  c_info "publishing backend (this takes a minute)…"
  dotnet publish backend/src/AUnrealFeatures.Ares -c Release -o "$INSTALL_DIR/backend" --nologo -v q
  c_ok "published -> $INSTALL_DIR/backend"
fi

# ── environment file (systemd EnvironmentFile= — clean KEY="value", no comments)
c_info "writing $INSTALL_DIR/backend.env from .env"
{
  while IFS= read -r line || [ -n "$line" ]; do
    l="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$l" in ""|\#*) continue ;; esac
    case "$l" in *=*) ;;
      *) continue ;;
    esac
    k="${l%%=*}"; v="${l#*=}"
    k="$(printf '%s' "$k" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    # strip trailing inline comment ("value   # comment"), tolerate quotes
    v="$(printf '%s' "$v" | sed -e 's/[[:space:]][[:space:]]*#.*$//')"
    case "$v" in \"*\"|\'*\') v="${v#?}"; v="${v%?}" ;; esac
    case "$k" in ORION_*|MOTHERSHIP_*|DASHBOARD_*|BOARD_*|STATION_*)
      # Effective values are appended after the loop; skip them here so the
      # service file carries exactly one assignment (last wins, but be explicit).
      case "$k" in ORION_PUBLIC_BIND|ORION_EOS_HOST|ORION_BUILD_VERSION|ORION_DB_PASSWORD|ORION_AGENT_KEY) continue ;; esac
      v="$(printf '%s' "$v" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
      printf '%s="%s"\n' "$k" "$v" ;;
    esac
  done < .env
  printf 'ORION_PUBLIC_BIND="%s"\n' "${ORION_PUBLIC_BIND:-127.0.0.1}"
  printf 'ORION_EOS_HOST="%s"\n' "$ORION_EOS_HOST"
  printf 'ORION_BUILD_VERSION="%s"\n' "$ORION_BUILD_VERSION"
  # Generated secrets (effective values; never echoed).
  printf 'ORION_DB_PASSWORD="%s"\n' "$ORION_DB_PASSWORD"
  printf 'ORION_AGENT_KEY="%s"\n' "$ORION_AGENT_KEY"
} > "$INSTALL_DIR/backend.env"
chmod 600 "$INSTALL_DIR/backend.env"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
c_ok "wrote $INSTALL_DIR/backend.env (mode 600)"

# Ports <1024 (90/78/50/80) need this or the service must run as root.
DOTNET_REAL="$(readlink -f "$(command -v dotnet)")"
setcap 'cap_net_bind_service=+ep' "$DOTNET_REAL" || c_warn "setcap failed; low ports may not bind"

# ── systemd unit ─────────────────────────────────────────────────────────────
c_info "writing /etc/systemd/system/$SERVICE.service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Orion Copy Server backend (Mothership :${ORION_BACKEND_PORT_MOTHERSHIP}, StationDb :${ORION_BACKEND_PORT_STATIONDB}, EOS :${ORION_BACKEND_PORT_EOS}, Dashboard :${ORION_BACKEND_PORT_DASHBOARD})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${INSTALL_DIR}/backend.env
ExecStart=/usr/bin/dotnet ${INSTALL_DIR}/backend/AUnrealFeatures.Ares.dll
Restart=always
RestartSec=3
Environment=DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true

# ── firewall ─────────────────────────────────────────────────────────────────
# NOTE: most VPS providers ALSO have an external firewall in the customer panel.
# ufw alone is not enough if that is enabled — see docs/PORTS.md.
if [ "$DO_FIREWALL" = 1 ] && [ "${ORION_MANAGE_FIREWALL:-1}" = 1 ]; then
  c_info "configuring ufw…"
  ufw --force enable >/dev/null
  ufw allow 22/tcp >/dev/null                                   # keep SSH!
  ufw allow "${ORION_GAME_UDP_FIRST}:${ORION_GAME_UDP_LAST}/udp" >/dev/null  # game traffic
  if [ -n "${ORION_DOMAIN:-}" ]; then
    ufw allow 443/tcp >/dev/null; ufw allow 80/tcp >/dev/null
    c_ok "exposed: 22/tcp, 443+80/tcp, ${ORION_GAME_UDP_FIRST}-${ORION_GAME_UDP_LAST}/udp"
    c_warn "service ports stay LOCAL (reverse proxy fronts them) — the secure layout"
  else
    # Raw-IP mode: client-facing services only. StationDb (:78, open
    # self-registration) stays closed unless explicitly exposed; the dashboard
    # (:8080) is never opened — use an SSH tunnel.
    for p in "$ORION_BACKEND_PORT_MOTHERSHIP" "$ORION_BACKEND_PORT_EOS" "$ORION_BACKEND_PORT_EOS_WS"; do
      ufw allow "$p/tcp" >/dev/null
    done
    c_ok "exposed: 22/tcp, ${ORION_BACKEND_PORT_MOTHERSHIP},${ORION_BACKEND_PORT_EOS},${ORION_BACKEND_PORT_EOS_WS}/tcp, ${ORION_GAME_UDP_FIRST}-${ORION_GAME_UDP_LAST}/udp"
    if [ "${ORION_EXPOSE_STATIONDB:-0}" = "1" ]; then
      if [ -n "${ORION_STATIONDB_CIDR:-}" ]; then
        ufw allow from "$ORION_STATIONDB_CIDR" to any port "$ORION_BACKEND_PORT_STATIONDB" proto tcp >/dev/null
        c_ok "exposed StationDb :${ORION_BACKEND_PORT_STATIONDB}/tcp scoped to ${ORION_STATIONDB_CIDR}"
      else
        ufw allow "$ORION_BACKEND_PORT_STATIONDB/tcp" >/dev/null
        c_warn "exposed StationDb :${ORION_BACKEND_PORT_STATIONDB}/tcp to ANY address. Scope it with ORION_STATIONDB_CIDR."
      fi
    else
      c_warn "StationDb :${ORION_BACKEND_PORT_STATIONDB} NOT opened (ORION_EXPOSE_STATIONDB=0)."
      c_warn "orchestrator ${ORION_BACKEND_PORT_ORCH_CTL}/${ORION_BACKEND_PORT_ORCH_AGENT} and dashboard ${ORION_BACKEND_PORT_DASHBOARD} deliberately NOT opened — keep them private."
    fi
    c_warn "no ORION_DOMAIN set: service ports are exposed in the clear (no TLS)."
  fi
fi

# ── TLS via Caddy (only when ORION_DOMAIN is set) ────────────────────────────
if [ -n "${ORION_DOMAIN:-}" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    c_info "installing Caddy…"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  c_info "writing /etc/caddy/Caddyfile for $ORION_DOMAIN (see deploy/Caddyfile.example)"
  cat > /etc/caddy/Caddyfile <<EOF
orion-ms.${ORION_DOMAIN}  { reverse_proxy 127.0.0.1:${ORION_BACKEND_PORT_MOTHERSHIP} }
orion.${ORION_DOMAIN} {
  # Public game/client traffic only -- server-control writes stay off this host.
  handle /register_server* { respond "Not Found" 404 }
  handle /server_heartbeat* { respond "Not Found" 404 }
  handle /update_player_count* { respond "Not Found" 404 }
  handle /stations/create* { respond "Not Found" 404 }
  handle /v1/server/admin/* { respond "Not Found" 404 }
  handle /v1/board/upload* { respond "Not Found" 404 }
  handle {
    reverse_proxy 127.0.0.1:${ORION_BACKEND_PORT_STATIONDB} {
      header_up X-Orion-Public-Proxy 1
    }
  }
}
orion-eos.${ORION_DOMAIN} { reverse_proxy 127.0.0.1:${ORION_BACKEND_PORT_EOS} }
EOF
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  c_ok "Caddy serving orion-ms/orion/orion-eos.${ORION_DOMAIN} (auto-TLS)"
  c_warn "DNS A records for those 3 names must point at ${ORION_PUBLIC_HOST} or certs will fail."
  c_warn "Keep https://orion.${ORION_DOMAIN} at 26 chars or fewer (client patch limit)."
fi

# ── start + verify ───────────────────────────────────────────────────────────
c_info "starting $SERVICE…"
systemctl restart "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; die "$SERVICE failed to start"; }
c_ok "$SERVICE running"

ok=0
for p in "$ORION_BACKEND_PORT_MOTHERSHIP" "$ORION_BACKEND_PORT_STATIONDB" "$ORION_BACKEND_PORT_EOS" "$ORION_BACKEND_PORT_DASHBOARD"; do
  if ss -lnt 2>/dev/null | grep -q ":$p\b"; then c_ok "listening on $p"; ok=$((ok+1))
  else c_warn "NOT listening on $p"; fi
done
[ "$ok" -gt 0 ] || c_warn "nothing bound — check: journalctl -u $SERVICE -n 50"

cat <<EOF

────────────────────────────────────────────────────────────────────────────
 Orion Copy Server backend installed.

   status   : sudo systemctl status $SERVICE
   logs     : sudo journalctl -u $SERVICE -f
   restart  : sudo systemctl restart $SERVICE
   reconfig : edit .env then re-run sudo ./install.sh (rewrites backend.env)

 Point your game servers at this box (on the WINDOWS machine that runs
 the game server, in windows\\server.config.psd1 — see docs/GAME-SERVERS.md):

   -MothershipHost=${ORION_PUBLIC_HOST}  -MothershipPort=${ORION_BACKEND_PORT_MOTHERSHIP}
   -BackendHost=${ORION_PUBLIC_HOST}     -BackendPort=${ORION_BACKEND_PORT_STATIONDB}
   -ServerApiKey=<ORION_SERVER_API_KEY from .env>
   DashboardApiUrl=http://${ORION_PUBLIC_HOST}:${ORION_BACKEND_PORT_STATIONDB}   <- REQUIRED FOR QUESTS
   DashboardApiKey=<ORION_DASHBOARD_API_KEY from .env>

 Your provider may also have an EXTERNAL firewall in its panel — ufw alone is
 not enough then. See docs/PORTS.md.
────────────────────────────────────────────────────────────────────────────
EOF
