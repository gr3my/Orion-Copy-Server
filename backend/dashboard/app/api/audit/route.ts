import { NextRequest, NextResponse } from "next/server";
import { isPrimaryMaster, readSessionChecked } from "../../../lib/dashboardAuth";
import { auditStoreConfigured, listAuditEvents } from "../../../lib/auditStore";

export async function GET(req: NextRequest) {
  const claims = await readSessionChecked(req);
  if (!isPrimaryMaster(claims)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const configured = auditStoreConfigured();
  if (!configured) {
    return NextResponse.json({ store_configured: false, events: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const raw = Number(req.nextUrl.searchParams.get("limit") || 250);
  try {
    const events = await listAuditEvents(Number.isFinite(raw) ? raw : 250);
    return NextResponse.json({ store_configured: true, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "audit store unavailable", store_configured: true, events: [] }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
