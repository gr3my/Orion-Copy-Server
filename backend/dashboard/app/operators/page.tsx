"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type EnvironmentMasterKey, type OperatorKeyRecord, type Station } from "../../lib/api";
import { useMe } from "../../lib/useMe";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

const LABELS: Record<string,string> = {
  "stations:view": "View assigned stations",
  "stations:manage": "Edit assigned stations",
  "stations:launch": "Launch servers for assigned stations",
  "users:view": "View user directory",
  "users:ban": "Ban / unban users",
  "global:levels": "Global Editor Levels access",
  "global:netvars": "Global live Netvar dump access",
};

function keyStatus(k: OperatorKeyRecord): { label: string; color: string; revocable: boolean } {
  if (k.revoked_at) return { label: "Revoked", color: "var(--red)", revocable: false };
  if (Date.parse(k.expires_at) <= Date.now()) return { label: "Expired", color: "var(--yellow)", revocable: false };
  return { label: "Active", color: "var(--green)", revocable: true };
}

export default function OperatorsPage() {
  const { isGlobalAdmin, loading } = useMe();
  const [stations, setStations] = useState<Station[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [keys, setKeys] = useState<OperatorKeyRecord[]>([]);
  const [environmentMasters, setEnvironmentMasters] = useState<EnvironmentMasterKey[]>([]);
  const [storeConfigured, setStoreConfigured] = useState<boolean | null>(null);
  const [label, setLabel] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [expiresDays, setExpiresDays] = useState(30);
  const [issued, setIssued] = useState<{ key:string; key_id:string; expires_at:string }|null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string|null>(null);

  async function load() {
    if (!isGlobalAdmin) return;
    setErr(null);
    try {
      const [s, info] = await Promise.all([api.stations(), api.operatorKeys()]);
      setStations(s);
      setPermissions(info.permissions ?? []);
      setKeys(info.keys ?? []);
      setEnvironmentMasters(info.environment_masters ?? []);
      setStoreConfigured(Boolean(info.store_configured));
    } catch(e) {
      setErr(e instanceof Error ? e.message : "Failed to load operator tools");
    }
  }

  useEffect(() => {
    if (!isGlobalAdmin) return;
    let cancelled = false;
    Promise.all([api.stations(), api.operatorKeys()]).then(([s, info]) => {
      if (cancelled) return;
      setStations(s);
      setPermissions(info.permissions ?? []);
      setKeys(info.keys ?? []);
      setEnvironmentMasters(info.environment_masters ?? []);
      setStoreConfigured(Boolean(info.store_configured));
      setErr(null);
    }).catch(e => {
      if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load operator tools");
    });
    return () => { cancelled = true; };
  }, [isGlobalAdmin]);

  const needsStations = useMemo(
    () => selectedPerms.some(p => p.startsWith("stations:") || p === "users:ban"),
    [selectedPerms]
  );
  const stationNames = useMemo(() => new Map(stations.map(s => [s.station_id, s.station_name])), [stations]);
  const keyDates = useMemo(
    () => new Map(keys.map(k => [k.kid, {
      lastLogin: k.last_login_at ? new Date(k.last_login_at).toLocaleString() : "",
      expires: new Date(k.expires_at).toLocaleDateString(),
    }] as const)),
    [keys]);

  function toggle(arr:string[], value:string, setter:(v:string[])=>void) {
    setter(arr.includes(value) ? arr.filter(x=>x!==value) : [...arr,value]);
  }

  async function issue() {
    if (!storeConfigured || !label.trim() || selectedPerms.length===0 || (needsStations && selectedStations.length===0)) return;
    setBusy(true); setErr(null); setIssued(null);
    try {
      const res = await api.createOperatorKey({ label: label.trim(), permissions:selectedPerms, station_ids:selectedStations, expires_days:expiresDays });
      setIssued({ key:res.key, key_id:res.key_id, expires_at:res.expires_at });
      setCopied(false);
      setLabel(""); setSelectedPerms([]); setSelectedStations([]);
      await load();
    } catch(e:unknown) { setErr(e instanceof Error ? e.message : "Could not issue key"); }
    finally { setBusy(false); }
  }

  async function revoke(k: OperatorKeyRecord) {
    if (!confirm(`Revoke “${k.label}”? That key will stop working on its next API request.`)) return;
    setRevokeBusy(k.kid); setErr(null);
    try { await api.revokeOperatorKey(k.kid); await load(); }
    catch(e:unknown) { setErr(e instanceof Error ? e.message : "Could not revoke key"); }
    finally { setRevokeBusy(null); }
  }

  if (loading) return <div className="mx-auto max-w-[1100px] pt-8"><div className="skeleton h-6 w-52"/></div>;
  if (!isGlobalAdmin) return <div className="mx-auto max-w-lg text-center pt-24"><KeyRound size={30} className="mx-auto mb-4"/><p className="eyebrow mb-2">Restricted</p><h1 className="text-2xl">Master key required</h1></div>;

  return <div className="mx-auto max-w-[1100px] pt-8 pb-14">
    <div className="flex items-end justify-between gap-4 mb-6">
      <div><p className="eyebrow mb-1.5">Access</p><h1 className="text-[44px] leading-tight font-medium tracking-tight">Operator Keys</h1><p className="text-sm mt-1.5 max-w-3xl" style={{color:"var(--muted)"}}>Create scoped dashboard keys and assign exactly which stations they can edit. Raw keys are shown only once.</p></div>
      <button className="btn-dark text-sm" onClick={load}><RefreshCw size={14}/> Refresh</button>
    </div>

    {issued && <div className="card p-5 mb-5" style={{borderColor:"rgba(139,212,80,.4)"}}>
      <div className="flex items-center gap-2 mb-2" style={{color:"var(--green)"}}><ShieldCheck size={16}/><strong>Scoped key issued</strong></div>
      <p className="text-sm mb-3" style={{color:"var(--muted)"}}>Key ID {issued.key_id} · expires {new Date(issued.expires_at).toLocaleString()}. Copy it now — the dashboard does not store the raw key.</p>
      <div className="flex gap-2"><code className="flex-1 px-3 py-2.5 rounded text-xs break-all" style={{background:"#101319"}}>{issued.key}</code><button className="btn-dark" onClick={()=>{navigator.clipboard?.writeText(issued.key);setCopied(true)}}>{copied?<Check size={15}/>:<Copy size={15}/>}</button></div>
    </div>}
    {err && <div className="card mb-5 px-4 py-3 text-sm" style={{color:"var(--red)"}}>{err}</div>}
    {storeConfigured === false && <div className="card mb-5 px-5 py-4 text-sm" style={{borderColor:"rgba(255,190,70,.45)"}}><strong>Persistent key storage is not connected.</strong><div className="mt-1" style={{color:"var(--muted)"}}>Connect Upstash Redis/Vercel KV and redeploy. Until then the master key still works, but new scoped keys are disabled because they could not be listed or individually revoked safely.</div></div>}

    <div className="card p-6 mb-6">
      <h2 className="text-xl font-medium mb-5">Create key</h2>
      <label className="block text-sm mb-1.5" style={{color:"var(--muted)"}}>Label</label>
      <input className="field mb-5" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Freerunners admin / Build developer"/>

      <p className="eyebrow mb-3">Permissions</p>
      <div className="grid md:grid-cols-2 gap-2 mb-6">{permissions.map(p=><label key={p} className="card px-3 py-3 flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-1" checked={selectedPerms.includes(p)} onChange={()=>toggle(selectedPerms,p,setSelectedPerms)}/><span><span className="block text-sm font-medium">{LABELS[p]??p}</span><span className="font-mono text-[11px]" style={{color:"var(--muted)"}}>{p}</span></span></label>)}</div>

      {needsStations && <><div className="flex items-center justify-between gap-3 mb-3"><p className="eyebrow">Station access</p><div className="flex gap-2"><button type="button" className="text-xs link-blue" onClick={()=>setSelectedStations(stations.map(s=>s.station_id))}>Select all</button><button type="button" className="text-xs" style={{color:"var(--muted)"}} onClick={()=>setSelectedStations([])}>Clear</button></div></div><div className="grid md:grid-cols-2 gap-2 mb-6">{stations.map(s=><label key={s.station_id} className="card px-3 py-3 flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={selectedStations.includes(s.station_id)} onChange={()=>toggle(selectedStations,s.station_id,setSelectedStations)}/><span className="min-w-0"><span className="block text-sm font-medium truncate">{s.station_name}</span><span className="block font-mono text-[11px] truncate" style={{color:"var(--muted)"}}>{s.station_id}</span></span></label>)}</div></>}

      <label className="block text-sm mb-1.5" style={{color:"var(--muted)"}}>Key expiration</label>
      <select className="field mb-5" value={expiresDays} onChange={e=>setExpiresDays(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
      <div className="flex justify-end"><button className="btn-light py-2.5! px-5! text-sm" disabled={!storeConfigured||busy||!label.trim()||!selectedPerms.length||(needsStations&&!selectedStations.length)} onClick={issue}><Plus size={14}/>{busy?"Issuing…":"Issue scoped key"}</button></div>
    </div>

    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{borderColor:"var(--line)"}}><div><h2 className="text-xl font-medium">Current keys</h2><p className="text-[13px] mt-1" style={{color:"var(--muted)"}}>Master keys are environment-managed. Scoped keys can be revoked here.</p></div></div>
      <div className="overflow-x-auto"><div className="min-w-[900px]">
        <div className="grid gap-3 px-5 py-3 text-[12px] font-bold" style={{gridTemplateColumns:"1.1fr 1.5fr 1.7fr .75fr .9fr auto",color:"var(--muted)"}}><span>Key</span><span>Stations</span><span>Permissions</span><span>Status</span><span>Expires</span><span/></div>
        {environmentMasters.map(k=><div key={k.kid} className="grid gap-3 px-5 py-4 border-t text-[13px] items-center" style={{gridTemplateColumns:"1.1fr 1.5fr 1.7fr .75fr .9fr auto",borderColor:"var(--line)"}}><span><strong>{k.label}</strong><span className="block font-mono text-[11px]" style={{color:"var(--muted)"}}>{k.env}{k.primary ? " · primary" : ""}</span></span><span>All stations</span><span>*</span><span style={{color:"var(--green)"}}>Active</span><span>—</span><span className="text-[11px]" style={{color:"var(--muted)"}}>Env</span></div>)}
        {keys.map(k=>{const st=keyStatus(k);return <div key={k.kid} className="grid gap-3 px-5 py-4 border-t text-[13px] items-center" style={{gridTemplateColumns:"1.1fr 1.5fr 1.7fr .75fr .9fr auto",borderColor:"var(--line)"}}>
          <span className="min-w-0"><strong className="block truncate">{k.label}</strong><span className="block font-mono text-[11px]" style={{color:"var(--muted)"}}>{k.key_preview} · {k.kid}</span>{k.last_login_at&&<span className="block text-[11px] mt-1" style={{color:"var(--muted)"}}>last login {keyDates.get(k.kid)?.lastLogin}</span>}</span>
          <span className="min-w-0">{k.station_ids.length ? k.station_ids.map(id=>stationNames.get(id)??id).join(", ") : "—"}</span>
          <span className="min-w-0 text-[12px]" style={{color:"var(--muted)"}}>{k.permissions.map(p=>LABELS[p]??p).join(", ") || "—"}</span>
          <span style={{color:st.color}}>{st.label}</span>
          <span>{keyDates.get(k.kid)?.expires}</span>
          <span>{st.revocable && <button className="p-1.5 rounded" title="Revoke key" style={{color:"var(--red)"}} disabled={revokeBusy===k.kid} onClick={()=>revoke(k)}><Trash2 size={15}/></button>}</span>
        </div>})}
        {storeConfigured && keys.length===0&&<div className="px-5 py-8 text-sm text-center" style={{color:"var(--muted)"}}>No scoped keys have been issued from the persistent registry yet.</div>}
      </div></div>
    </div>
  </div>;
}
