"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { api } from "../lib/api";
import { useMe, invalidateMe } from "../lib/useMe";
import { LogOut } from "lucide-react";
import { Avatar } from "./ui";

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  const { me, loggedIn, isGlobalAdmin, hasPermission } = useMe();

  async function logout() {
    try { await api.logout(); } catch {}
    invalidateMe();
    router.replace("/login");
  }

  const nav = [
    { href: "/", label: "Home", show: true },
    { href: "/users", label: "Users", show: isGlobalAdmin || hasPermission("users:view") || hasPermission("users:ban") },
    { href: "/deployments", label: "Deployments", show: isGlobalAdmin },
    { href: "/moderation", label: "Moderation", show: isGlobalAdmin || hasPermission("users:ban") },
    { href: "/operators", label: "Operators", show: isGlobalAdmin },
    { href: "/audit", label: "Audit Log", show: me?.key_id === "master" },
  ].filter(x => x.show);

  return (
    <header style={{ background: "#20242c", borderBottom: "1px solid var(--line)" }}>
      <div className="flex items-center gap-3 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 hover:opacity-85 active:opacity-60">
          <Image src="/logo.webp" alt="Orion Copy Server logo" width={30} height={30} style={{ borderRadius: 6 }} />
          <strong className="text-[15px] font-bold tracking-wide hidden min-[480px]:block">ORION COPY SERVER</strong>
        </Link>

        <nav className="flex items-center gap-1 flex-1 overflow-x-auto ml-2">
          {nav.map(({ href, label }) => {
            const active = href === "/" ? (path === "/" || path.startsWith("/stations")) : path.startsWith(href);
            return (
              <Link key={href} href={href}
                className="px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors"
                style={{
                  color: active ? "var(--text)" : "var(--muted)",
                  background: active ? "rgba(255,255,255,0.07)" : "transparent",
                  fontWeight: active ? 500 : 400,
                }}>
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {loggedIn ? (
            <>
              <span className="text-xs hidden md:flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{ background: isGlobalAdmin ? "#1a3a2a" : "#223047", color: isGlobalAdmin ? "var(--green)" : "var(--link)" }}>
                  {isGlobalAdmin ? "MASTER" : "SCOPED"}
                </span>
              </span>
              <button onClick={logout} className="btn-outline"><LogOut size={13} /> <span className="hidden sm:inline">Logout</span></button>
              <Link href="/account" className="flex items-center gap-2.5 hover:opacity-85">
                <span className="text-[15px] hidden sm:block max-w-40 truncate">{me?.operator_label ?? me?.user_id}</span>
                <Avatar size={40} />
              </Link>
            </>
          ) : (
            <Link href="/login" className="btn-outline">Login</Link>
          )}
        </div>
      </div>
    </header>
  );
}
