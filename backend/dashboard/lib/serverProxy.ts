import { NextRequest, NextResponse } from "next/server";
import {
  type AccessClaims,
  canAccessStation,
  canLaunchStation,
  canManageStation,
  canReadStation,
  hasPermission,
  readSessionChecked,
} from "./dashboardAuth";
import { appendAuditEvent } from "./auditStore";
import { clientIp } from "./secretConfig";

// Backend origins. The dashboard never exposes these or their keys to the browser:
// every route below attaches credentials server-side only.
//   CONTROL -> AresDashboardServer :8080 (operator control API, x-dashboard-key)
//   GAME    -> A2StationDbServer :78 (stationDb game API, x-api-key)
const CONTROL = (process.env.ORION_DASHBOARD_API_ORIGIN || "http://127.0.0.1:8080").replace(/\/$/, "");
const CONTROL_API_KEY = process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY || "";
const GAME = (process.env.ORION_STATIONDB_ORIGIN || process.env.GAME_API_ORIGIN || "http://127.0.0.1:78").replace(/\/$/, "");
const GAME_API_KEY = process.env.ORION_DASHBOARD_API_KEY || process.env.GAME_API_KEY || "";

const API_RULES: { methods: string[]; path: RegExp }[] = [
  { methods: ["GET"], path: /^(stats|users|stations|deployments|agents|sessions|telemetry|ws-clients)$/ },
  { methods: ["GET"], path: /^ws-clients\/[^/]+\/messages$/ },
  { methods: ["GET"], path: /^stations\/[^/]+\/(bans|roles|members|deployments|whitelist|config)$/ },
  { methods: ["GET"], path: /^drafters\/[^/]+$/ },
  { methods: ["GET"], path: /^netvars\/(dumps|dump)$/ },
  { methods: ["GET"], path: /^spec\/levels(?:\/[^/]+)?$/ },

  { methods: ["POST"], path: /^users\/[^/]+\/ban$/ },
  { methods: ["PATCH"], path: /^users\/[^/]+\/unban$/ },
  { methods: ["POST"], path: /^stations\/[^/]+\/roles$/ },
  { methods: ["DELETE"], path: /^stations\/[^/]+\/roles\/[^/]+$/ },
  { methods: ["PATCH"], path: /^stations\/[^/]+\/roles\/[^/]+\/permissions$/ },
  { methods: ["POST"], path: /^stations\/[^/]+\/spinup$/ },
  { methods: ["POST"], path: /^sessions$/ },
  { methods: ["DELETE"], path: /^sessions\/[^/]+$/ },
  { methods: ["POST", "DELETE"], path: /^stations\/[^/]+\/users\/[^/]+\/roles\/[^/]+$/ },
  { methods: ["POST", "DELETE"], path: /^drafters\/[^/]+\/[^/]+$/ },
  { methods: ["PUT"], path: /^stations\/[^/]+\/whitelist$/ },
  { methods: ["PATCH", "DELETE"], path: /^stations\/[^/]+\/config$/ },
  { methods: ["PATCH", "DELETE"], path: /^spec\/levels\/[^/]+$/ },
];

function apiAllowed(method: string, path: string): boolean {
  return API_RULES.some(r => r.methods.includes(method.toUpperCase()) && r.path.test(path));
}

const GAME_PATTERNS = [
  /^stations\/create$/,
  /^stations\/[^/]+\/deployments$/,
];

export function isSameOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host")?.split(",")[0]?.trim().toLowerCase();
  if (!origin || !host) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // Compare against the Host header, not req.nextUrl: Next may normalize
  // nextUrl to the listen address (e.g. localhost) while Host preserves what
  // the browser actually addressed.
  if (parsed.host.toLowerCase() !== host) return false;
  const requestProto = (
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(/:$/, "")
  ).toLowerCase();
  if (requestProto === "https" && parsed.protocol !== "https:") return false;
  return true;
}

