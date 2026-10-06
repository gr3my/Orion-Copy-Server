import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { operatorRecordIsActive, operatorStoreConfigured } from "./operatorStore";

export const AUTH_COOKIE = "orion_auth";
export const SESSION_SECONDS = 60 * 60;

export const OPERATOR_PERMISSIONS = [
  "stations:view",
  "stations:manage",
  "stations:launch",
  "users:view",
  "users:ban",
  "global:levels",
  "global:netvars",
] as const;

export type OperatorPermission = typeof OPERATOR_PERMISSIONS[number];

export type AccessClaims = {
  v: 1;
  kid: string;
  label: string;
  master: boolean;
  // Bootstrap fingerprint: HMAC(sessionSecret, "admin-fingerprint." + adminKey).
  // Rotating EITHER secret changes the fingerprint, so previously issued master
  // cookies stop validating. Never the raw key. Scoped keys carry "" (the key
  // registry governs them instead).
  akf: string;
  permissions: string[];
  station_ids: string[];
  iat: number;
  exp: number;
};

// Canonical operator secrets (see repo-root .env.example). The bare DASHBOARD_*
// names remain as legacy fallbacks. Key verification uses the admin key; session
// cookies use the session secret (falling back to the admin key so single-secret
// setups keep working).
function adminKey(): string {
  return process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY || "";
}

function sessionKey(): string {
  return process.env.ORION_DASHBOARD_SESSION_SECRET
    || process.env.DASHBOARD_SESSION_SECRET
    || adminKey();
}

