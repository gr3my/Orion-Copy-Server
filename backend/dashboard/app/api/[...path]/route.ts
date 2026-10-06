import { NextRequest } from "next/server";
import { proxyControlApi } from "../../../lib/serverProxy";

type Ctx = { params: Promise<{ path: string[] }> };
async function handle(req: NextRequest, ctx: Ctx) { return proxyControlApi(req, (await ctx.params).path); }
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
