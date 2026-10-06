"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Station } from "../lib/api";
import { useMe } from "../lib/useMe";
import { EmptyRow } from "../components/ui";
import { SpinUpModal } from "../components/SpinUpModal";
import { LockKeyhole, RefreshCw, Rocket } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { me, loggedIn, isGlobalAdmin, hasPermission, canReadStation, canLaunchStation } = useMe();
  const [stations, setStations] = useState<Station[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [loading, setLoading] = useState(true);   // first fetch starts on login
  const [spinning, setSpinning] = useState(false);
  const [spinMsg, setSpinMsg] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.stations().then(s => { setStations(s); setErr(null); }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api.stations().then(s => {
      if (cancelled) return;
      setStations(s); setErr(null);
    }).catch(e => {
      if (!cancelled) setErr(e.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loggedIn]);

  const shown = useMemo(() => (stations ?? []).filter(s => !onlineOnly || s.online).sort((a,b) => a.station_name.localeCompare(b.station_name)), [stations, onlineOnly]);
  const launchable = useMemo(() => (stations ?? []).filter(s => canLaunchStation(s.station_id)), [stations, canLaunchStation]);
  const canSpin = isGlobalAdmin || (hasPermission("stations:launch") && launchable.length > 0);

  return (
    <div className="mx-auto max-w-[1200px] pt-14 pb-20">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,800px)_1fr] items-start">
        <div className="min-w-0">
          <h1 className="text-[44px] leading-tight font-medium tracking-tight">
            {loggedIn && me ? <>Welcome <span className="grad-name">{me.operator_label ?? me.user_id}</span>!</> : "Station Dashboard"}
          </h1>
          <p className="text-[20px] mt-9">{loggedIn ? "Choose a station:" : "Log in to continue."}</p>

          <div className="flex items-center gap-4 mt-7 mb-4">
            <button role="switch" aria-checked={onlineOnly} className="toggle" onClick={() => setOnlineOnly(v => !v)}><span className="knob" /></button>
            <span className="text-[17px]">Only show online stations</span>
            <div className="flex-1" />
            {canSpin && <button onClick={() => { setSpinMsg(null); setSpinning(true); }} className="btn-light min-w-0! text-sm"><Rocket size={14}/> Spin Up</button>}
            <button onClick={load} disabled={loading || !loggedIn} className="btn-dark" aria-label="Refresh"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button>
          </div>

          {err && <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--red)" }}>{err}</div>}
          {spinMsg && <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--green)" }}>{spinMsg}</div>}

          <div className="tbl-head grid grid-cols-[52px_1fr_110px_130px] items-center gap-2 px-5 py-4">
            <span/><span className="text-[17px] font-bold">Station Name</span><span className="text-[17px] font-bold text-center">Online</span><span className="text-[17px] font-bold text-center">Players</span>
          </div>
          <div>
            {!loggedIn ? <EmptyRow>Log in to see stations.</EmptyRow> : !stations ? (
              [...Array(5)].map((_,i) => <div key={i} className="tbl-row px-5 py-5"><div className="skeleton h-5 w-1/2"/></div>)
            ) : shown.length === 0 ? <EmptyRow>{onlineOnly ? "No online stations" : "No stations found"}</EmptyRow> : shown.map(st => (
              <button key={st.station_id} onClick={() => router.push(`/stations/${st.station_id}`)} className="tbl-row grid grid-cols-[52px_1fr_110px_130px] items-center gap-2 px-5 py-4 w-full text-left">
                <span className="h-11 w-11 rounded-md flex items-center justify-center font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--muted)" }}>{(st.station_name || "S")[0].toUpperCase()}</span>
                <span className="min-w-0 flex items-center gap-2"><span className="text-[17px] truncate">{st.station_name}</span>{!canReadStation(st.station_id) && <span className="shrink-0 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded" style={{color:"var(--muted)",background:"var(--surface2)"}}><LockKeyhole size={10}/> No access</span>}</span>
                <span className="flex justify-center"><span className={`status-sq ${st.online ? "on" : "off"}`}/></span>
                <span className="text-[17px] text-center tabular">{st.player_count ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {spinning && <SpinUpModal stations={launchable} onClose={() => setSpinning(false)} onDone={msg => { setSpinning(false); setSpinMsg(msg); load(); }} />}
    </div>
  );
}
