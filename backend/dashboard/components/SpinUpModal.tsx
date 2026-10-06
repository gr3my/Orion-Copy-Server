"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Deployment, type Station } from "../lib/api";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-4"><label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>{label}</label>{children}</div>;
}
function resolveName(base: string, taken: Set<string>): string {
  const name = base.trim(); if (!name || !taken.has(name.toLowerCase())) return name;
  const m = name.match(/^(.*?)_(\d+)$/); const stem = (m ? m[1] : name).replace(/_+$/, "") || name;
  let i = m ? parseInt(m[2],10)+1 : 1; while (taken.has(`${stem}_${i}`.toLowerCase())) i++; return `${stem}_${i}`;
}

export function SpinUpModal({ initialStationId, lockStation, stations: stationsProp, onClose, onDone }: {
  initialStationId?: string | null; lockStation?: boolean; stations?: Station[] | null; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [stationsFetched, setStationsFetched] = useState<Station[] | null>(null);
  const stations = stationsProp ?? stationsFetched;
  const [agents, setAgents] = useState<{ box:string; capacity:number; running:number; free:number }[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [stationId, setStationId] = useState(initialStationId ?? "");
  const [form, setForm] = useState({ box:"", map:"", region:"", args:"", name:"" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string|null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!stationsProp) {
      api.stations()
        .then(s => { if (!cancelled) setStationsFetched(s); })
        .catch(() => { if (!cancelled) setStationsFetched([]); });
    }
    api.agents()
      .then(r => { if (!cancelled) setAgents(r.agents); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stationsProp]);
  useEffect(() => {
    if (!stationId) { return; }
    let cancelled = false;
    api.stationDeployments(stationId)
      .then(d => { if (!cancelled) setDeps(d); })
      .catch(() => { if (!cancelled) setDeps([]); });
    return () => { cancelled = true; };
  }, [stationId]);
  const taken = useMemo(() => new Set(deps.map(d => (d.deployment_name ?? "").toLowerCase()).filter(Boolean)), [deps]);
  const resolved = resolveName(form.name, taken);
  async function spin() {
    if (!stationId || saving) return; setSaving(true); setErr(null);
    try {
      const res = await api.spinUpServer(stationId, { box:form.box||undefined, map:form.map||undefined, region:form.region||undefined, args:form.args||undefined, name:resolved||undefined });
      if (!res.success) { setErr(res.error ?? "Spin-up failed"); return; }
      onDone(`Spin-up requested${res.agent ? ` on ${res.agent}` : ""}${resolved ? ` as \"${resolved}\"` : ""}.`);
    } catch(e:unknown) { setErr(e instanceof Error ? e.message : "Spin-up failed"); } finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(0,0,0,.65)" }} onClick={e => e.target===e.currentTarget && onClose()}>
    <div className="card w-full max-w-md p-6">
      <p className="eyebrow mb-1.5">Allocator</p><h2 className="text-2xl font-medium mb-5">Spin Up Server</h2>
      {!lockStation && <Field label="Station"><select className="field" value={stationId} onChange={e=>{setStationId(e.target.value); setDeps([]);}}><option value="">Select station…</option>{(stations??[]).map(s=><option key={s.station_id} value={s.station_id}>{s.station_name}</option>)}</select></Field>}
      <Field label="Deployment name"><input className="field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Optional"/></Field>
      <Field label="Box"><select className="field" value={form.box} onChange={e=>setForm(f=>({...f,box:e.target.value}))}><option value="">Auto</option>{agents.map(a=><option key={a.box} value={a.box} disabled={a.free<=0}>{a.box} — {a.free}/{a.capacity} free</option>)}</select></Field>
      <Field label="Map / playlist"><input className="field" value={form.map} onChange={e=>setForm(f=>({...f,map:e.target.value}))} placeholder="Optional"/></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Region"><input className="field" value={form.region} onChange={e=>setForm(f=>({...f,region:e.target.value}))}/></Field><Field label="Extra args"><input className="field" value={form.args} onChange={e=>setForm(f=>({...f,args:e.target.value}))}/></Field></div>
      {err && <div className="card mb-4 px-4 py-3 text-sm" style={{ color:"var(--red)" }}>{err}</div>}
      <div className="flex gap-2 justify-end"><button className="btn-dark text-sm" onClick={onClose}>Cancel</button><button className="btn-light text-sm" disabled={!stationId||saving} onClick={spin}>{saving?"Requesting…":"Spin Up"}</button></div>
    </div>
  </div>;
}
