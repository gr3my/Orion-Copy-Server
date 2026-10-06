// Shared secret/proxy configuration for the dashboard app (edge-safe: no node APIs).
// Canonical variables are ORION_* (see repo-root .env.example).

const PLACEHOLDER_EXACT = new Set([
  "", "change_me", "changeme", "replace_me", "replace-me", "your_secret",
  "your_api_key", "your_admin_key", "secret", "password", "admin", "test",
  "example", "placeholder",
]);

const OBVIOUS_SECRETS = new Set([
  "password", "passw0rd", "admin", "administrator", "changeme", "change-me",
  "secret", "letmein", "qwerty", "12345678", "test", "testing", "default",
  "orion", "dashboard", "master",
]);

export function isPlaceholderSecret(v: string | undefined | null): boolean {
  if (!v) return true;
  const t = v.trim();
  if (!t) return true;
  if (PLACEHOLDER_EXACT.has(t.toLowerCase())) return true;
  const up = t.toUpperCase();
  if (up.startsWith("CHANGE_ME") || up.startsWith("YOUR_") || up.startsWith("<FILL_ME")) return true;
  // Catch CHANGE_ME-ish variants regardless of separators/case.
  const squashed = t.toLowerCase().replace(/[^a-z]/g, "");
  if (squashed === "changeme" || squashed === "replacewithsecret" || squashed.startsWith("yourexample")) return true;
  return OBVIOUS_SECRETS.has(t.toLowerCase());
}

// Production bar: non-placeholder and long enough to survive guessing.
// Session secret >= 32 chars, admin key >= 20 chars of real entropy.
export const MIN_SESSION_SECRET_LEN = 32;
export const MIN_ADMIN_KEY_LEN = 20;

export function isWeakSecret(v: string | undefined | null, minLen = 16): boolean {
  if (isPlaceholderSecret(v)) return true;
  return v!.trim().length < minLen;
}

export function adminKeyConfigured(): boolean {
  return !isWeakSecret(process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY || "", MIN_ADMIN_KEY_LEN);
}

export function sessionSecretConfigured(): boolean {
  const s = process.env.ORION_DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || "";
  if (!isWeakSecret(s, MIN_SESSION_SECRET_LEN)) return true;
  // Single-secret setups fall back to the admin key (must still clear the bar).
  const admin = process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY || "";
  return !isWeakSecret(admin, MIN_SESSION_SECRET_LEN);
}

// Reverse-proxy trust. Default FALSE: forwarding headers are ignored and all
// direct clients share one fallback bucket, so a direct client cannot spoof the
// IP that rate limiting and audit logging depend on. Enable ONLY behind a
// trusted reverse proxy that strips client-supplied forwarding headers.
// NOTE: this runtime exposes no reliable direct peer IP, so without a trusted
// proxy there is no per-IP precision -- the shared bucket keeps a global
// brute-force budget instead of pretending otherwise.
export const DIRECT_CLIENT_BUCKET = "direct:unidentified";

export function trustProxyHeaders(): boolean {
  return (process.env.ORION_TRUST_PROXY_HEADERS ?? "false") === "true";
}

export function clientIp(req: { headers: { get(n: string): string | null } }): string {
  if (trustProxyHeaders()) {
    const direct = (
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    )?.slice(0, 64);
    if (direct) return direct;
  }
  return DIRECT_CLIENT_BUCKET;
}

// Bounded rate limiter. Fixed window per key. The hard cap is enforced AT
// INSERTION TIME, never only during a periodic sweep: when full, expired
// entries are dropped first, then the oldest buckets (Map preserves insertion
// order). Size can never exceed maxKeys, even under a burst of unique keys.
export type RateLimiter = {
  limited: (key: string) => boolean;
  size: () => number;
};

export function createRateLimiter(opts: { windowMs: number; max: number; maxKeys: number }): RateLimiter {
  const hits = new Map<string, { count: number; reset: number }>();

  function makeRoom(now: number) {
    if (hits.size < opts.maxKeys) return;
    for (const [k, v] of hits) {
      if (v.reset <= now) hits.delete(k);
      if (hits.size < opts.maxKeys) return;
    }
    while (hits.size >= opts.maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) return;
      hits.delete(oldest.value);
    }
  }

  return {
    limited(key: string) {
      const now = Date.now();
      const entry = hits.get(key);
      if (entry && entry.reset > now) {
        entry.count += 1;
        return entry.count > opts.max;
      }
      if (entry) hits.delete(key); // expired: drop before re-inserting
      makeRoom(now);
      hits.set(key, { count: 1, reset: now + opts.windowMs });
      return false;
    },
    size: () => hits.size,
  };
}

// Credential redaction for anything that might reach logs or the browser.
// Applied server-side BEFORE audit events and error details are stored/sent.
const SECRET_VALUE = "[redacted]";
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const QUERY_PARAM_PATTERN = /([?&](?:token|api[_-]?key|key|secret)\s*=\s*)[^&\s"'&,;]+/gi;

export function redactSecretsText(message: string): string {
  let out = message;
  out = out.replace(JWT_PATTERN, SECRET_VALUE);
  out = out.replace(QUERY_PARAM_PATTERN, `$1${SECRET_VALUE}`);
  return out;
}

const SENSITIVE_FIELD = /key|secret|token|password|passwd|credential|authorization|bearer|cookie|session/i;
export function redactSecretsDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") return redactSecretsText(value);
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELD.test(k) ? SECRET_VALUE : redactSecretsDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}
