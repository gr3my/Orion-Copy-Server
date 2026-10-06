"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Station, type User } from "../../lib/api";
import { useMe } from "../../lib/useMe";
import { EmptyRow } from "../../components/ui";
import { Search, ShieldBan, ShieldCheck } from "lucide-react";

const DURATIONS = [
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
  { label: "Permanent", value: 0 },
];

export default function UsersPage() {
  const { isGlobalAdmin, hasPermission, hasStationAccess, loading: authLoading } = useMe();
  const canView = isGlobalAdmin || hasPermission("users:view") || hasPermission("users:ban");
  const canBan = isGlobalAdmin || hasPermission("users:ban");
  const [users, setUsers] = useState<User[] | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [query, setQuery] = useState("");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<User | null>(null);
  const [action, setAction] = useState<"ban" | "unban">("ban");
  const [stationId, setStationId] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);

  function load() {
    setErr(null);
    Promise.all([api.users(), api.stations()])
      .then(([u, s]) => { setUsers(u); setStations(s); })
      .catch(e => setErr(e instanceof Error ? e.message : "Failed to load users"));
  }

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    Promise.all([api.users(), api.stations()])
      .then(([u, s]) => {
        if (cancelled) return;
        setUsers(u); setStations(s); setErr(null);
      })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load users"); });
    return () => { cancelled = true; };
  }, [canView]);

  const banStations = useMemo(() => isGlobalAdmin ? stations : stations.filter(s => hasStationAccess(s.station_id)), [stations, isGlobalAdmin, hasStationAccess]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter(u => {
      if (bannedOnly && !u.banned) return false;
      if (!q) return true;
      return `${u.username} ${u.user_id} ${u.platform ?? ""}`.toLowerCase().includes(q);
    });
  }, [users, query, bannedOnly]);

  function open(user: User, next: "ban" | "unban") {
    setTarget(user); setAction(next); setReason(""); setDuration(0); setErr(null);
    setStationId(banStations[0]?.station_id ?? "");
  }

  async function submit() {
    if (!target || !stationId) return;
    setBusy(true); setErr(null);
    try {
      const res = action === "ban"
        ? await api.banUser(target.user_id, stationId, reason, duration)
        : await api.unbanUser(target.user_id, stationId);
      if (res.success === false || res.ok === false) throw new Error(res.error || `${action} failed`);
      setTarget(null); load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `${action} failed`);
    } finally { setBusy(false); }
  }

  if (authLoading) return <div className="mx-auto max-w-[1100px] pt-10"><div className="skeleton h-6 w-48" /></div>;
  if (!canView) return <div className="mx-auto max-w-[900px] pt-24 text-center"><p className="eyebrow mb-2">Restricted</p><h1 className="text-3xl">No user-directory access</h1></div>;

  return (
    <div className="mx-auto max-w-[1100px] pt-8 pb-14">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <p className="eyebrow mb-1.5">Directory</p>
          <h1 className="text-[44px] leading-tight font-medium tracking-tight">Users</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--muted)" }}>
            {users ? `${users.length} users · ${users.filter(u => u.banned).length} banned` : "Loading…"}
          </p>
        </div>
        <button className="btn-dark text-sm" onClick={load}>Refresh</button>
      </div>

      {err && <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--red)" }}>{err}</div>}

      <div className="card p-4 mb-4 flex gap-3 items-center">
        <label className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <input className="field pl-9!" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search username or Meta user id" />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={bannedOnly} onChange={e => setBannedOnly(e.target.checked)} /> Banned only
        </label>
      </div>

      <div className="tbl-head grid grid-cols-[1.4fr_1.4fr_.7fr_.6fr_.8fr_auto] gap-2 px-5 py-3.5">
        {['User','User ID','Platform','Roles','Status',''].map(h => <span key={h} className="text-[14px] font-bold">{h}</span>)}
      </div>
      <div>
        {!users ? (
          <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
        ) : filtered.length === 0 ? (
          <EmptyRow>No users match.</EmptyRow>
        ) : filtered.map(u => (
          <div key={u.user_id} className="tbl-row grid grid-cols-[1.4fr_1.4fr_.7fr_.6fr_.8fr_auto] gap-2 items-center px-5 py-3.5 text-sm">
            <span className="font-medium truncate">{u.username}</span>
            <span className="font-mono text-[12px] truncate" style={{ color: "var(--muted)" }}>{u.user_id}</span>
            <span style={{ color: "var(--muted)" }}>{u.platform ?? "—"}</span>
            <span className="tabular">{u.role_count}</span>
            <span className="flex items-center gap-1.5" style={{ color: u.banned ? "var(--red)" : "var(--green)" }}>
              {u.banned ? <ShieldBan size={14}/> : <ShieldCheck size={14}/>} {u.banned ? "Banned" : "Active"}
              {u.is_admin && <span className="ml-1 text-[10px] px-1.5 py-.5 rounded" style={{ background: "#1a3a2a", color: "var(--green)" }}>ADMIN</span>}
            </span>
            <span className="text-right">
              {canBan && (u.banned ?
                <button className="btn-dark py-1.5! px-3! text-[12px]" style={{ color: "var(--green)" }} onClick={() => open(u, "unban")}>Unban</button> :
                <button className="btn-dark py-1.5! px-3! text-[12px]" style={{ color: "var(--red)" }} onClick={() => open(u, "ban")}>Ban</button>)}
            </span>
          </div>
        ))}
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.68)" }} onClick={e => e.target === e.currentTarget && setTarget(null)}>
          <div className="card w-full max-w-md p-6">
            <p className="eyebrow mb-1.5">Moderation</p>
            <h2 className="text-2xl font-medium mb-5">{action === "ban" ? "Ban" : "Unban"} {target.username}</h2>
            <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Station</label>
            <select className="field mb-4" value={stationId} onChange={e => setStationId(e.target.value)}>
              <option value="">Select station…</option>
              {banStations.map(s => <option key={s.station_id} value={s.station_id}>{s.station_name}</option>)}
            </select>
            {action === "ban" && <>
              <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Duration</label>
              <select className="field mb-4" value={duration} onChange={e => setDuration(Number(e.target.value))}>
                {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Reason</label>
              <input className="field mb-5" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" />
            </>}
            <div className="flex justify-end gap-2">
              <button className="btn-dark text-sm" onClick={() => setTarget(null)}>Cancel</button>
              <button className="btn-light text-sm py-2.5! px-5!" disabled={!stationId || busy} onClick={submit}>{busy ? "Working…" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
