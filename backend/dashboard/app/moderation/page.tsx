"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type User } from "../../lib/api";
import { useMe } from "../../lib/useMe";
import { EmptyRow } from "../../components/ui";

export default function ModerationPage() {
  const { isGlobalAdmin, hasPermission, loading } = useMe();
  const canBan = isGlobalAdmin || hasPermission("users:ban");
  const [users, setUsers] = useState<User[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!canBan) return;
    api.users().then(setUsers).catch(e => setErr(e instanceof Error ? e.message : "Failed to load moderation data"));
  }, [canBan]);

  const banned = useMemo(() => (users ?? []).filter(u => u.banned), [users]);
  if (loading) return <div className="mx-auto max-w-[1000px] pt-10"><div className="skeleton h-6 w-48" /></div>;
  if (!canBan) return <div className="mx-auto max-w-[800px] pt-24 text-center"><p className="eyebrow mb-2">Restricted</p><h1 className="text-3xl">No moderation permission</h1></div>;

  return (
    <div className="mx-auto max-w-[1000px] pt-8 pb-14">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <p className="eyebrow mb-1.5">Trust & Safety</p>
          <h1 className="text-[44px] leading-tight font-medium tracking-tight">Moderation</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--muted)" }}>User bans live here; player reports are handled on the same moderation queue.</p>
        </div>
        <Link href="/users" className="btn-light text-sm">Manage users</Link>
      </div>
      {err && <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--red)" }}>{err}</div>}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card p-5"><p className="eyebrow mb-2">Users</p><p className="text-3xl tabular">{users?.length ?? "…"}</p></div>
        <div className="card p-5"><p className="eyebrow mb-2">Banned</p><p className="text-3xl tabular" style={{ color: "var(--red)" }}>{users ? banned.length : "…"}</p></div>
      </div>
      <div className="tbl-head grid grid-cols-[1fr_1.4fr_.7fr] gap-2 px-5 py-3.5">
        <span className="text-sm font-bold">User</span><span className="text-sm font-bold">User ID</span><span className="text-sm font-bold">Platform</span>
      </div>
      {!users ? <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div> : banned.length === 0 ? <EmptyRow>No banned users.</EmptyRow> : banned.map(u => (
        <div key={u.user_id} className="tbl-row grid grid-cols-[1fr_1.4fr_.7fr] gap-2 px-5 py-3.5 text-sm">
          <span className="font-medium">{u.username}</span><span className="font-mono text-xs" style={{ color: "var(--muted)" }}>{u.user_id}</span><span style={{ color: "var(--muted)" }}>{u.platform ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
