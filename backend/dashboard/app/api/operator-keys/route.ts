import { NextRequest, NextResponse } from "next/server";
import { OPERATOR_PERMISSIONS, configuredMasterKeys, issueScopedKey, readSessionChecked } from "../../../lib/dashboardAuth";
import { isSameOrigin } from "../../../lib/serverProxy";
import { appendAuditEvent } from "../../../lib/auditStore";
import {
  listOperatorRecords,
  operatorStoreConfigured,
  revokeOperatorRecord,
  saveOperatorRecord,
  type OperatorKeyRecord,
} from "../../../lib/operatorStore";

function noStoreHeaders() { return { "Cache-Control": "no-store, max-age=0" }; }

export async function GET(req: NextRequest) {
  const claims = await readSessionChecked(req);
  if (!claims?.master) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  const configured = operatorStoreConfigured();
  let keys: OperatorKeyRecord[] = [];
  if (configured) {
    try { keys = await listOperatorRecords(); }
    catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "key store unavailable", permissions: OPERATOR_PERMISSIONS, store_configured: true, keys: [] }, { status: 502, headers: noStoreHeaders() });
    }
  }
  return NextResponse.json({ permissions: OPERATOR_PERMISSIONS, store_configured: configured, keys, environment_masters: configuredMasterKeys() }, { headers: noStoreHeaders() });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403, headers: noStoreHeaders() });
  const claims = await readSessionChecked(req);
  if (!claims?.master) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  if (!operatorStoreConfigured()) {
    return NextResponse.json({ error: "Persistent operator key storage is not configured. Connect Upstash Redis/Vercel KV first." }, { status: 503, headers: noStoreHeaders() });
  }

  let body: { label?: string; permissions?: string[]; station_ids?: string[]; expires_days?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: noStoreHeaders() }); }
  const label = typeof body.label === "string" ? body.label : "Operator";
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter(x => typeof x === "string") : [];
  if ((permissions.includes("stations:manage") || permissions.includes("stations:launch")) && !permissions.includes("stations:view")) {
    permissions.push("stations:view");
  }
  const stationIds = Array.isArray(body.station_ids) ? body.station_ids.filter(x => typeof x === "string") : [];
  const expiresDays = typeof body.expires_days === "number" ? body.expires_days : 30;
  if (!permissions.length) return NextResponse.json({ error: "choose at least one permission" }, { status: 400, headers: noStoreHeaders() });
  if (permissions.some(p => p.startsWith("stations:") || p === "users:ban") && !stationIds.length) {
    return NextResponse.json({ error: "choose at least one station for station permissions" }, { status: 400, headers: noStoreHeaders() });
  }

  try {
    const { key, claims: issued } = issueScopedKey({ label, permissions, station_ids: stationIds, expires_days: expiresDays });
    await saveOperatorRecord({
      kid: issued.kid,
      label: issued.label,
      permissions: issued.permissions,
      station_ids: issued.station_ids,
      created_at: new Date(issued.iat * 1000).toISOString(),
      expires_at: new Date(issued.exp * 1000).toISOString(),
      revoked_at: null,
      last_login_at: null,
      key_preview: `ocp1.…${key.slice(-8)}`,
    });
    await appendAuditEvent({ claims, action: "operator_key.create", method: "POST", path: "/api/operator-keys", target: `${issued.label} (${issued.kid})`, status: 200, ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null });
    return NextResponse.json({ success: true, key, key_id: issued.kid, expires_at: new Date(issued.exp * 1000).toISOString() }, { headers: noStoreHeaders() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not issue key" }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403, headers: noStoreHeaders() });
  const claims = await readSessionChecked(req);
  if (!claims?.master) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  if (!operatorStoreConfigured()) return NextResponse.json({ error: "operator key store is not configured" }, { status: 503, headers: noStoreHeaders() });
  const kid = req.nextUrl.searchParams.get("kid")?.trim() || "";
  if (!/^[A-Fa-f0-9]{16}$/.test(kid)) return NextResponse.json({ error: "invalid key id" }, { status: 400, headers: noStoreHeaders() });
  try {
    const record = await revokeOperatorRecord(kid);
    if (!record) return NextResponse.json({ error: "key not found" }, { status: 404, headers: noStoreHeaders() });
    await appendAuditEvent({ claims, action: "operator_key.revoke", method: "DELETE", path: "/api/operator-keys", target: `${record.label} (${kid})`, status: 200, ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null });
    return NextResponse.json({ success: true, key_id: kid, revoked_at: record.revoked_at }, { headers: noStoreHeaders() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not revoke key" }, { status: 500, headers: noStoreHeaders() });
  }
}
