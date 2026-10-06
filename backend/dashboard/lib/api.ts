export type Stats = {
  total_users: number;
  total_stations: number;
  total_deployments: number;
  online_deployments: number;
  total_players: number;
  total_events: number;
};

export type User = {
  user_id: string;
  username: string;
  platform: string | null;
  last_login: string;
  created_at: string;
  role_count: number;
  banned: boolean;
  is_admin: boolean;
};

export type Station = {
  station_id: string;
  station_name: string;
  created_at: string;
  online: boolean;
  last_online: string | null;
  deployments: number;
  online_deps: number;
  player_count: number;
  community_fleet_id: string | null;
  community_fleet_name: string | null;
};

// ── Community Fleets RBAC ────────────────────────────────────────────────────
export type FleetScope = "fleet:read" | "fleet:write" | "fleet:launch" | "fleet:manage";

export type Me = {
  user_id: string;
  is_global_admin: boolean;
  via_admin_key: boolean;
  fleets: { fleet_id: string; name: string; scopes: string[] }[];
  operator_label?: string;
  permissions?: string[];
  station_ids?: string[];
  key_id?: string;
};

export type Fleet = {
  fleet_id: string;
  name: string;
  tag: string;
  owner_user_id: string;
  discord_guild_id: string | null;
  discord_invite: string | null;
  status: "pending" | "official" | "suspended" | "rejected";
  member_count: number;
  has_sax_member: boolean;
  badge_url: string | null;
  station_count: number;
  created_at: string;
  approved_at: string | null;
};

export type FleetMember = {
  user_id: string;
  username: string | null;
  scopes: string[];
  granted_by: string | null;
  created_at: string;
};

export type FleetStation = {
  station_id: string;
  station_name: string;
  online: boolean;
  // Served by newer backends; older ones omit it (treat as unknown, not 0).
  player_count?: number;
};

export type Operator = {
  operator_id: string;
  user_id: string;
  label: string | null;
  key_preview: string;
  created_at: string;
  last_login: string | null;
};

export type OperatorKeyRecord = {
  kid: string;
  label: string;
  permissions: string[];
  station_ids: string[];
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_login_at: string | null;
  key_preview: string;
};

export type EnvironmentMasterKey = {
  kid: string;
  label: string;
  env: string;
  primary: boolean;
};

export type OperatorKeysResponse = {
  permissions: string[];
  store_configured: boolean;
  keys: OperatorKeyRecord[];
  environment_masters?: EnvironmentMasterKey[];
};

export type AuditEvent = {
  id: string;
  ts: string;
  actor_kid: string;
  actor_label: string;
  actor_master: boolean;
  action: string;
  method: string;
  path: string;
  target: string | null;
  status: number;
  ip: string | null;
};

export type AuditResponse = {
  store_configured: boolean;
  events: AuditEvent[];
};

export type Deployment = {
  deployment_id: string;
  station_id: string;
  deployment_name: string | null;
  ip_address: string | null;
  region: string | null;
  version: string | null;
  online: boolean;
  player_count: number;
  last_event: string | null;
  created_at: string;
};

export type ServerEvent = {
  event_id: string;
  deployment_id: string;
  event_name: string;
  created_at: string;
};

export type Ban = {
  user_id: string;
  username: string;
  station_id: string;
  reason: string;
  expiration: string | null;
  revoked: boolean;
};

export type Role = {
  role_id: string;
  station_id: string;
  role_name: string;
  role_description: string;
  permissions: string[];
};

export type Member = {
  user_id: string;
  username: string;
  platform: string | null;
  roles: string[];
};

export type ActionResult = {
  success?: boolean;
  ok?: boolean;
  error?: string;
  id?: string;
};

// Mothership game account (cosmetic ownership + platform) — distinct from Orion Copy Server Dashboard Users.
export type Player = {
  player_id: string;
  username: string | null;
  platform: string | null;      // RIFT / QUEST / STEAM
  external_id: string | null;
  owned_count: number;
};
export type PlayerItems = { player_id: string; platform: string; owned: string[] };
export type CatalogItem = { id: string; category: string };

