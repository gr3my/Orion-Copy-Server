"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { api, type AuditEvent } from "../../lib/api";
import { useMe } from "../../lib/useMe";

export default function AuditPage() {
  const { me, loading } = useMe();
  const primary = me?.key_id === "master";
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!primary) return;
    setErr(null);
    try {
      const r = await api.auditLog(500);
      setEvents(r.events ?? []);
      setConfigured(Boolean(r.store_configured));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load audit log");
    }
  }

  useEffect(() => {
    if (!primary) return;
    let cancelled = false;
    api.auditLog(500).then(r => {
      if (cancelled) return;
      setEvents(r.events ?? []);
      setConfigured(Boolean(r.store_configured));
      setErr(null);
    }).catch(e => {
      if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load audit log");
    });
    return () => { cancelled = true; };
  }, [primary]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return events;
    return events.filter(e => [e.actor_label, e.actor_kid, e.action, e.method, e.path, e.target ?? "", String(e.status), e.ip ?? ""].some(v => v.toLowerCase().includes(n)));
  }, [events, q]);

  if (loading) return <div className="mx-auto max-w-[1200px] pt-8"><div className="skeleton h-7 w-44"/></div>;
  if (!primary) return <div className="mx-auto max-w-lg text-center pt-24"><ScrollText size={30} className="mx-auto mb-4"/><p className="eyebrow mb-2">Restricted</p><h1 className="text-2xl">Primary master key required</h1><p className="text-sm mt-2" style={{color:"var(--muted)"}}>Only the original DASHBOARD_MASTER_KEY can view dashboard audit history.</p></div>;

  return <div className="mx-auto max-w-[1200px] pt-8 pb-14">
    <div className="flex items-end justify-between gap-4 mb-6"><div><p className="eyebrow mb-1.5">Security</p><h1 className="text-[44px] leading-tight font-medium tracking-tight">Audit Log</h1><p className="text-sm mt-1.5" style={{color:"var(--muted)"}}>Dashboard control actions only. Raw keys and request bodies are never recorded.</p></div><button className="btn-dark text-sm" onClick={load}><RefreshCw size={14}/> Refresh</button></div>
    {err && <div className="card mb-5 px-4 py-3 text-sm" style={{color:"var(--red)"}}>{err}</div>}
    {configured === false && <div className="card mb-5 px-5 py-4 text-sm" style={{borderColor:"rgba(255,190,70,.45)"}}><strong>Audit storage is not connected.</strong><div className="mt-1" style={{color:"var(--muted)"}}>Connect the same Upstash Redis / Vercel KV storage used by operator-key management and redeploy.</div></div>}
    <div className="card p-4 mb-4"><input className="field" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search actor, action, path, target, status, or IP"/></div>
    <div className="card overflow-hidden"><div className="overflow-x-auto"><div className="min-w-[1050px]">
      <div className="grid gap-3 px-5 py-3 text-[12px] font-bold" style={{gridTemplateColumns:"1.05fr 1fr 1.15fr .65fr 2fr 1.2fr .55fr",color:"var(--muted)"}}><span>Time</span><span>Actor</span><span>Action</span><span>Method</span><span>Path</span><span>Target</span><span>Status</span></div>
      {shown.map(e=><div key={e.id} className="grid gap-3 px-5 py-3.5 border-t text-[12px] items-start" style={{gridTemplateColumns:"1.05fr 1fr 1.15fr .65fr 2fr 1.2fr .55fr",borderColor:"var(--line)"}}>
        <span>{new Date(e.ts).toLocaleString()}</span><span className="min-w-0"><strong className="block truncate">{e.actor_label}</strong><span className="font-mono text-[10px]" style={{color:"var(--muted)"}}>{e.actor_kid}</span></span><span>{e.action}</span><span className="font-mono">{e.method}</span><span className="font-mono break-all" style={{color:"var(--muted)"}}>{e.path}</span><span className="break-all">{e.target ?? "—"}</span><span style={{color:e.status >= 200 && e.status < 400 ? "var(--green)" : "var(--red)"}}>{e.status}</span>
      </div>)}
      {configured && shown.length===0 && <div className="px-5 py-10 text-sm text-center" style={{color:"var(--muted)"}}>No matching audit entries yet.</div>}
    </div></div></div>
  </div>;
}
