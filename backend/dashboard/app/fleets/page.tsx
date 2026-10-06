"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Fleet } from "../../lib/api";
import { useMe } from "../../lib/useMe";
import { safeHttpUrl } from "../../lib/safeUrl";
import { EmptyRow } from "../../components/ui";
import { RefreshCw, Plus, Users, Server, ShieldCheck, Clock, Ban } from "lucide-react";

export function StatusBadge({ status }: { status: Fleet["status"] }) {
  // Official is the default — no tag. Only non-standard states get a pill.
  if (status === "official") return null;
  const map: Record<string, { fg: string; ring: string; label: string }> = {
    official:  { fg: "var(--green)", ring: "rgba(139,212,80,0.35)",  label: "Official" },
    pending:   { fg: "#e3b341",      ring: "rgba(227,179,65,0.35)",  label: "Pending" },
    suspended: { fg: "var(--red)",   ring: "rgba(229,72,77,0.35)",   label: "Suspended" },
    rejected:  { fg: "var(--red)",   ring: "rgba(229,72,77,0.35)",   label: "Rejected" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span
      className="text-[11px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 shrink-0"
      style={{ color: s.fg, background: "rgba(255,255,255,0.03)", boxShadow: `inset 0 0 0 1px ${s.ring}`, borderRadius: 3 }}
    >
      {s.label}
    </span>
  );
}

export function FleetBadge({ fleet, size = 44 }: { fleet: Pick<Fleet, "tag" | "badge_url" | "name">; size?: number }) {
  // Untrusted origin (fleet-managed): only absolute http(s) renders, and the
  // image host gets no Referer. Anything else falls back to the tag tile.
  const safe = safeHttpUrl(fleet.badge_url);
  if (!safe) {
    return (
      <span
        aria-hidden
        className="flex items-center justify-center font-semibold shrink-0"
        style={{ width: size, height: size, borderRadius: 8, background: "#2a2f38", color: "var(--link)", fontSize: size * 0.42 }}
      >
        {(fleet.tag?.slice(0, 2) || fleet.name.trim()[0] || "?").toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={safe} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />;
}

export default function FleetsPage() {
  const router = useRouter();
  const { isGlobalAdmin } = useMe();
  const [fleets, setFleets] = useState<Fleet[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);   // first fetch starts on mount
  const [applying, setApplying] = useState(false);

  // apply form
  const [f, setF] = useState({ name: "", tag: "", discord_invite: "", member_count: "", has_sax_member: false });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.fleets().then(d => { setFleets(d); setErr(null); }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => {
    let cancelled = false;
    api.fleets().then(d => {
      if (cancelled) return;
      setFleets(d); setErr(null);
    }).catch(e => { if (!cancelled) setErr(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function apply() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      const res = await api.applyFleet({
        name: f.name.trim(), tag: f.tag.trim(),
        discord_invite: f.discord_invite.trim() || undefined,
        member_count: f.member_count ? parseInt(f.member_count) : undefined,
        has_sax_member: f.has_sax_member,
      });
      if (res.success) { setApplying(false); setF({ name: "", tag: "", discord_invite: "", member_count: "", has_sax_member: false }); load(); }
      else setErr(res.error || "failed");
    } finally { setSaving(false); }
  }

  async function quick(id: string, action: "approve" | "suspend") {
    await (action === "approve" ? api.approveFleet(id) : api.suspendFleet(id));
    load();
  }

  return (
    <div className="mx-auto max-w-[1200px] pt-8 pb-14">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="eyebrow mb-1.5">Communities</p>
          <h1 className="text-[44px] leading-tight font-medium tracking-tight">Community Fleets</h1>
          <p className="text-[15px] mt-1.5" style={{ color: "var(--muted)" }}>
            Communities that operate allocated stations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setApplying(true)} className="btn-light py-2.5! px-5! text-sm">
            <Plus size={14} /> Apply for Fleet
          </button>
          <button onClick={load} disabled={loading} className="btn-dark" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {err && (
        <div className="card mb-4 px-5 py-3.5 text-[15px]" style={{ color: "var(--red)" }}>{err}</div>
      )}

      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {!fleets ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="skeleton h-11 w-11" />
                <div className="skeleton h-5 w-40" />
              </div>
              <div className="skeleton h-4 w-2/3" />
            </div>
          ))
        ) : fleets.length === 0 ? (
          <div className="card col-span-full">
            <EmptyRow>No fleets yet. Apply to create the first one.</EmptyRow>
          </div>
        ) : fleets.map(fl => (
          <div
            key={fl.fleet_id}
            role="link"
            tabIndex={0}
            aria-label={`Open fleet ${fl.name}`}
            onClick={() => router.push(`/fleets/${fl.fleet_id}`)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/fleets/${fl.fleet_id}`); } }}
            className="card card-hover p-6 text-left cursor-pointer focus-visible:outline-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0">
                <FleetBadge fleet={fl} size={56} />
                <div className="min-w-0">
                  <div className="text-[21px] font-medium truncate leading-tight">{fl.name}</div>
                  <div className="text-[13px] tabular mt-0.5" style={{ color: "var(--muted)" }}>{fl.tag}</div>
                </div>
              </div>
              <StatusBadge status={fl.status} />
            </div>
            <div className="flex items-center gap-5 mt-4 pt-4 text-[14px] tabular"
              style={{ color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
              <span className="flex items-center gap-2"><Server size={14} /> {fl.station_count} station{fl.station_count === 1 ? "" : "s"}</span>
              <span className="flex items-center gap-2"><Users size={14} /> {fl.member_count} member{fl.member_count === 1 ? "" : "s"}</span>
              {fl.has_sax_member && <span className="flex items-center gap-2" style={{ color: "var(--green)" }}><ShieldCheck size={14} /> Sax</span>}
            </div>
            {isGlobalAdmin && (
              <div className="flex items-center gap-3 mt-4" onClick={e => e.stopPropagation()}>
                {fl.status !== "official" && (
                  <button onClick={() => quick(fl.fleet_id, "approve")}
                    className="flex items-center gap-1.5 text-[14px] font-medium link-blue">
                    <ShieldCheck size={13} /> Approve
                  </button>
                )}
                {fl.status !== "suspended" && (
                  <button onClick={() => quick(fl.fleet_id, "suspend")}
                    className="flex items-center gap-1.5 text-[14px] font-medium"
                    style={{ color: "var(--red)" }}>
                    <Ban size={13} /> Suspend
                  </button>
                )}
                {fl.status === "pending" && (
                  <span className="flex items-center gap-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
                    <Clock size={13} /> awaiting review
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Apply modal */}
      {applying && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)" }}
          onClick={e => { if (e.target === e.currentTarget) setApplying(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Apply for a community fleet"
        >
          <div className="card w-full max-w-md p-6">
            <p className="eyebrow mb-1.5">Communities</p>
            <h2 className="text-[24px] font-medium mb-5">Apply for a Fleet</h2>
            {[
              { k: "name", label: "Fleet name", ph: "NA West Collective" },
              { k: "tag", label: "Tag (short)", ph: "NAW" },
              { k: "discord_invite", label: "Discord invite", ph: "discord.gg/…" },
              { k: "member_count", label: "Discord member count", ph: "45" },
            ].map(fld => (
              <div key={fld.k} className="mb-3">
                <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>{fld.label}</label>
                <input
                  className="field"
                  value={(f as Record<string, string | boolean>)[fld.k] as string}
                  onChange={e => setF(s => ({ ...s, [fld.k]: e.target.value }))}
                  placeholder={fld.ph}
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm mb-5 cursor-pointer" style={{ color: "var(--muted)" }}>
              <input type="checkbox" checked={f.has_sax_member} onChange={e => setF(s => ({ ...s, has_sax_member: e.target.checked }))} />
              We have an AnotherSaxophone member in our Discord
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setApplying(false)} className="btn-dark text-sm">Cancel</button>
              <button onClick={apply} disabled={saving || !f.name.trim()} className="btn-light py-2.5! px-5! text-sm">
                {saving ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
