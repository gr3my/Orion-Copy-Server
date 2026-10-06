import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, readSessionChecked } from "../../lib/dashboardAuth";
import { isSameOrigin } from "../../lib/serverProxy";
import { appendAuditEvent } from "../../lib/auditStore";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ success: false }, { status: 403 });
  const claims = await readSessionChecked(req);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  await appendAuditEvent({ claims, action: "auth.logout", method: "POST", path: "/dash-logout", status: 200, ip });
  const res = NextResponse.json({ success: true });
  res.cookies.set({ name: AUTH_COOKIE, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
