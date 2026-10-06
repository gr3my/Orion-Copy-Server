"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { safeHttpUrl } from "../lib/safeUrl";

/* Shared primitives matching the reference dashboard's plain dark style. */

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[40px] leading-tight font-medium tracking-tight">{children}</h2>;
}

/** Default pixel-face avatar (like Meta's generated faces) shown when the
 *  operator has no custom avatar image. */
export function DefaultFace({ size = 110 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Default avatar"
      style={{ borderRadius: 4, background: "#e8ebf0" }}
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <g key={`v${i}`} stroke="#c3c9d4" strokeWidth="1">
          <line x1={i * 10} y1="0" x2={i * 10} y2="100" />
        </g>
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <g key={`h${i}`} stroke="#c3c9d4" strokeWidth="1">
          <line x1="0" y1={i * 10} x2="100" y2={i * 10} />
        </g>
      ))}
      <rect x="0" y="0" width="100" height="100" fill="none" stroke="#2b2f36" strokeWidth="3" />
      <circle cx="32" cy="42" r="7" fill="#2b2f36" />
      <circle cx="68" cy="42" r="7" fill="#2b2f36" />
      <rect x="43" y="66" width="14" height="5" fill="#2b2f36" />
    </svg>
  );
}

export function Avatar({ url, name, size = 48 }: { url?: string | null; name?: string | null; size?: number }) {
  // Avatar URLs are backend-supplied: same http(s)-only allowlist as badges.
  const safe = safeHttpUrl(url);
  if (safe) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt={name ?? "avatar"} width={size} height={size} referrerPolicy="no-referrer" style={{ borderRadius: 4 }} />;
  }
  return <DefaultFace size={size} />;
}

/** First-letter fleet tile used until per-fleet icons are provided. */
export function FleetIcon({ name }: { name: string }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex items-center justify-center font-semibold"
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        background: "#2a2f38",
        color: "var(--link)",
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="tbl-row px-5 py-8 text-center text-[15px]" style={{ color: "var(--muted)" }}>
      {children}
    </div>
  );
}

/** Permission 404 — shown when the key lacks fleet perms for a page.
 *  Deliberately indistinguishable from a missing page (no existence leak).
 *  Logged-out viewers get the login variant instead (see call sites). */
export function NotFound({ eyebrow = "Not found", title = "404", message = "This page cannot be found.", actionLabel = "Back to home", actionHref = "/" }: {
  eyebrow?: string;
  title?: string;
  message?: string;
  actionLabel?: string;
  actionHref?: string;
} = {}) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-24 pb-20 text-center">
      <p className="eyebrow mb-4">{eyebrow}</p>
      <h1 className="text-[72px] leading-none font-medium tracking-tight">{title}</h1>
      <p className="text-[18px] mt-4" style={{ color: "var(--muted)" }}>
        {message}
      </p>
      <button onClick={() => router.push(actionHref)} className="btn-light mt-8">
        {actionLabel}
      </button>
    </div>
  );
}
