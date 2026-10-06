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

const HASH_KEY = "orion:operator_keys:v1";

type RedisConfig = { url: string; token: string };

function redisConfig(): RedisConfig | null {
  const url =
    process.env.OPERATOR_STORE_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.OPERATOR_STORE_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function operatorStoreConfigured(): boolean {
  return Boolean(redisConfig());
}

async function command<T>(args: (string | number)[]): Promise<T> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("operator key store is not configured");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`operator key store HTTP ${res.status}`);
  const body = await res.json() as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

function parseRecord(raw: unknown): OperatorKeyRecord | null {
  if (typeof raw !== "string") return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (!r || typeof r !== "object" || typeof r.kid !== "string") return null;
    return {
      kid: r.kid,
      label: typeof r.label === "string" ? r.label : "Operator",
      permissions: Array.isArray(r.permissions) ? r.permissions.filter((x): x is string => typeof x === "string") : [],
      station_ids: Array.isArray(r.station_ids) ? r.station_ids.filter((x): x is string => typeof x === "string") : [],
      created_at: typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
      expires_at: typeof r.expires_at === "string" ? r.expires_at : new Date(0).toISOString(),
      revoked_at: typeof r.revoked_at === "string" ? r.revoked_at : null,
      last_login_at: typeof r.last_login_at === "string" ? r.last_login_at : null,
      key_preview: typeof r.key_preview === "string" ? r.key_preview : "ocp1.…",
    };
  } catch {
    return null;
  }
}

export async function saveOperatorRecord(record: OperatorKeyRecord): Promise<void> {
  await command<number>(["HSET", HASH_KEY, record.kid, JSON.stringify(record)]);
}

export async function getOperatorRecord(kid: string): Promise<OperatorKeyRecord | null> {
  const raw = await command<string | null>(["HGET", HASH_KEY, kid]);
  return parseRecord(raw);
}

export async function listOperatorRecords(): Promise<OperatorKeyRecord[]> {
  const raw = await command<unknown>(["HGETALL", HASH_KEY]);
  const values: unknown[] = [];
  if (Array.isArray(raw)) {
    // Upstash REST commonly returns [field, value, field, value, ...].
    for (let i = 1; i < raw.length; i += 2) values.push(raw[i]);
  } else if (raw && typeof raw === "object") {
    values.push(...Object.values(raw as Record<string, unknown>));
  }
  return values
    .map(parseRecord)
    .filter((x): x is OperatorKeyRecord => Boolean(x))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function revokeOperatorRecord(kid: string): Promise<OperatorKeyRecord | null> {
  const record = await getOperatorRecord(kid);
  if (!record) return null;
  if (!record.revoked_at) {
    record.revoked_at = new Date().toISOString();
    await saveOperatorRecord(record);
  }
  return record;
}

export async function touchOperatorLogin(kid: string): Promise<void> {
  const record = await getOperatorRecord(kid);
  if (!record) return;
  record.last_login_at = new Date().toISOString();
  await saveOperatorRecord(record);
}

export async function operatorRecordIsActive(kid: string): Promise<boolean> {
  const record = await getOperatorRecord(kid);
  if (!record || record.revoked_at) return false;
  const exp = Date.parse(record.expires_at);
  return Number.isFinite(exp) && exp > Date.now();
}