// Moderation: in-game reports (MothershipReportDbObject) + Mothership game-wide bans the server enforces.
export type Report = {
  report_id: string;
  reported_user_id: string;
  reported_name: string;
  reported_platform: string | null;
  reporter_user_id: string;
  reporter_name: string;
  category: number;
  reason: string;
  platform: string;
  modded_client: boolean;
  metadata: string;
  created_at: string;
  reported_active_ban: boolean;
};
export type ModBan = {
  ban_id: string;
  player_id: string;
  player_name: string;
  platform: string | null;
  category: number;
  reason: string;
  duration_minutes: number;
  created_at: string;
  expires_at: string;
  active: boolean;
};

export type LaunchResult = {
  deployment_id?: string;
  api_key?: string;
};

export type EosSession = {
  id: string;
  server_name: string;
  ip_address: string;
  port: string;
  max_players: number;
  bucket: string;
  build_id: number;
  imgui_port: string;
  station_id: string | null;
  deployment_id: string | null;
};

export type TelemetryEvent = {
  id: string;
  eventName: string;
  payload: string;
  timestamp: string;
};

export type WsClient = {
  session_id: string;
  path: string;
  connected_at: string;
  disconnected_at: string | null;
  message_count: number;
};

export type WsMessage = {
  direction: "in" | "out";
  command: string;
  headers: string;
  body: string;
  timestamp: string;
};

export type StationEvent = {
  event_id: string;
  station_id: string;
  deployment_id: string | null;
  title: string;
  description: string;
  start_time: string;
  duration: number;
  public: boolean;
  signups_open: boolean;
};

export type DrafterEntry = {
  user_id: string;
  username?: string | null;
  global?: boolean;
  scope?: string | null;
};

export type DrafterResponse = Record<string, unknown> | DrafterEntry[];

export type WhitelistEntry = { username: string; known: boolean };
export type WhitelistAccount = { user_id: string; username: string; platform?: string | null; last_login?: string | null };
export type WhitelistResponse = {
  station_id?: string;
  enabled?: boolean;
  entries?: WhitelistEntry[] | string[];
  accounts?: WhitelistAccount[];
  usernames?: string[];
  [key: string]: unknown;
};

export type NetvarCatalogEntry = {
  path?: string;
  name?: string;
  type: "bool" | "number" | "string" | "json" | string;
  default: unknown;
  min?: number | null;
  max?: number | null;
};
export type NetvarCatalogModule = { level: string; slot_key: string; vars: NetvarCatalogEntry[] };
export type NetvarCatalog = {
  generated_from?: string;
  world: NetvarCatalogEntry[];
  presets: Record<string, { path: string; value: unknown }[]>;
  modules: NetvarCatalogModule[];
  station_keys?: string[];
};
export type NetvarDumpIndex = {
  deployment_id: string;
  event_type: string;
  bytes: number;
  received_at: string;
  source: "live" | "disk" | string;
};

export type SpecLevel = {
  name: string;
  autoload: boolean;
  loaded: boolean;
  updated: string;
  size: number;
  serverLoaded: string[];
  serverSeen: string | null;
};
export type SpecLevelText = { name: string; text: string };

// The dashboard API is gated server-side (DashboardAuthPreprocessor). A 401 means no valid session
// cookie -> bounce the browser to Meta sign-in. Only fires once the backend gate is enforcing; while
// it's capture-first there are no 401s, so this is inert.
function check(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") {
    // Full-page navigation (not router.push): a 401 means the session is gone, so
    // drop all client state. This runs in lib code outside React context, where
    // useRouter is unavailable.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload to /login on lost session
    if (window.location.pathname !== "/login") window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`, { cache: "no-store" });
  check(res);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  check(res);
  return res.json();
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "PATCH",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  check(res);
  return res.json();
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "PUT",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  check(res);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`, { method: "DELETE" });
  check(res);
  return res.json();
}

