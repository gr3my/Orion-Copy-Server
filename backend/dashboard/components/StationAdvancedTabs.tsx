"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import {
  api,
  type DrafterEntry,
  type DrafterResponse,
  type NetvarCatalog,
  type NetvarCatalogEntry,
  type NetvarDumpIndex,
  type SpecLevel,
  type User,
  type WhitelistResponse,
} from "../lib/api";

function Err({ children }: { children: React.ReactNode }) {
  return <div className="card mb-4 px-5 py-3.5 text-[14px]" style={{ color: "var(--red)" }}>{children}</div>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px]" style={{ color: "var(--muted)" }}>{children}</p>;
}
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.72)" }}
    onClick={e => { if (e.currentTarget === e.target) onClose(); }}>
    <div className={`card w-full ${wide ? "max-w-6xl" : "max-w-lg"} p-6 max-h-[88vh] overflow-auto`}>
      <div className="flex items-center justify-between gap-4 mb-4"><h2 className="text-[22px] font-medium">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded hover:opacity-80"><X size={17}/></button></div>
      {children}
    </div>
  </div>;
}

function normalizeDrafters(data: DrafterResponse, users: User[] = []): DrafterEntry[] {
  const out: DrafterEntry[] = [];
  const seen = new Set<string>();
  const names = new Map(users.map(u => [u.user_id, u.username]));

  const add = (raw: unknown, globalHint = false) => {
    if (raw === null || raw === undefined) return;
    if (typeof raw === "string" || typeof raw === "number") {
      const id = String(raw).trim();
      if (!id) return;
      const key = `${id}:${globalHint}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ user_id: id, username: names.get(id) ?? null, global: globalHint, scope: globalHint ? "global" : "station" });
      return;
    }
    if (typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const id = String(r.user_id ?? r.userId ?? r.userid ?? r.player_id ?? r.meta_user_id ?? r.id ?? "").trim();
    if (!id) return;
    const scopeText = String(r.scope ?? r.grant_scope ?? r.type ?? "").toLowerCase();
    const global = globalHint || r.global === true || r.is_global === true || scopeText.includes("global");
    const key = `${id}:${global}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      user_id: id,
      username: String(r.username ?? r.user_name ?? r.display_name ?? r.name ?? names.get(id) ?? "") || null,
      global,
      scope: String(r.scope ?? r.grant_scope ?? (global ? "global" : "station")) || null,
    });
  };

  if (Array.isArray(data)) {
    data.forEach(x => add(x));
    return out;
  }
  if (!data || typeof data !== "object") return out;
  const d = data as Record<string, unknown>;

  // Game builds have used several field names over time. Support all known
  // variants, including arrays that contain raw user IDs instead of objects.
  const addCollection = (value: unknown, globalHint: boolean) => {
    if (Array.isArray(value)) { value.forEach(x => add(x, globalHint)); return; }
    if (!value || typeof value !== "object") return;
    // A few builds serialize grants as { "<userId>": { username: ... } }.
    for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
      if (item && typeof item === "object") add({ user_id: id, ...(item as Record<string, unknown>) }, globalHint);
      else if (item === true || typeof item === "string" || typeof item === "number") add(id, globalHint);
    }
  };

  const stationKeys = ["station_drafters", "stationDrafters", "drafters", "entries", "grants", "station_grants", "users", "station"];
  const globalKeys = ["global_drafters", "globalDrafters", "global_grants", "globalGrants", "global"];
  for (const k of stationKeys) addCollection(d[k], false);
  for (const k of globalKeys) addCollection(d[k], true);

  // Some revisions use other drafter/grant field names.
  for (const [k, v] of Object.entries(d)) {
    const lower = k.toLowerCase();
    if (lower.includes("drafter") || lower.includes("grant")) addCollection(v, lower.includes("global"));
  }
  return out;
}