function safePath(parts: string[]): string | null {
  if (!parts.length) return null;
  if (parts.some(p => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  return parts.map(encodeURIComponent).join("/");
}

function bodyFor(req: NextRequest): Promise<ArrayBuffer | undefined> {
  if (["GET", "HEAD"].includes(req.method.toUpperCase())) return Promise.resolve(undefined);
  return req.arrayBuffer().then(b => b.byteLength ? b : undefined);
}

// Credentials for the control API (:8080). Sent server-to-server only, never to
// the browser. The backend enforces the admin key on /api/* itself.
function controlHeaders(contentType?: string | null): Headers {
  if (!CONTROL_API_KEY) throw new Error("ORION_DASHBOARD_ADMIN_KEY is not configured");
  const out = new Headers();
  if (contentType) out.set("content-type", contentType);
  out.set("accept", "application/json");
  out.set("user-agent", "OrionDashboard/1.0");
  out.set("x-dashboard-key", CONTROL_API_KEY);
  return out;
}

function gameHeaders(contentType?: string | null): Headers {
  const out = new Headers();
  if (contentType) out.set("content-type", contentType);
  out.set("accept", "application/json");
  out.set("user-agent", "OrionDashboard/1.0");
  if (GAME_API_KEY) out.set("x-api-key", GAME_API_KEY);
  return out;
}

async function rawResponse(upstream: Response): Promise<NextResponse> {
  const bytes = await upstream.arrayBuffer();
  const headers = new Headers();
  const type = upstream.headers.get("content-type");
  if (type) headers.set("content-type", type);
  headers.set("cache-control", "no-store");
  return new NextResponse(bytes, { status: upstream.status, headers });
}

function requestIp(req: NextRequest): string | null {
  const ip = clientIp(req);
  return ip === "direct:unidentified" ? null : ip;
}

function actionFor(method: string, path: string): string {
  const m = method.toUpperCase();
  if (/^users\/[^/]+\/ban$/.test(path) && m === "POST") return "user.ban";
  if (/^users\/[^/]+\/unban$/.test(path) && m === "PATCH") return "user.unban";
  if (/^drafters\/[^/]+\/[^/]+$/.test(path)) return m === "POST" ? "drafter.grant" : "drafter.revoke";
  if (/^stations\/[^/]+\/whitelist$/.test(path) && m === "PUT") return "whitelist.update";
  if (/^stations\/[^/]+\/config$/.test(path)) return m === "PATCH" ? "station_config.update" : "station_config.clear";
  if (/^stations\/[^/]+\/roles$/.test(path) && m === "POST") return "role.create";
  if (/^stations\/[^/]+\/roles\/[^/]+\/permissions$/.test(path) && m === "PATCH") return "role.permissions.update";
  if (/^stations\/[^/]+\/roles\/[^/]+$/.test(path) && m === "DELETE") return "role.delete";
  if (/^stations\/[^/]+\/users\/[^/]+\/roles\/[^/]+$/.test(path)) return m === "POST" ? "role.assign" : "role.remove";
  if (/^stations\/[^/]+\/spinup$/.test(path) && m === "POST") return "station.spinup";
  if (path === "sessions" && m === "POST") return "session.create";
  if (/^sessions\/[^/]+$/.test(path) && m === "DELETE") return "session.delete";
  if (/^spec\/levels\/[^/]+$/.test(path)) return m === "PATCH" ? "editor_level.update" : "editor_level.delete";
  return "dashboard.mutate";
}

function targetFor(path: string): string | null {
  const user = path.match(/^users\/([^/]+)\/(?:ban|unban)$/); if (user) return `user:${user[1]}`;
  const drafter = path.match(/^drafters\/([^/]+)\/([^/]+)$/); if (drafter) return `station:${drafter[1]} user:${drafter[2]}`;
  const station = path.match(/^stations\/([^/]+)/); if (station) return `station:${station[1]}`;
  const level = path.match(/^spec\/levels\/([^/]+)$/); if (level) return `level:${decodeURIComponent(level[1])}`;
  const session = path.match(/^sessions\/([^/]+)$/); if (session) return `session:${session[1]}`;
  return null;
}

async function auditMutation(req: NextRequest, claims: AccessClaims, path: string, status: number): Promise<void> {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return;
  await appendAuditEvent({ claims, action: actionFor(req.method, path), method: req.method, path: `/api/${path}`, target: targetFor(path), status, ip: requestIp(req) });
}

function extractWhitelistNames(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const name = typeof v === "string" ? v.trim() : (v && typeof v === "object" ? String((v as Record<string, unknown>).username ?? (v as Record<string, unknown>).name ?? "").trim() : "");
    if (!name) return;
    const k = name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(name); }
  };
  if (Array.isArray(value)) value.forEach(add);
  else if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    for (const k of ["usernames", "entries", "whitelist", "allowed", "allowed_usernames"]) {
      const v = r[k];
      if (Array.isArray(v)) v.forEach(add);
      else if (typeof v === "string" && k === "whitelist") v.split(",").forEach(add);
    }
  }
  return out;
}