// Authentication is terminated by local server routes. The operator key never leaves
// the browser for any destination except this dashboard origin. /dash-login forwards it
// server-side to the control API and re-issues a hardened host-only session cookie.
async function loginPost<T>(body: unknown): Promise<T> {
  const res = await fetch(`/dash-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok && res.status !== 401 && res.status !== 400 && res.status !== 429) throw new Error(`auth error ${res.status}`);
  return res.json();
}

async function logoutPost<T>(): Promise<T> {
  const res = await fetch(`/dash-logout`, { method: "POST" });
  if (!res.ok) throw new Error(`logout error ${res.status}`);
  return res.json();
}

// /api/me is the auth probe itself — it must NOT redirect on 401 (that's the "not logged in" answer).
async function getMe(): Promise<Me | null> {
  const res = await fetch(`/api/me`, { cache: "no-store", credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function gamePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/game/${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  check(res);
  return res.json();
}

async function gameDel<T>(path: string): Promise<T> {
  const res = await fetch(`/game/${path}`, { method: "DELETE" });
  check(res);
  return res.json();
}

export const api = {
  // Read
  stats:       ()                  => get<Stats>("stats"),
  users:       ()                  => get<User[]>("users"),
  stations:    ()                  => get<Station[]>("stations"),
  deployments: ()                  => get<Deployment[]>("deployments"),
  events:      ()                  => get<ServerEvent[]>("events"),

  // Station moderation
  stationBans:    (stationId: string) => get<Ban[]>(`stations/${stationId}/bans`),
  stationRoles:   (stationId: string) => get<Role[]>(`stations/${stationId}/roles`),
  stationMembers: (stationId: string) => get<Member[]>(`stations/${stationId}/members`),

  // Ban / unban
  banUser:   (userId: string, stationId: string, reason: string, duration: number) =>
    post<ActionResult>(`users/${userId}/ban`, { station_id: stationId, reason, duration }),
  unbanUser: (userId: string, stationId: string) =>
    patch<ActionResult>(`users/${userId}/unban`, { station_id: stationId }),

  // Role management
  createRole: (stationId: string, roleName: string, roleDescription: string) =>
    post<ActionResult>(`stations/${stationId}/roles`, { role_name: roleName, role_description: roleDescription }),
  deleteRole: (stationId: string, roleId: string) =>
    del<ActionResult>(`stations/${stationId}/roles/${roleId}`),
  setRolePermissions: (stationId: string, roleId: string, permissions: string[]) =>
    patch<ActionResult>(`stations/${stationId}/roles/${roleId}/permissions`, { permissions }),

  // Create station / deployment — via game server (port 7811) to avoid LiteDB issue
  createStation: (stationName: string) =>
    gamePost<{ station_id: string }>(`stations/create`, { station_name: stationName }),
  launchDeployment: (stationId: string, body: { deployment_name?: string; ip?: string; region?: string; version?: string }) =>
    gamePost<LaunchResult>(`stations/${stationId}/deployments`, body),

  // Spin up a server via HalcyonSocket (replaces manual ip/port entry). An allocator agent launches
  // the game server on a box; it self-registers and appears in the deployment list. Goes through
  // AresDashboardServer on :8080 (the /api/* proxy).
  spinUpServer: (stationId: string, body: { box?: string; map?: string; region?: string; args?: string; name?: string; fleet_id?: string }) =>
    post<{ success: boolean; request_id?: string; agent?: string; error?: string }>(`stations/${stationId}/spinup`, body),
  agents: () =>
    get<{ agents: { box: string; capacity: number; running: number; free: number }[] }>("agents"),

  // Create event via game server (uses query params)
  createEvent: (stationId: string, p: {
    title: string; description?: string; start_time?: string;
    duration?: number; deployment_id?: string; public?: boolean; signups_open?: boolean;
  }) => {
    const q = new URLSearchParams({
      title:        p.title,
      description:  p.description  ?? "",
      duration:     String(p.duration ?? 3600),
      start_time:   p.start_time    ?? new Date().toISOString(),
      public:       String(p.public ?? true),
      signups_open: String(p.signups_open ?? true),
      ...(p.deployment_id ? { deployment_id: p.deployment_id } : {}),
    });
    return fetch(`/game/v1/stations/${stationId}/event?${q}`, { method: "POST", body: "{}" })
      .then(r => r.json() as Promise<Record<string, unknown>>);
  },
  deleteEvent: (stationId: string, eventId: string) =>
    gameDel<ActionResult>(`v1/stations/${stationId}/event/${eventId}`),

  // Station detail lists
  stationDeployments: (stationId: string) => get<Deployment[]>(`stations/${stationId}/deployments`),
  stationEvents:      (stationId: string) => get<StationEvent[]>(`stations/${stationId}/events`),

  // EOS session management (in-memory on the server, managed via dashboard)
  sessions:       ()                  => get<EosSession[]>("sessions"),
  addSession:     (s: Omit<EosSession, "id">) => post<ActionResult>("sessions", s),
  removeSession:  (id: string)        => del<ActionResult>(`sessions/${id}`),

  // Bulk-create N EOS sessions with auto-incrementing ports
  bulkAddSessions: (
    stationId: string,
    count: number,
    opts: { server_name: string; ip_address: string; base_port: number; max_players: number; bucket: string; build_id: number; imgui_port_base: number }
  ) => {
    const tasks: Promise<ActionResult>[] = [];
    for (let i = 0; i < count; i++) {
      tasks.push(post<ActionResult>("sessions", {
        server_name:   `${opts.server_name}_${i + 1}`,
        ip_address:    opts.ip_address,
        port:          String(opts.base_port + i),
        max_players:   opts.max_players,
        bucket:        opts.bucket,
        build_id:      opts.build_id,
        imgui_port:    opts.imgui_port_base > 0 ? String(opts.imgui_port_base + i) : "",
        station_id:    stationId,
        deployment_id: null,
      }));
    }
    return Promise.all(tasks);
  },

  // Role assignment
  assignRole: (stationId: string, userId: string, roleId: string) =>
    post<ActionResult>(`stations/${stationId}/users/${userId}/roles/${roleId}`),
  removeRole: (stationId: string, userId: string, roleId: string) =>
    del<ActionResult>(`stations/${stationId}/users/${userId}/roles/${roleId}`),

  // Observability
  telemetry:      (limit?: number)   => get<TelemetryEvent[]>(`telemetry${limit ? `?limit=${limit}` : ""}`),
  wsClients:      ()                 => get<WsClient[]>("ws-clients"),
  wsMessages:     (sessionId: string) => get<WsMessage[]>(`ws-clients/${sessionId}/messages`),

  // Station drafters (station-local editing grants only)
  stationDrafters: (stationId: string) => get<DrafterResponse>(`drafters/${stationId}`),
  grantStationDrafter: (stationId: string, userId: string) => post<ActionResult>(`drafters/${stationId}/${userId}`),
  revokeStationDrafter: (stationId: string, userId: string) => del<ActionResult>(`drafters/${stationId}/${userId}`),

  // Station whitelist
  stationWhitelist: (stationId: string) => get<WhitelistResponse>(`stations/${stationId}/whitelist`),
  setStationWhitelist: (stationId: string, usernames: string[]) =>
    put<WhitelistResponse & { success?: boolean }>(`stations/${stationId}/whitelist`, { usernames }),

  // Netvars / station config
  stationConfig: (stationId: string) => get<Record<string, string>>(`stations/${stationId}/config`),
  patchStationConfig: (stationId: string, patchBody: Record<string, string>) =>
    patch<ActionResult>(`stations/${stationId}/config`, patchBody),
  deleteStationConfigKey: (stationId: string, key: string) =>
    del<ActionResult>(`stations/${stationId}/config?key=${encodeURIComponent(key)}`),
  netvarCatalog: () => get<NetvarCatalog>(`netvars/catalog`),
  netvarDumps: () => get<NetvarDumpIndex[]>(`netvars/dumps`),
  netvarDump: (type: string, deploymentId: string) =>
    get<unknown>(`netvars/dump?type=${encodeURIComponent(type)}&deployment_id=${encodeURIComponent(deploymentId)}`),

  // Spec editor levels
  specLevels: () => get<SpecLevel[]>(`spec/levels`),
  specLevel: (name: string) => get<SpecLevelText>(`spec/levels/${encodeURIComponent(name)}`),
  patchSpecLevel: (name: string, body: { loaded?: boolean; autoload?: boolean }) =>
    patch<{ ok: boolean }>(`spec/levels/${encodeURIComponent(name)}`, body),
  deleteSpecLevel: (name: string) => del<{ ok: boolean }>(`spec/levels/${encodeURIComponent(name)}`),

  // Global admin
  grantAdmin:  (userId: string) => post<ActionResult>(`users/${userId}/grant_admin`),
  revokeAdmin: (userId: string) => del<ActionResult>(`users/${userId}/grant_admin`),

  // Players (Mothership game accounts): cosmetic ownership + platform
  players:     (q?: string) => get<Player[]>(`players${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  playerItems: (playerId: string) => get<PlayerItems>(`players/${playerId}/items`),
  catalog:     () => get<CatalogItem[]>("catalog"),
  // Pass an empty body so a Content-Length is always sent (the backend rejects bodyless POSTs with 411).
  grantItem:   (playerId: string, itemId: string) =>
    post<ActionResult>(`players/${playerId}/grant?item_id=${encodeURIComponent(itemId)}`, {}),
  revokeItem:  (playerId: string, itemId: string) =>
    post<ActionResult>(`players/${playerId}/revoke?item_id=${encodeURIComponent(itemId)}`, {}),
  // Backfill real Oculus display names (background). Re-fetch the list after a moment.
  refreshNames: () => post<{ success: boolean; started: number }>("players/refresh_names", {}),

  // ── Community Fleets RBAC ──────────────────────────────────────────────────
  // Identity + effective scopes (drives all UI gating). null = not logged in.
  me:     () => getMe(),
  login:  (key: string) => loginPost<{ success: boolean; ok?: boolean; user_id?: string; is_global_admin?: boolean; error?: string }>({ key }),
  logout: () => logoutPost<ActionResult>(),

  fleets:       () => get<Fleet[]>("fleets"),
  fleet:        (id: string) => get<Fleet>(`fleets/${id}`),
  applyFleet:   (body: { name: string; tag?: string; owner_user_id?: string; discord_guild_id?: string; discord_invite?: string; member_count?: number; has_sax_member?: boolean }) =>
    post<ActionResult>("fleets", body),
  updateFleet:  (id: string, body: Partial<{ name: string; tag: string; discord_guild_id: string; discord_invite: string; badge_url: string; member_count: number; has_sax_member: boolean }>) =>
    patch<ActionResult>(`fleets/${id}`, body),
  deleteFleet:  (id: string) => del<ActionResult>(`fleets/${id}`),
  approveFleet: (id: string) => post<ActionResult>(`fleets/${id}/approve`, {}),
  suspendFleet: (id: string) => post<ActionResult>(`fleets/${id}/suspend`, {}),

  fleetStations:    (id: string) => get<FleetStation[]>(`fleets/${id}/stations`),
  allocateStation:  (fleetId: string, stationId: string) => post<ActionResult>(`fleets/${fleetId}/stations/${stationId}`, {}),
  deallocateStation:(fleetId: string, stationId: string) => del<ActionResult>(`fleets/${fleetId}/stations/${stationId}`),

  fleetMembers:    (id: string) => get<FleetMember[]>(`fleets/${id}/members`),
  addFleetMember:  (id: string, userId: string, scopes: string[]) =>
    post<ActionResult>(`fleets/${id}/members`, { user_id: userId, scopes }),
  removeFleetMember:(id: string, userId: string) => del<ActionResult>(`fleets/${id}/members/${userId}`),

  operatorKeys: () => get<OperatorKeysResponse>("operator-keys"),
  operatorPermissions: () => get<OperatorKeysResponse>("operator-keys"),
  createOperatorKey: (body: { label: string; permissions: string[]; station_ids: string[]; expires_days: number }) =>
    post<{ success: boolean; key: string; key_id: string; expires_at: string; error?: string }>("operator-keys", body),
  revokeOperatorKey: (keyId: string) => del<{ success: boolean; key_id: string; revoked_at: string | null }>(`operator-keys?kid=${encodeURIComponent(keyId)}`),
  auditLog: (limit = 250) => get<AuditResponse>(`audit?limit=${Math.max(1, Math.min(1000, Math.trunc(limit)))}`),

  // Moderation — in-game reports + Mothership bans
  reports: () => get<Report[]>("reports"),
  bans:    (includeExpired = false) => get<ModBan[]>(`bans${includeExpired ? "?include_expired=true" : ""}`),
  // Ban the reported player from a report. minutes=0 → permanent.
  banFromReport: (reportId: string, minutes: number, reason: string) =>
    post<ActionResult>(`reports/${reportId}/ban?duration_minutes=${minutes}&reason=${encodeURIComponent(reason)}`, {}),
  dismissReport: (reportId: string) => del<ActionResult>(`reports/${reportId}`),
  revokeBan:     (banId: string) => post<ActionResult>(`bans/${banId}/revoke`, {}),
};