export function DraftersTab({ stationId, mayManage }: { stationId: string; mayManage: boolean }) {
  const [rows, setRows] = useState<DrafterEntry[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await api.stationDrafters(stationId);
      // Drafters must render even if the optional user-directory lookup fails.
      // Some scoped keys can read a station without having the full user directory.
      const u = await api.users().catch(() => [] as User[]);
      setUsers(u);
      setRows(normalizeDrafters(d, u));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load drafters");
    }
  }, [stationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.stationDrafters(stationId);
        // Drafters must render even if the optional user-directory lookup fails.
        // Some scoped keys can read a station without having the full user directory.
        const u = await api.users().catch(() => [] as User[]);
        if (cancelled) return;
        setUsers(u);
        setRows(normalizeDrafters(d, u));
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load drafters");
      }
    })();
    return () => { cancelled = true; };
  }, [stationId]);

  async function grant() {
    if (!pick) return;
    const selected = users.find(u => u.user_id === pick);
    setBusy(pick); setErr(null);
    // Optimistic row so the UI immediately reflects a successful click. The
    // follow-up GET remains the source of truth and corrects it if needed.
    setRows(prev => {
      const current = prev ?? [];
      if (current.some(r => r.user_id === pick && !r.global)) return current;
      return [...current, { user_id: pick, username: selected?.username ?? null, global: false, scope: "station" }];
    });
    try {
      const res = await api.grantStationDrafter(stationId, pick);
      if (res.success === false || res.ok === false) throw new Error(res.error || "Grant failed");
      setPick("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Grant failed");
      await load();
    } finally { setBusy(null); }
  }

  async function revoke(id: string) {
    setBusy(id); setErr(null);
    const before = rows;
    setRows(prev => prev?.filter(r => r.global || r.user_id !== id) ?? prev);
    try {
      const res = await api.revokeStationDrafter(stationId, id);
      if (res.success === false || res.ok === false) throw new Error(res.error || "Revoke failed");
      await load();
    } catch (e) {
      setRows(before ?? null);
      setErr(e instanceof Error ? e.message : "Revoke failed");
    } finally { setBusy(null); }
  }

  const stationCount = rows?.filter(r => !r.global).length ?? 0;
  const globalCount = rows?.filter(r => r.global).length ?? 0;

  return <div className="card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><h2 className="text-[18px] font-medium">Station Drafters</h2>
      <Note>{rows ? `${stationCount} station drafter${stationCount === 1 ? "" : "s"}${globalCount ? ` · ${globalCount} global` : ""}` : "Loading grants…"}</Note></div>
      <button className="btn-dark py-2! px-3! text-[13px]" onClick={load}><RefreshCw size={13}/> Refresh</button></div>
    {err && <Err>{err}</Err>}
    {mayManage && <div className="flex gap-2 mb-5"><select className="field flex-1" value={pick} onChange={e=>setPick(e.target.value)}>
      <option value="">Select a user…</option>{users.map(u=><option key={u.user_id} value={u.user_id}>{u.username} · {u.user_id}</option>)}</select>
      <button className="btn-light py-2! px-4! text-[13px]" onClick={grant} disabled={!pick || !!busy}><UserPlus size={13}/> Grant Drafter</button></div>}
    <div className="divide-y" style={{ borderColor:"var(--line)" }}>
      {rows === null ? <Note>Loading…</Note> : rows.length === 0 ? <Note>No Drafters returned for this station.</Note> : rows.map(r=><div key={`${r.user_id}:${r.global}`} className="flex items-center justify-between gap-3 py-3">
        <div><div className="font-medium">{r.username || r.user_id}</div><div className="font-mono text-[12px]" style={{color:"var(--muted)"}}>{r.user_id} · {r.global ? "Global Drafter" : "Station Drafter"}</div></div>
        {mayManage && !r.global && <button className="text-[13px]" style={{color:"var(--red)"}} disabled={busy===r.user_id} onClick={()=>revoke(r.user_id)}>Revoke</button>}
      </div>)}
    </div>
  </div>;
}

type NormalizedWhitelist = {
  raw: WhitelistResponse;
  enabled: boolean;
  names: string[];
  entries: { username: string; known: boolean }[];
  accounts: { user_id: string; username: string; platform?: string | null; last_login?: string | null }[];
};

