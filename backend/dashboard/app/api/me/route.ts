import { NextRequest, NextResponse } from "next/server";
import { readSessionChecked } from "../../../lib/dashboardAuth";

export async function GET(req: NextRequest) {
  const claims = await readSessionChecked(req);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({
    user_id: claims.label,
    is_global_admin: claims.master,
    via_admin_key: true,
    fleets: [],
    operator_label: claims.label,
    permissions: claims.permissions,
    station_ids: claims.station_ids,
    key_id: claims.kid,
  }, { headers: { "Cache-Control": "no-store" } });
}
