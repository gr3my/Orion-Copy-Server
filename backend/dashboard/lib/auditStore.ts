import type { AccessClaims } from "./dashboardAuth";
import { redactSecretsText } from "./secretConfig";

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

const LIST_KEY = "orion:audit:v1";
const MAX_EVENTS = 2000;

type RedisConfig = { url: string; token: string };

function redisConfig(): RedisConfig | null {
  const url = process.env.OPERATOR_STORE_REST_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.OPERATOR_STORE_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function auditStoreConfigured(): boolean { return Boolean(redisConfig()); }

async function command<T>(args: (string | number)[]): Promise<T> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("audit store is not configured");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`audit store HTTP ${res.status}`);
  const body = await res.json() as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

function eventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function appendAuditEvent(opts: {
  claims: AccessClaims | null;
  action: string;
  method: string;
  path: string;
  target?: string | null;
  status: number;
  ip?: string | null;
  actorKid?: string;
  actorLabel?: string;
  actorMaster?: boolean;
}): Promise<void> {
  if (!auditStoreConfigured()) return;
  // Defense in depth: targets/paths flow from request data and could carry
  // tokens in query strings -- redact before persisting.
  const event: AuditEvent = {
    id: eventId(),
    ts: new Date().toISOString(),
    actor_kid: opts.claims?.kid ?? opts.actorKid ?? "unknown",
    actor_label: opts.claims?.label ?? opts.actorLabel ?? "Unknown",
    actor_master: opts.claims?.master ?? opts.actorMaster ?? false,
    action: opts.action.slice(0, 120),
    method: opts.method.toUpperCase().slice(0, 12),
    path: redactSecretsText(opts.path).slice(0, 500),
    target: opts.target ? redactSecretsText(opts.target).slice(0, 200) : null,
    status: opts.status,
    ip: opts.ip ? opts.ip.slice(0, 120) : null,
  };
  try {
    await command<number>(["LPUSH", LIST_KEY, JSON.stringify(event)]);
    await command<string>(["LTRIM", LIST_KEY, 0, MAX_EVENTS - 1]);
  } catch {
    // Audit logging is best-effort and must not break the dashboard action itself.
  }
}

function parseEvent(raw: unknown): AuditEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.id !== "string" || typeof v.ts !== "string" || typeof v.action !== "string") return null;
    return {
      id: v.id,
      ts: v.ts,
      actor_kid: typeof v.actor_kid === "string" ? v.actor_kid : "unknown",
      actor_label: typeof v.actor_label === "string" ? v.actor_label : "Unknown",
      actor_master: v.actor_master === true,
      action: v.action,
      method: typeof v.method === "string" ? v.method : "",
      path: typeof v.path === "string" ? v.path : "",
      target: typeof v.target === "string" ? v.target : null,
      status: typeof v.status === "number" ? v.status : 0,
      ip: typeof v.ip === "string" ? v.ip : null,
    };
  } catch { return null; }
}

export async function listAuditEvents(limit = 250): Promise<AuditEvent[]> {
  const max = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const raw = await command<unknown>(["LRANGE", LIST_KEY, 0, max - 1]);
  if (!Array.isArray(raw)) return [];
  return raw.map(parseEvent).filter((x): x is AuditEvent => Boolean(x));
}