function normalizeWhitelist(raw: WhitelistResponse, config: Record<string, string> = {}): NormalizedWhitelist {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (v: unknown) => {
    const name = typeof v === "string" ? v.trim() : (v && typeof v === "object" ? String((v as Record<string, unknown>).username ?? (v as Record<string, unknown>).name ?? "").trim() : "");
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); names.push(name); }
  };
  if (Array.isArray(raw as unknown)) (raw as unknown as unknown[]).forEach(addName);
  for (const k of ["usernames", "whitelist", "allowed", "allowed_usernames", "entries"]) {
    const v = r[k];
    if (Array.isArray(v)) v.forEach(addName);
    else if (typeof v === "string") v.split(",").forEach(addName);
  }
  const directAcl = r["acl.whitelist"];
  if (typeof directAcl === "string") directAcl.split(",").forEach(addName);
  const nestedConfig = r.config && typeof r.config === "object" ? r.config as Record<string, unknown> : null;
  const nestedAcl = nestedConfig?.["acl.whitelist"];
  if (typeof nestedAcl === "string") nestedAcl.split(",").forEach(addName);
  if (names.length === 0 && typeof config["acl.whitelist"] === "string") config["acl.whitelist"].split(",").forEach(addName);
  const entriesRaw = Array.isArray(r.entries) ? r.entries : [];
  const entries = entriesRaw.map((v: unknown) => {
    const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
    const username = typeof v === "string" ? v : String(o.username ?? o.name ?? "");
    return { username, known: o.known !== false };
  }).filter((x: { username: string }) => x.username);
  const accountsRaw = (Array.isArray(r.accounts) ? r.accounts : Array.isArray(r.users) ? r.users : Array.isArray(r.known_accounts) ? r.known_accounts : []) as unknown[];
  const accounts = accountsRaw.map(v => {
    const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
    return {
      user_id: String(o.user_id ?? o.userId ?? o.id ?? ""),
      username: String(o.username ?? o.name ?? ""),
      platform: typeof o.platform === "string" ? o.platform : null,
      last_login: typeof o.last_login === "string" ? o.last_login : null,
    };
  }).filter(a => a.user_id && a.username);
  return { raw, enabled: r.enabled === true || r.whitelist_enabled === true, names, entries, accounts };
}

