import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authenticateOperatorKey, createSessionToken } from "../../lib/dashboardAuth";
import { operatorStoreConfigured, touchOperatorLogin } from "../../lib/operatorStore";
import { isSameOrigin } from "../../lib/serverProxy";
import { appendAuditEvent } from "../../lib/auditStore";
import { adminKeyConfigured, clientIp, createRateLimiter, isWeakSecret, MIN_ADMIN_KEY_LEN } from "../../lib/secretConfig";

// Bounded login rate limiter: per-IP fixed window, hard-capped map (cap is
// enforced at insertion, so bursts of unique keys cannot grow it).
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 8, maxKeys: 5000 });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ success: false, error: "cross-origin request blocked" }, { status: 403 });
  // Refuse insecure configuration inside the app itself: installers reject
  // placeholders, but a manual run with CHANGE_ME (or a short key) must not
  // silently become an insecure deployment.
  const rawAdmin = process.env.ORION_DASHBOARD_ADMIN_KEY || process.env.DASHBOARD_MASTER_KEY || "";
  if (!adminKeyConfigured()) {
    return NextResponse.json({ success: false, error: "Dashboard auth is not configured securely." }, { status: 503 });
  }
  if (isWeakSecret(rawAdmin, MIN_ADMIN_KEY_LEN)) {
    return NextResponse.json({ success: false, error: "Dashboard auth is not configured securely." }, { status: 503 });
  }
  const ip = clientIp(req);
  if (loginLimiter.limited(ip)) return NextResponse.json({ success: false, error: "too many login attempts" }, { status: 429 });

  let body: { key?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: "invalid JSON" }, { status: 400 }); }
  if (!body.key || typeof body.key !== "string" || body.key.length > 4096) {
    return NextResponse.json({ success: false, error: "invalid key" }, { status: 400 });
  }
  if (isWeakSecret(body.key, 8)) {
    await appendAuditEvent({ claims: null, actorKid: "unknown", actorLabel: "Unknown key", action: "auth.login_failed", method: "POST", path: "/dash-login", status: 401, ip });
    return NextResponse.json({ success: false, error: "That key didn't work. Check it and try again." }, { status: 401 });
  }

  const claims = await authenticateOperatorKey(body.key.trim());
  if (!claims) {
    await appendAuditEvent({ claims: null, actorKid: "unknown", actorLabel: "Unknown key", action: "auth.login_failed", method: "POST", path: "/dash-login", status: 401, ip });
    return NextResponse.json({ success: false, error: "That key didn't work. Check it and try again." }, { status: 401 });
  }

  if (!claims.master && operatorStoreConfigured()) {
    try { await touchOperatorLogin(claims.kid); } catch { /* login still succeeds if telemetry write fails */ }
  }
  await appendAuditEvent({ claims, action: "auth.login", method: "POST", path: "/dash-login", target: claims.label, status: 200, ip });

  const res = NextResponse.json({ success: true, label: claims.label, master: claims.master }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: createSessionToken(claims),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return res;
}
