import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "orion_auth";

// Explicit public routes: login flow + framework/static assets. Everything else
// (pages AND /api/* AND /game/*) requires a session cookie to even reach a
// handler. Route handlers still fully verify the session themselves -- this is
// defense in depth, not the perimeter. There are no anonymous public status
// endpoints; /api/me answers 401 (not a redirect) when unauthenticated.
const PUBLIC_PATHS: RegExp[] = [
  /^\/login\/?$/,
  /^\/dash-login\/?$/,
  /^\/dash-logout\/?$/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  /^\/logo\.webp$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(r => r.test(pathname));
}

function unauthorizedJson() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (!req.cookies.get(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/game/")) return unauthorizedJson();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