function secret(context: "key" | "session"): string {
  return context === "session" ? sessionKey() : adminKey();
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function mac(context: "key" | "session", payload: string): string {
  const s = secret(context);
  if (!s) throw new Error("ORION_DASHBOARD_ADMIN_KEY is not configured");
  return createHmac("sha256", s).update(`${context}.${payload}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function validClaims(v: unknown): v is AccessClaims {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return c.v === 1 && typeof c.kid === "string" && typeof c.label === "string" &&
    typeof c.master === "boolean" && Array.isArray(c.permissions) && Array.isArray(c.station_ids) &&
    (c.akf === undefined || typeof c.akf === "string") &&
    typeof c.iat === "number" && typeof c.exp === "number";
}

// Fingerprint of the CURRENT bootstrap admin key, keyed by the session secret.
// Compared (constant-time) against the fingerprint embedded in master sessions,
// so rotating either credential invalidates outstanding master cookies. Null when
// unconfigured, which rejects every master session.
function adminKeyFingerprint(): string | null {
  const admin = adminKey();
  const sess = sessionKey();
  if (!admin || !sess) return null;
  return createHmac("sha256", sess).update(`admin-fingerprint.${admin}`).digest("base64url");
}

function verifySigned(context: "key" | "session", token: string): AccessClaims | null {
  const parts = token.split(".");
  const offset = parts[0] === "ocp1" ? 1 : 0;
  if (parts.length !== 2 + offset) return null;
  const payload = parts[offset];
  const sig = parts[offset + 1];
  let expected: string;
  try { expected = mac(context, payload); } catch { return null; }
  if (!safeEqual(sig, expected)) return null;
  try {
    const decoded = JSON.parse(unb64url(payload)) as unknown;
    if (!validClaims(decoded)) return null;
    if (decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    const akf = typeof decoded.akf === "string" ? decoded.akf : "";
    if (decoded.master) {
      // Master sessions are bound to the credential that minted them: rotating
      // the admin key (or session secret) must invalidate them. Never the raw key.
      const current = adminKeyFingerprint();
      if (!current || !safeEqual(akf, current)) return null;
      return { ...decoded, akf };
    }
    return { ...decoded, akf };
  } catch { return null; }
}

export function issueScopedKey(opts: {
  label: string;
  permissions: string[];
  station_ids: string[];
  expires_days: number;
}): { key: string; claims: AccessClaims } {
  const now = Math.floor(Date.now() / 1000);
  const days = Math.max(1, Math.min(90, Math.trunc(opts.expires_days || 30)));
  const claims: AccessClaims = {
    v: 1,
    kid: randomBytes(8).toString("hex"),
    label: opts.label.trim().slice(0, 80) || "Operator",
    master: false,
    akf: "",
    permissions: [...new Set(opts.permissions.filter(p => (OPERATOR_PERMISSIONS as readonly string[]).includes(p)))],
    station_ids: [...new Set(opts.station_ids.filter(s => /^[A-Za-z0-9_-]{4,128}$/.test(s)))],
    iat: now,
    exp: now + days * 86400,
  };
  const payload = b64url(JSON.stringify(claims));
  return { key: `ocp1.${payload}.${mac("key", payload)}`, claims };
}

function masterClaims(kid: string, label: string): AccessClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    kid,
    label,
    master: true,
    akf: adminKeyFingerprint() ?? "",
    permissions: ["*"],
    station_ids: ["*"],
    iat: now,
    exp: now + SESSION_SECONDS,
  };
}

export function isPrimaryMaster(claims: AccessClaims | null): boolean {
  return Boolean(claims?.master && claims.kid === "master");
}

export function configuredMasterKeys(): { kid: string; label: string; env: string; primary: boolean }[] {
  const out: { kid: string; label: string; env: string; primary: boolean }[] = [];
  if (process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY) {
    out.push({
      env: process.env.ORION_DASHBOARD_ADMIN_KEY ? "ORION_DASHBOARD_ADMIN_KEY" : "DASHBOARD_MASTER_KEY",
      kid: "master",
      label: "Master",
      primary: true,
    });
  }
  extraMasterKeys().forEach((_, i) => out.push({
    env: "ORION_DASHBOARD_EXTRA_KEYS",
    kid: `master:extra-${i + 1}`,
    label: `Extra ${i + 1}`,
    primary: false,
  }));
  return out;
}

// Optional additional full-access keys, comma-separated, for teams that need more
// than one master credential. Generic on purpose: no personal names in config.
function extraMasterKeys(): string[] {
  const raw = process.env.ORION_DASHBOARD_EXTRA_KEYS || "";
  return raw.split(",").map(s => s.trim()).filter(s => s.length >= 16);
}

export async function authenticateOperatorKey(key: string): Promise<AccessClaims | null> {
  const master = adminKey();
  if (!master) return null;

  if (safeEqual(key, master)) return masterClaims("master", "Master");

  const extras = extraMasterKeys();
  for (let i = 0; i < extras.length; i++) {
    if (safeEqual(key, extras[i])) return masterClaims(`master:extra-${i + 1}`, `Extra ${i + 1}`);
  }

  const claims = verifySigned("key", key);
  if (!claims) return null;
  // Once a persistent key registry is configured, only registered, active keys are accepted.
  // This is what makes individual revocation enforceable.
  if (operatorStoreConfigured()) {
    try { if (!(await operatorRecordIsActive(claims.kid))) return null; } catch { return null; }
  }
  return claims;
}

export function createSessionToken(claims: AccessClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const session: AccessClaims = {
    ...claims,
    iat: now,
    exp: Math.min(claims.exp, now + SESSION_SECONDS),
  };
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${mac("session", payload)}`;
}

export function readSession(req: NextRequest): AccessClaims | null {
  const raw = req.cookies.get(AUTH_COOKIE)?.value;
  if (!raw) return null;
  return verifySigned("session", raw);
}

export async function readSessionChecked(req: NextRequest): Promise<AccessClaims | null> {
  const claims = readSession(req);
  if (!claims || claims.master) return claims;
  if (operatorStoreConfigured()) {
    try { if (!(await operatorRecordIsActive(claims.kid))) return null; } catch { return null; }
  }
  return claims;
}

export function hasPermission(claims: AccessClaims | null, permission: string): boolean {
  return Boolean(claims && (claims.master || claims.permissions.includes("*") || claims.permissions.includes(permission)));
}

export function canAccessStation(claims: AccessClaims | null, stationId: string): boolean {
  return Boolean(claims && (claims.master || claims.station_ids.includes("*") || claims.station_ids.includes(stationId)));
}

export function canReadStation(claims: AccessClaims | null, stationId: string): boolean {
  return canAccessStation(claims, stationId) && hasPermission(claims, "stations:view");
}

export function canManageStation(claims: AccessClaims | null, stationId: string): boolean {
  return canAccessStation(claims, stationId) && hasPermission(claims, "stations:manage");
}

export function canLaunchStation(claims: AccessClaims | null, stationId: string): boolean {
  return canAccessStation(claims, stationId) && hasPermission(claims, "stations:launch");
}