export function WhitelistTab({ stationId, mayManage }: { stationId: string; mayManage: boolean }) {
  const [data, setData] = useState<NormalizedWhitelist | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (preserveWhenEmpty = false) => {
    try {
      const [raw, config] = await Promise.all([
        api.stationWhitelist(stationId),
        api.stationConfig(stationId).catch(() => ({} as Record<string,string>)),
      ]);
      const d = normalizeWhitelist(raw, config);
      setData(d);
      setNames(prev => d.names.length || !preserveWhenEmpty ? d.names : prev);
      setErr(null);
    } catch(e) { setErr(e instanceof Error ? e.message : "Failed to load whitelist"); }
  }, [stationId]);

  useEffect(()=>{
    let cancelled = false;
    (async () => {
      try {
        const [raw, config] = await Promise.all([
          api.stationWhitelist(stationId),
          api.stationConfig(stationId).catch(() => ({} as Record<string,string>)),
        ]);
        if (cancelled) return;
        const d = normalizeWhitelist(raw, config);
        setData(d);
        setNames(d.names.length ? d.names : []);
        setErr(null);
      } catch(e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load whitelist");
      }
    })();
    return () => { cancelled = true; };
  },[stationId]);

  function addName(name: string) {
    const n = name.trim();
    if (!n) return;
    setNames(prev => prev.some(x=>x.toLowerCase()===n.toLowerCase()) ? prev : [...prev,n]);
  }

  async function save() {
    setSaving(true); setErr(null); setSavedMsg(null);
    const requested = [...names];
    try {
      const raw = await api.setStationWhitelist(stationId, requested);
      const postConfig = await api.stationConfig(stationId).catch(() => ({} as Record<string,string>));
      const returned = normalizeWhitelist(raw, postConfig);
      if (returned.names.length) setNames(returned.names);
      // Verify against both the whitelist endpoint and the backing acl.whitelist
      // station-config value used by game builds.
      const [verifyRaw, verifyConfig] = await Promise.all([
        api.stationWhitelist(stationId),
        api.stationConfig(stationId).catch(() => ({} as Record<string,string>)),
      ]);
      const verified = normalizeWhitelist(verifyRaw, verifyConfig);
      setData(verified);
      if (verified.names.length) setNames(verified.names); else setNames(requested);
      const missing = requested.filter(n => verified.names.length && !verified.names.some(v => v.toLowerCase() === n.toLowerCase()));
      if (missing.length) throw new Error(`Whitelist save did not persist: ${missing.join(", ")}`);
      setSavedMsg(`Saved ${requested.length} whitelist entr${requested.length === 1 ? "y" : "ies"}.`);
    } catch(e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  const known = new Map((data?.entries??[]).map(e=>[e.username.toLowerCase(),e.known]));
  const accountOptions = data?.accounts ?? [];
  return <div className="card p-5">
    <div className="flex items-start justify-between gap-3 mb-4"><div><h2 className="text-[18px] font-medium">Whitelist</h2><Note>{names.length} current entr{names.length === 1 ? "y" : "ies"}</Note></div>
      <span className="text-[12px] px-2 py-1 rounded" style={{color:data?.enabled?"var(--green)":"var(--muted)",background:"var(--surface2)"}}>{data?.enabled ? "Enabled" : "Disabled / unknown"}</span></div>
    {err&&<Err>{err}</Err>}
    {savedMsg&&<div className="card mb-4 px-4 py-3 text-sm" style={{color:"var(--green)"}}>{savedMsg}</div>}
    {mayManage && <><div className="flex gap-2 mb-2"><select className="field flex-1" value={pick} onChange={e=>setPick(e.target.value)}><option value="">Add known account…</option>{accountOptions.map(a=><option key={a.user_id} value={a.username}>{a.username} · {a.user_id}</option>)}</select><button className="btn-dark" onClick={()=>{addName(pick);setPick("")}} disabled={!pick}>Add</button></div>
      <div className="flex gap-2 mb-5"><input className="field flex-1" value={manual} onChange={e=>setManual(e.target.value)} placeholder="Or type an exact username" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addName(manual);setManual('')}}}/><button className="btn-dark" onClick={()=>{addName(manual);setManual("")}} disabled={!manual.trim()}>Add</button></div></>}
    <div className="flex flex-wrap gap-2 mb-5">{names.length === 0 ? <Note>No usernames currently returned by the station whitelist.</Note> : names.map(n=><span key={n} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm" style={{background:"var(--surface2)",boxShadow:"inset 0 0 0 1px var(--line)"}}>{n}<span className="text-[11px]" style={{color:known.get(n.toLowerCase())===false?"var(--yellow)":"var(--muted)"}}>{known.get(n.toLowerCase())===false?"unknown":""}</span>{mayManage&&<button onClick={()=>setNames(prev=>prev.filter(x=>x!==n))}><X size={12}/></button>}</span>)}</div>
    {mayManage&&<div className="flex justify-between items-center gap-3"><button className="text-[12px]" style={{color:"var(--muted)"}} onClick={()=>load(true)} disabled={saving}>Reload from server</button><button className="btn-light" disabled={saving} onClick={save}>{saving?"Saving…":"Save whitelist"}</button></div>}
  </div>;
}

function valueToString(v: unknown): string { if (typeof v === "string") return v; if (v === null || v === undefined) return ""; return typeof v === "object" ? JSON.stringify(v) : String(v); }
function groupWorld(entries: NetvarCatalogEntry[]) {
  const groups = new Map<string,NetvarCatalogEntry[]>();
  for(const e of entries){const p=e.path??"other"; const parts=p.split('/'); const g=parts.length>1?parts.slice(0,-1).join('/'):parts[0]; if(!groups.has(g))groups.set(g,[]); groups.get(g)!.push(e);} return [...groups.entries()];
}
function flatten(value: unknown, prefix="", out: [string,string][]=[]) : [string,string][] {
  if (value && typeof value === "object" && !Array.isArray(value)) { for (const [k,v] of Object.entries(value as Record<string,unknown>)) flatten(v,prefix?`${prefix}.${k}`:k,out); }
  else if (Array.isArray(value)) value.forEach((v,i)=>flatten(v,`${prefix}[${i}]`,out));
  else out.push([prefix,valueToString(value)]); return out;
}

function NetvarEditor({ stationId, entry, config, mayWrite, onChanged }:{stationId:string;entry:NetvarCatalogEntry;config:Record<string,string>;mayWrite:boolean;onChanged:()=>void}){
  const path=entry.path??""; const key=`nv.world.${path}`; const overridden=Object.prototype.hasOwnProperty.call(config,key); const initial=overridden?config[key]:valueToString(entry.default);
  const [value,setValue]=useState(initial); const [busy,setBusy]=useState(false);
  // Sync prop-driven default into state during render (the documented pattern for
  // derived state) instead of an effect, so a config refresh resets the editor.
  const [prevInitial,setPrevInitial]=useState(initial);
  if (prevInitial!==initial){ setPrevInitial(initial); setValue(initial); }
  async function save(){setBusy(true);try{await api.patchStationConfig(stationId,{[key]:value});onChanged();}finally{setBusy(false)}}
  async function clear(){setBusy(true);try{await api.deleteStationConfigKey(stationId,key);onChanged();}finally{setBusy(false)}}
  return <div className="grid gap-3 items-center py-3 border-t" style={{gridTemplateColumns:"minmax(260px,1.6fr) minmax(180px,1fr) auto",borderColor:"var(--line)"}}>
    <div><div className="font-mono text-[13px]">{path}</div><div className="text-[11px] mt-1" style={{color:"var(--muted)"}}>{entry.type}{entry.min!=null||entry.max!=null?` · ${entry.min??'−∞'}…${entry.max??'∞'}`:""} {overridden?"· override set":"· default"}</div></div>
    {entry.type==="bool"?<select className="field" value={value} disabled={!mayWrite||busy} onChange={e=>setValue(e.target.value)}><option value="true">true</option><option value="false">false</option></select>:<input className="field" value={value} disabled={!mayWrite||busy} onChange={e=>setValue(e.target.value)} />}
    <div className="flex gap-2">{mayWrite&&<button className="btn-dark py-1.5! px-3! text-[12px]" disabled={busy||value===initial} onClick={save}>Save</button>}{mayWrite&&overridden&&<button className="text-[12px]" style={{color:"var(--red)"}} disabled={busy} onClick={clear}>Clear</button>}</div>
  </div>
}

export function NetvarsTab({ stationId, mayWrite, mayViewGlobalDumps = false }: { stationId: string; mayWrite: boolean; mayViewGlobalDumps?: boolean }) {
  const [catalog,setCatalog]=useState<NetvarCatalog|null>(null); const [config,setConfig]=useState<Record<string,string>>({}); const [dumps,setDumps]=useState<NetvarDumpIndex[]>([]); const [selected,setSelected]=useState(""); const [dump,setDump]=useState<unknown>(null); const [q,setQ]=useState(""); const [liveQ,setLiveQ]=useState(""); const [err,setErr]=useState<string|null>(null);
  const load=useCallback(async()=>{try{const[cfg,cat]=await Promise.all([api.stationConfig(stationId),api.netvarCatalog()]);setConfig(cfg);setCatalog(cat);if(mayViewGlobalDumps){setDumps(await api.netvarDumps())}else{setDumps([])}setErr(null);}catch(e){setErr(e instanceof Error?e.message:"Netvars failed to load")}},[stationId,mayViewGlobalDumps]);
  useEffect(()=>{
    let cancelled = false;
    (async () => {
      try{
        const[cfg,cat]=await Promise.all([api.stationConfig(stationId),api.netvarCatalog()]);
        if(cancelled) return;
        setConfig(cfg);setCatalog(cat);
        if(mayViewGlobalDumps){setDumps(await api.netvarDumps())}else{setDumps([])}
        setErr(null);
      }catch(e){
        if(!cancelled) setErr(e instanceof Error?e.message:"Netvars failed to load");
      }
    })();
    return () => { cancelled = true; };
  },[stationId,mayViewGlobalDumps]);
  async function choose(v:string){setSelected(v); if(!v){setDump(null);return;} const [type,id]=v.split('|'); try{setDump(await api.netvarDump(type,id));}catch(e){setErr(e instanceof Error?e.message:"Dump failed")}}
  const world=useMemo(()=>{const needle=q.toLowerCase();return (catalog?.world??[]).filter(e=>!needle||(e.path??'').toLowerCase().includes(needle)||valueToString(e.default).toLowerCase().includes(needle));},[catalog,q]);
  const flat=useMemo(()=>flatten(dump),[dump]); const filtered=useMemo(()=>{const n=liveQ.toLowerCase();return flat.filter(([p,v])=>!n||p.toLowerCase().includes(n)||v.toLowerCase().includes(n)).slice(0,500)},[flat,liveQ]);
  return <div className="space-y-4">{err&&<Err>{err}</Err>}<div className="card p-5"><div className="flex items-start justify-between gap-3 mb-4"><div><h2 className="text-[18px] font-medium">Netvars</h2><Note>Typed world variables from build 22284. Saving writes an override to the running station; Clear restores the default.</Note></div><button className="btn-dark py-2! px-3! text-[13px]" onClick={load}><RefreshCw size={13}/> Refresh</button></div>
    <input className="field mb-4" placeholder="Search path or default value" value={q} onChange={e=>setQ(e.target.value)}/>
    {!catalog?<Note>Loading catalog…</Note>:groupWorld(world).map(([g,entries])=><details key={g} className="mb-2"><summary className="cursor-pointer font-medium text-[14px] py-2">world · {g} <span style={{color:"var(--muted)"}}>({entries.length})</span></summary><div>{entries.map(e=><NetvarEditor key={e.path} stationId={stationId} entry={e} config={config} mayWrite={mayWrite} onChanged={load}/>)}</div></details>)}
    {catalog&&catalog.modules.length>0&&<details className="mt-3"><summary className="cursor-pointer font-medium text-[14px] py-2">gamemode variables <span style={{color:"var(--muted)"}}>({catalog.modules.reduce((n,m)=>n+m.vars.length,0)})</span></summary><div className="card p-4"><Note>The catalog is preserved, but gamemode override key naming has not yet been captured from a live backend. These are intentionally read-only in this first hardened build rather than guessing a mutation key.</Note>{catalog.modules.map(m=><div key={m.slot_key} className="mt-4"><div className="font-medium text-sm">{m.level} · {m.slot_key}</div>{m.vars.map(v=><div key={v.name} className="grid grid-cols-2 gap-3 py-2 border-t text-[13px]" style={{borderColor:"var(--line)"}}><span className="font-mono">{v.name}</span><span style={{color:"var(--muted)"}}>{valueToString(v.default)}</span></div>)}</div>)}</div></details>}
  </div>
  {mayViewGlobalDumps && <div className="card p-5"><h2 className="text-[18px] font-medium mb-1">Live server report</h2><Note>Inspect a captured runtime dump, flattened to path = value. Results are capped at 500 rows for browser performance.</Note><div className="flex gap-2 mt-4 mb-3"><select className="field flex-1" value={selected} onChange={e=>choose(e.target.value)}><option value="">Choose a dump…</option>{dumps.map((d,i)=><option key={`${d.deployment_id}:${d.event_type}:${i}`} value={`${d.event_type}|${d.deployment_id}`}>{d.event_type} · {d.deployment_id.slice(0,12)} · {Math.round(d.bytes/1024)} KB · {d.source}</option>)}</select><button className="btn-dark" onClick={()=>selected&&choose(selected)}><RefreshCw size={13}/></button></div>{dump !== null && <><input className="field mb-3" placeholder="Search path or value" value={liveQ} onChange={e=>setLiveQ(e.target.value)}/><Note>Showing {filtered.length} of {flat.length.toLocaleString()} flattened values.</Note><div className="mt-3 max-h-[560px] overflow-auto font-mono text-[12px]">{filtered.map(([p,v])=><div key={p} className="grid gap-3 py-1.5 border-t" style={{gridTemplateColumns:"minmax(280px,1fr) 1fr",borderColor:"var(--line)"}}><span>{p}</span><span className="break-all" style={{color:"var(--muted)"}}>{v}</span></div>)}</div></>}</div>}
  </div>;
}

export function EditorLevelsTab({ mayWrite }: { mayWrite: boolean }) {
  const [levels,setLevels]=useState<SpecLevel[]|null>(null); const [err,setErr]=useState<string|null>(null); const [view,setView]=useState<{name:string;text:string}|null>(null); const [busy,setBusy]=useState<string|null>(null);
  const load=useCallback(async()=>{try{setLevels(await api.specLevels());setErr(null)}catch(e){setErr(e instanceof Error?e.message:"Failed to load editor levels")}},[]);   useEffect(()=>{
    let cancelled = false;
    (async () => {
      try{
        const lv=await api.specLevels();
        if(cancelled) return;
        setLevels(lv);setErr(null);
      }catch(e){
        if(!cancelled) setErr(e instanceof Error?e.message:"Failed to load editor levels");
      }
    })();
    return () => { cancelled = true; };
  },[]);
  async function patch(name:string,body:{loaded?:boolean;autoload?:boolean}){setBusy(name);try{await api.patchSpecLevel(name,body);await load()}finally{setBusy(null)}}
  async function show(name:string){setBusy(name);try{setView(await api.specLevel(name))}finally{setBusy(null)}}
  async function remove(name:string){if(!confirm(`Delete editor level “${name}”? This cannot be undone from the dashboard.`))return;setBusy(name);try{await api.deleteSpecLevel(name);await load()}finally{setBusy(null)}}
  return <div className="card p-5">{view&&<Modal title={`Level · ${view.name} (read-only)`} wide onClose={()=>setView(null)}><pre className="overflow-auto text-[12px] leading-5 p-4 rounded" style={{background:"var(--bg)",color:"var(--text)",maxHeight:"70vh"}}>{view.text}</pre></Modal>}
    <div className="flex items-start justify-between gap-3 mb-4"><div><h2 className="text-[18px] font-medium">Editor levels</h2><Note>Saved from the in-game Spec Editor. Autoload controls server boot; Load/Unload applies live.</Note></div><button className="btn-dark py-2! px-3! text-[13px]" onClick={load}><RefreshCw size={13}/> Refresh</button></div>{err&&<Err>{err}</Err>}
    <div className="overflow-x-auto"><div className="min-w-[900px]"><div className="grid gap-3 px-2 py-2 text-[12px] font-bold" style={{gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1fr .7fr auto",color:"var(--muted)"}}><span>Name</span><span>Updated</span><span>Size</span><span>On server now</span><span>Load on boot</span><span>Live</span><span/></div>
      {(levels??[]).map(l=><div key={l.name} className="grid gap-3 items-center px-2 py-3 border-t text-[13px]" style={{gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1fr .7fr auto",borderColor:"var(--line)"}}><span className="font-medium">{l.name}</span><span style={{color:"var(--muted)"}}>{new Date(l.updated).toLocaleDateString()}</span><span style={{color:"var(--muted)"}}>{l.size<1024?`${l.size} B`:`${(l.size/1024).toFixed(1)} KB`}</span><span style={{color:l.loaded?"var(--green)":"var(--muted)"}}>{l.loaded?"Loaded":"Not loaded"}</span><label className="flex items-center gap-2"><input type="checkbox" checked={l.autoload} disabled={!mayWrite||busy===l.name} onChange={e=>patch(l.name,{autoload:e.target.checked})}/><span className="text-[12px]">autoload</span></label><button className="btn-dark py-1.5! px-3! text-[12px]" disabled={!mayWrite||busy===l.name} onClick={()=>patch(l.name,{loaded:!l.loaded})}>{l.loaded?"Unload":"Load now"}</button><div className="flex gap-2"><button className="p-1.5" title="View" onClick={()=>show(l.name)}><Eye size={14}/></button>{mayWrite&&<button className="p-1.5" title="Delete" style={{color:"var(--red)"}} onClick={()=>remove(l.name)}><Trash2 size={14}/></button>}</div></div>)}
      {levels?.length===0&&<Note>No editor levels found.</Note>}
    </div></div>
  </div>;
}
