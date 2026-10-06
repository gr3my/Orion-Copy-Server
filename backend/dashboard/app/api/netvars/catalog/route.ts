import { NextRequest, NextResponse } from "next/server";
// Synthetic example catalog (see data/netvar-catalog.example.json). To serve real data,
// generate data/netvar-catalog.json from YOUR OWN compatible game files in the same shape
// and change this import to "../../../../data/netvar-catalog.json".
import catalog from "../../../../data/netvar-catalog.example.json";
import { readSessionChecked } from "../../../../lib/dashboardAuth";

export async function GET(req: NextRequest) {
  if (!(await readSessionChecked(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(catalog, { headers: { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