function sameNames(a: string[], b: string[]): boolean {
  const aa = [...new Set(a.map(x => x.trim().toLowerCase()).filter(Boolean))].sort();
  const bb = [...new Set(b.map(x => x.trim().toLowerCase()).filter(Boolean))].sort();
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

async function fetchControlJson(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  const method = init?.method ?? "GET";
  return fetch(`${CONTROL}/api/${path}`, {
    method,
    headers: await controlHeaders(init?.body !== undefined ? "application/json" : null),
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    redirect: "manual",
  });
}

async function handleWhitelistPut(req: NextRequest, claims: AccessClaims, stationId: string): Promise<NextResponse> {
  let body: { usernames?: unknown };
  try { body = await req.clone().json() as { usernames?: unknown }; }
  catch {
    await auditMutation(req, claims, `stations/${stationId}/whitelist`, 400);
    return NextResponse.json({ error: "invalid whitelist JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!Array.isArray(body.usernames)) {
    await auditMutation(req, claims, `stations/${stationId}/whitelist`, 400);
    return NextResponse.json({ error: "usernames must be an array" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const usernames = [...new Set(body.usernames.filter((x): x is string => typeof x === "string").map(x => x.trim()).filter(x => x && x.length <= 80))];
  if (usernames.length > 250) {
    await auditMutation(req, claims, `stations/${stationId}/whitelist`, 400);
    return NextResponse.json({ error: "too many whitelist entries" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    // Use the control API request contract first.
    const putRes = await fetchControlJson(`stations/${encodeURIComponent(stationId)}/whitelist`, { method: "PUT", body: { usernames } });
    if (!putRes.ok) {
      const out = await rawResponse(putRes);
      await auditMutation(req, claims, `stations/${stationId}/whitelist`, out.status);
      return out;
    }

    // The old build stores the same list in station config as acl.whitelist.
    // Verify the official endpoint; if it did not persist through the compatibility
    // proxy, repair that backing value and verify again.
    let verifyRes = await fetchControlJson(`stations/${encodeURIComponent(stationId)}/whitelist`);
    let verifyJson: unknown = null;
    if (verifyRes.ok) {
      try { verifyJson = await verifyRes.clone().json(); } catch { verifyJson = null; }
      if (sameNames(extractWhitelistNames(verifyJson), usernames)) {
        await auditMutation(req, claims, `stations/${stationId}/whitelist`, 200);
        return NextResponse.json(verifyJson, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
    }

    const patchRes = await fetchControlJson(`stations/${encodeURIComponent(stationId)}/config`, {
      method: "PATCH",
      body: { "acl.whitelist": usernames.join(", ") },
    });
    if (!patchRes.ok) {
      const status = patchRes.status || 502;
      await auditMutation(req, claims, `stations/${stationId}/whitelist`, status);
      return NextResponse.json({ error: `whitelist fallback config update failed (${status})` }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    verifyRes = await fetchControlJson(`stations/${encodeURIComponent(stationId)}/whitelist`);
    if (!verifyRes.ok) {
      await auditMutation(req, claims, `stations/${stationId}/whitelist`, verifyRes.status);
      return rawResponse(verifyRes);
    }
    try { verifyJson = await verifyRes.json(); } catch { verifyJson = null; }
    const returned = extractWhitelistNames(verifyJson);
    if (!sameNames(returned, usernames)) {
      await auditMutation(req, claims, `stations/${stationId}/whitelist`, 502);
      return NextResponse.json({ error: "Whitelist write returned 200 but verification did not match.", requested: usernames, returned }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    await auditMutation(req, claims, `stations/${stationId}/whitelist`, 200);
    return NextResponse.json(verifyJson, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    await auditMutation(req, claims, `stations/${stationId}/whitelist`, 502);
    return NextResponse.json({ error: e instanceof Error ? e.message : "whitelist control plane unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

function anyStationPermission(c: AccessClaims | null, p: string): boolean {
  return Boolean(c && hasPermission(c, p) && c.station_ids.length > 0);
}

function authorizeControl(c: AccessClaims | null, method: string, path: string): boolean {
  if (!c) return false;
  if (c.master) return true;
  const m = method.toUpperCase();

  if (path === "stations" && m === "GET") return true;
  if (path === "users" && m === "GET") return hasPermission(c, "users:view") || hasPermission(c, "users:ban") || hasPermission(c, "stations:manage");
  if (/^users\/[^/]+\/ban$/.test(path) && m === "POST") return hasPermission(c, "users:ban");
  if (/^users\/[^/]+\/unban$/.test(path) && m === "PATCH") return hasPermission(c, "users:ban");
  if (path === "agents" && m === "GET") return anyStationPermission(c, "stations:launch");

  const st = path.match(/^stations\/([^/]+)(?:\/(.*))?$/);
  if (st) {
    const stationId = st[1];
    const rest = st[2] || "";
    if (m === "GET") return canReadStation(c, stationId);
    if (rest === "spinup" && m === "POST") return canLaunchStation(c, stationId);
    return canManageStation(c, stationId);
  }

  const dr = path.match(/^drafters\/([^/]+)/);
  if (dr) return m === "GET" ? canReadStation(c, dr[1]) : canManageStation(c, dr[1]);

  if (/^spec\/levels/.test(path)) return hasPermission(c, "global:levels");
  if (/^netvars\/(dumps|dump)$/.test(path)) return hasPermission(c, "global:netvars");

  // Global observability and all-server lists remain master-only.
  return false;
}

async function filteredStations(upstream: Response, c: AccessClaims): Promise<NextResponse> {
  if (!upstream.ok || c.master || c.station_ids.includes("*")) return rawResponse(upstream);
  try {
    const json = await upstream.json();
    if (!Array.isArray(json)) return NextResponse.json(json, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    const allowed = new Set(c.station_ids);
    return NextResponse.json(json.filter((s: unknown) => {
      if (!s || typeof s !== "object") return false;
      return allowed.has(String((s as Record<string, unknown>).station_id ?? ""));
    }), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid station response" }, { status: 502 });
  }
}

async function filteredUsers(upstream: Response, c: AccessClaims): Promise<NextResponse> {
  if (!upstream.ok || c.master || hasPermission(c, "users:view") || hasPermission(c, "users:ban")) return rawResponse(upstream);
  try {
    const json = await upstream.json();
    if (!Array.isArray(json)) return NextResponse.json(json, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    // Station managers need an ID/name picker for roles and Drafters, but do not
    // receive moderation/admin metadata unless their key explicitly grants it.
    const minimal = json.map((u: unknown) => {
      const r = (u && typeof u === "object") ? u as Record<string, unknown> : {};
      return { user_id: String(r.user_id ?? ""), username: String(r.username ?? ""), platform: r.platform ?? null };
    }).filter((u: { user_id: string }) => u.user_id);
    return NextResponse.json(minimal, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid user response" }, { status: 502 });
  }
}

export async function proxyControlApi(req: NextRequest, parts: string[]): Promise<NextResponse> {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403 });
  const claims = await readSessionChecked(req);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rawPath = parts.join("/");
  const clean = safePath(parts);
  if (!clean || !apiAllowed(req.method, rawPath)) return NextResponse.json({ error: "route not allowed" }, { status: 404 });
  if (!authorizeControl(claims, req.method, rawPath)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const whitelistPut = rawPath.match(/^stations\/([^/]+)\/whitelist$/);
  if (whitelistPut && req.method.toUpperCase() === "PUT") {
    return handleWhitelistPut(req, claims, whitelistPut[1]);
  }

  // User ban/unban routes carry the station scope in the JSON body rather than
  // in the URL. Enforce that scope here so a station admin cannot tamper with
  // the request and moderate a different station.
  if (!claims.master && /^users\/[^/]+\/(ban|unban)$/.test(rawPath)) {
    try {
      const body = await req.clone().json() as { station_id?: unknown };
      const stationId = typeof body.station_id === "string" ? body.station_id : "";
      if (!stationId || !canAccessStation(claims, stationId)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "invalid moderation payload" }, { status: 400 });
    }
  }

  const url = new URL(`/api/${clean}`, CONTROL);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.append(k, v));

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: await controlHeaders(req.headers.get("content-type")),
      body: await bodyFor(req),
      cache: "no-store",
      redirect: "manual",
    });
    if (rawPath === "stations" && req.method === "GET") return filteredStations(upstream, claims);
    if (rawPath === "users" && req.method === "GET") return filteredUsers(upstream, claims);
    const out = await rawResponse(upstream);
    await auditMutation(req, claims, rawPath, out.status);
    return out;
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "control API unavailable" }, { status: 502 });
  }
}

export async function proxyGameApi(req: NextRequest, parts: string[]): Promise<NextResponse> {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403 });
  const claims = await readSessionChecked(req);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = parts.join("/");
  const clean = safePath(parts);
  if (!clean || !GAME_PATTERNS.some(r => r.test(raw))) return NextResponse.json({ error: "game route not allowed" }, { status: 404 });

  let allowed = false;
  if (raw === "stations/create") allowed = claims.master;
  const dep = raw.match(/^stations\/([^/]+)\/deployments$/);
  if (dep) allowed = canLaunchStation(claims, dep[1]);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(`/${clean}`, GAME);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.append(k, v));
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: gameHeaders(req.headers.get("content-type")),
      body: await bodyFor(req),
      cache: "no-store",
      redirect: "manual",
    });
    const out = await rawResponse(upstream);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      await appendAuditEvent({ claims, action: raw === "stations/create" ? "station.create" : "station.deployment.launch", method: req.method, path: `/game/${raw}`, target: targetFor(raw), status: out.status, ip: requestIp(req) });
    }
    return out;
  } catch {
    return NextResponse.json({ error: "game API unavailable" }, { status: 502 });
  }
}

export function controlOrigin() { return CONTROL; }
