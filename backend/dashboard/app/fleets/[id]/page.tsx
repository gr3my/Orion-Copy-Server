"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type Fleet, type FleetMember, type FleetStation, type Station, type FleetScope } from "../../../lib/api";
import { safeInviteUrl } from "../../../lib/safeUrl";
import { useMe } from "../../../lib/useMe";
import { EmptyRow, NotFound } from "../../../components/ui";
import { FleetBadge, StatusBadge } from "../page";
import { ChevronLeft, ShieldCheck, Ban, Trash2, Plus, X, UserPlus } from "lucide-react";

const ALL_SCOPES: { key: FleetScope; label: string; desc: string }[] = [
  { key: "fleet:read",   label: "Read",   desc: "view stations, deployments, players" },
  { key: "fleet:write",  label: "Write",  desc: "edit config/events + level editor" },
  { key: "fleet:launch", label: "Launch", desc: "spin up / stop stations" },
  { key: "fleet:manage", label: "Manage", desc: "members, badge, staff grants (owner)" },
];

function Section({ title, sub, right, children }: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-[22px] font-medium tracking-tight">{title}</h2>
          {sub && <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function ScopeChip({ on, label, desc, onClick }: { on: boolean; label: string; desc?: string; onClick?: () => void }) {
  const inner = (
    <span
      className="font-mono text-[13px] px-2 py-0.5 rounded"
      style={{
        background: on ? "rgba(124,199,255,0.12)" : "var(--surface2)",
        color: on ? "var(--link)" : "var(--muted)",
        boxShadow: on ? "inset 0 0 0 1px rgba(124,199,255,0.4)" : "inset 0 0 0 1px var(--line)",
      }}
    >
      {label}
    </span>
  );
  return onClick ? (
    <button title={desc} onClick={onClick} className="hover:opacity-80">{inner}</button>
  ) : (
    <span title={desc}>{inner}</span>
  );
}

/** Live Discord member count via our own proxy (see next.config.ts — Discord
 *  blocks browser CORS, so this goes server-side). Anything goes wrong
 *  (no invite, bad code, rate limit) -> null and callers fall back to the
 *  manually set count. */
async function fetchDiscordCount(invite: string | null): Promise<number | null> {
  if (!invite) return null;
  const m = invite.trim().match(/(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([\w-]+)/i);
  if (!m) return null;
  const res = await fetch(`/discord-api/v10/invites/${m[1]}?with_counts=true`);
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return typeof j?.approximate_member_count === "number" ? j.approximate_member_count : null;
}

function EditFleetModal({ fleet, isGlobalAdmin, onClose, onSaved, onDeleted }: {
  fleet: Fleet;
  isGlobalAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [badgeUrl, setBadgeUrl] = useState(fleet.badge_url ?? "");
  const [invite, setInvite] = useState(fleet.discord_invite ?? "");
  const [count, setCount] = useState(String(fleet.member_count));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"suspend" | "delete" | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await api.updateFleet(fleet.fleet_id, {
        badge_url: badgeUrl,
        discord_invite: invite,
        member_count: parseInt(count) || 0,
      });
      if (!res.success) { setErr(res.error ?? "Save failed."); return; }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      await api.approveFleet(fleet.fleet_id);
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Approve failed.");
    } finally {
      setBusy(false);
    }
  }

  async function suspend() {
    setBusy(true);
    setErr(null);
    try {
      await api.suspendFleet(fleet.fleet_id);
      setConfirm(null);
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Suspend failed.");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.deleteFleet(fleet.fleet_id);
      if (!res.success) { setErr(res.error ?? "Delete failed."); return; }
      onDeleted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit fleet ${fleet.name}`}
    >
      <div className="card w-full max-w-md p-6 overflow-y-auto" style={{ maxHeight: "90vh" }}>
        <p className="eyebrow mb-1.5">Fleet settings</p>
        <h2 className="text-[24px] font-medium mb-5">Edit {fleet.name}</h2>

        {err && <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--red)" }}>{err}</div>}

        <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Badge image URL</label>
        <input className="field mb-4" value={badgeUrl} onChange={e => setBadgeUrl(e.target.value)} placeholder="https://…" />

        <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Discord invite</label>
        <input className="field mb-4" value={invite} onChange={e => setInvite(e.target.value)} placeholder="discord.gg/…" />

        <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>
          Member count <span style={{ opacity: 0.7 }}>(manual — used when Discord won&apos;t share the live number)</span>
        </label>
        <input className="field mb-5" type="number" min="0" value={count} onChange={e => setCount(e.target.value)} />

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-dark text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-light py-2.5! px-5! text-sm">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {isGlobalAdmin && (
          <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--line)" }}>
            <p className="eyebrow mb-1.5" style={{ color: "var(--red)" }}>Danger zone</p>

            {fleet.status !== "official" && (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <div className="text-sm">
                  <p className="font-medium">Approve fleet</p>
                  <p className="text-[13px]" style={{ color: "var(--muted)" }}>Marks it official. No downtime.</p>
                </div>
                <button onClick={approve} disabled={busy} className="btn-dark py-2! text-[13px] shrink-0" style={{ color: "var(--green)" }}>
                  <ShieldCheck size={13} /> Approve
                </button>
              </div>
            )}

            {fleet.status !== "suspended" ? (
              confirm === "suspend" ? (
                <div className="rounded-md p-4 mt-2" style={{ background: "rgba(229,72,77,0.07)", boxShadow: "inset 0 0 0 1px rgba(229,72,77,0.4)" }}>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--red)" }}>
                    Suspend {fleet.name}?
                  </p>
                  <p className="text-[13px] mb-4" style={{ color: "var(--muted)" }}>
                    Its stations go offline for players right away. Members keep their scopes, and you can
                    re-approve afterwards. This is the big red lever — be sure.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setConfirm(null)} className="btn-dark py-2! text-[13px]">Keep it</button>
                    <button onClick={suspend} disabled={busy} className="btn-light py-2! px-4! text-[13px]" style={{ background: "var(--red)", color: "#fff" }}>
                      {busy ? "Suspending…" : "Suspend fleet"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <div className="text-sm">
                    <p className="font-medium">Suspend fleet</p>
                    <p className="text-[13px]" style={{ color: "var(--muted)" }}>Takes its stations offline.</p>
                  </div>
                  <button onClick={() => setConfirm("suspend")} className="btn-dark py-2! text-[13px] shrink-0" style={{ color: "var(--red)" }}>
                    <Ban size={13} /> Suspend
                  </button>
                </div>
              )
            ) : (
              <p className="text-[13px] py-2.5" style={{ color: "var(--muted)" }}>
                Currently suspended — approve above to bring it back.
              </p>
            )}

            {confirm === "delete" ? (
              <div className="rounded-md p-4 mt-2" style={{ background: "rgba(229,72,77,0.07)", boxShadow: "inset 0 0 0 1px rgba(229,72,77,0.4)" }}>
                <p className="text-sm font-medium mb-1" style={{ color: "var(--red)" }}>
                  Delete {fleet.name} forever?
                </p>
                <p className="text-[13px] mb-4" style={{ color: "var(--muted)" }}>
                  The fleet, its {fleet.station_count} station{fleet.station_count === 1 ? "" : "s"} allocations
                  and every member scope go with it. There is no undo.
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setConfirm(null)} className="btn-dark py-2! text-[13px]">Keep it</button>
                  <button onClick={destroy} disabled={busy} className="btn-light py-2! px-4! text-[13px]" style={{ background: "var(--red)", color: "#fff" }}>
                    {busy ? "Deleting…" : "Delete forever"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <div className="text-sm">
                  <p className="font-medium">Delete fleet</p>
                  <p className="text-[13px]" style={{ color: "var(--muted)" }}>Removes everything. No undo.</p>
                </div>
                <button onClick={() => setConfirm("delete")} className="btn-dark py-2! text-[13px] shrink-0">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FleetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isGlobalAdmin, canManage, canRead, loading: meLoading, loggedIn } = useMe();

  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [fleetLoaded, setFleetLoaded] = useState(false);
  const [members, setMembers] = useState<FleetMember[]>([]);
  const [stations, setStations] = useState<FleetStation[]>([]);
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const manage = isGlobalAdmin || canManage();

  const load = useCallback(() => {
    api.fleet(id)
      .then((f) => { setFleet(f); setFleetLoaded(true); })
      .catch((e) => { setErr(e.message); setFleetLoaded(true); });
    api.fleetStations(id).then(setStations).catch(() => {});
    if (isGlobalAdmin || canManage()) api.fleetMembers(id).then(setMembers).catch(() => {});
    if (isGlobalAdmin) api.stations().then(setAllStations).catch(() => {});
  }, [id, isGlobalAdmin, canManage]);
  useEffect(() => { load(); }, [load]);

  // ── member add form ──
  const [newUser, setNewUser] = useState("");
  const [newScopes, setNewScopes] = useState<Set<string>>(new Set(["fleet:read"]));
  async function addMember() {
    if (!newUser.trim() || newScopes.size === 0) return;
    const res = await api.addFleetMember(id, newUser.trim(), [...newScopes]);
    if (res.success) { setNewUser(""); setNewScopes(new Set(["fleet:read"])); api.fleetMembers(id).then(setMembers); }
    else setErr(res.error || "grant failed");
  }
  async function editMemberScopes(userId: string, scopes: string[]) {
    await api.addFleetMember(id, userId, scopes);
    api.fleetMembers(id).then(setMembers);
  }
  async function removeMember(userId: string) {
    await api.removeFleetMember(id, userId);
    api.fleetMembers(id).then(setMembers);
  }

  // ── edit fleet modal ──
  const [editingFleet, setEditingFleet] = useState(false);

  // Live Discord headcount (public invite endpoint). Null on any failure —
  // callers fall back to the manually set count. The invite travels with the
  // value so a stale number from the previous invite never flashes.
  const [discordCount, setDiscordCount] = useState<{ invite: string | null; n: number | null }>({ invite: null, n: null });
  useEffect(() => {
    const invite = fleet?.discord_invite ?? null;
    let cancelled = false;
    fetchDiscordCount(invite)
      .then(n => { if (!cancelled) setDiscordCount({ invite, n }); })
      .catch(() => { if (!cancelled) setDiscordCount({ invite, n: null }); });
    return () => { cancelled = true; };
  }, [fleet?.discord_invite]);
  const liveCount = discordCount.invite === (fleet?.discord_invite ?? null) ? discordCount.n : null;

  // ── admin: allocation ──
  const [allocPick, setAllocPick] = useState("");
  async function allocate() { if (!allocPick) return; await api.allocateStation(id, allocPick); setAllocPick(""); load(); }
  async function deallocate(sid: string) { await api.deallocateStation(id, sid); load(); }

  // Player counts: prefer the backend's per-station figure, fall back to the
  // full station list (admins). Totals only count stations with known figures.
  const playersById = useMemo(
    () => new Map(allStations.map(s => [s.station_id, s.player_count] as const)),
    [allStations],
  );
  const unallocated = allStations.filter(s => !s.community_fleet_id);

  // Backend allocation only, live stations first then alphabetical.
  const viewStations = useMemo(
    () => [...stations].sort((a, b) =>
      Number(b.online) - Number(a.online) || a.station_name.localeCompare(b.station_name)),
    [stations],
  );
  const stationPlayers = (s: FleetStation) => s.player_count ?? playersById.get(s.station_id);
  const knownPlayers = viewStations
    .map(stationPlayers)
    .filter((n): n is number => typeof n === "number");
  const totalPlayers = knownPlayers.reduce((a, b) => a + b, 0);
  const playersKnown = viewStations.length > 0 && knownPlayers.length === viewStations.length;

  if (!fleetLoaded || meLoading) {
    return (
      <div className="mx-auto max-w-[1100px] pt-8">
        <div className="card"><EmptyRow>Loading fleet…</EmptyRow></div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <NotFound
        eyebrow="Logged out"
        title="Log in"
        message="Log in to open this fleet."
        actionLabel="Log in"
        actionHref="/login"
      />
    );
  }

  // No fleet:read on this fleet (or no such fleet) — indistinguishable 404.
  if (!fleet || !canRead()) return <NotFound />;

  // Fleet-managed invite: validated to an absolute https URL before it
  // becomes a link; anything else renders as inert text (no href).
  const discord = safeInviteUrl(fleet.discord_invite);

  return (
    <div className="mx-auto max-w-[1100px] pt-8 pb-14 space-y-4">
      {/* Breadcrumb */}
      <button onClick={() => router.push("/")}
        className="flex items-center gap-1.5 text-[15px] hover:opacity-80" style={{ color: "var(--muted)" }}>
        <ChevronLeft size={16} /> Home
      </button>

      {/* Header */}
      <div className="card px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <FleetBadge fleet={fleet} size={60} />
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[28px] leading-tight font-medium tracking-tight truncate">{fleet.name}</h1>
                <StatusBadge status={fleet.status} />
              </div>
              <p className="text-sm mt-1 tabular" style={{ color: "var(--muted)" }}>
                {fleet.tag} · owner <span className="font-mono text-[13px]">{fleet.owner_user_id}</span> · {fleet.station_count} stations ·{" "}
                <span title={liveCount !== null ? "Live from Discord" : "Set by hand — Discord wouldn't share the live number"}>
                  {liveCount ?? fleet.member_count} members
                </span>
                {playersKnown && <> · <span className="font-medium" style={{ color: "var(--text)" }}>{totalPlayers} player{totalPlayers === 1 ? "" : "s"}</span></>}
                {discord && <> · <a href={discord} target="_blank" rel="noopener noreferrer" className="link-blue">Discord</a></>}
                {!discord && fleet.discord_invite && <> · <span style={{ color: "var(--muted)" }}>Discord</span></>}
              </p>
            </div>
          </div>
          {manage && (
            <button onClick={() => setEditingFleet(true)} className="btn-dark py-2! text-[13px] shrink-0">
              Edit Fleet
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="card px-5 py-3.5 text-[15px]" style={{ color: "var(--red)" }}>{err}</div>
      )}

      {editingFleet && manage && (
        <EditFleetModal
          fleet={fleet}
          isGlobalAdmin={isGlobalAdmin}
          onClose={() => setEditingFleet(false)}
          onSaved={() => { api.fleet(id).then(setFleet); load(); }}
          onDeleted={() => router.replace("/")}
        />
      )}

      {/* Staff & scopes (managers) */}
      {manage && (
        <Section title="Staff & scopes" sub="Toggle a scope chip to grant or revoke it instantly.">
          {/* add member */}
          <div className="rounded-md p-4 mb-4" style={{ background: "var(--surface2)", border: "1px solid var(--line)" }}>
            <div className="flex items-center gap-2 mb-3">
              <UserPlus size={15} style={{ color: "var(--muted)" }} />
              <input
                value={newUser}
                onChange={e => setNewUser(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addMember()}
                placeholder="Meta user id"
                className="field py-2!"
              />
              <button onClick={addMember} disabled={!newUser.trim() || newScopes.size === 0} className="btn-light py-2! px-4! text-[13px] shrink-0">
                <Plus size={13} /> Grant
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_SCOPES.map(sc => {
                const on = newScopes.has(sc.key);
                return (
                  <ScopeChip key={sc.key} on={on} label={sc.label} desc={sc.desc}
                    onClick={() => setNewScopes(prev => { const n = new Set(prev); if (n.has(sc.key)) n.delete(sc.key); else n.add(sc.key); return n; })} />
                );
              })}
            </div>
          </div>

          {/* member rows */}
          {members.length === 0 ? (
            <EmptyRow>No staff yet — grant the first member above.</EmptyRow>
          ) : (
            <div>
              <div className="tbl-head grid grid-cols-[1fr_auto] items-center gap-2 px-5 py-3">
                <span className="text-[14px] font-bold">Member</span>
                <span className="text-[14px] font-bold">Scopes</span>
              </div>
              <div>
                {members.map(m => (
                  <div key={m.user_id} className="tbl-row grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium truncate">{m.username || m.user_id}</div>
                      {m.username && <div className="font-mono text-[12px] truncate" style={{ color: "var(--muted)" }}>{m.user_id}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {ALL_SCOPES.map(sc => {
                        const on = m.scopes.includes(sc.key);
                        return (
                          <ScopeChip key={sc.key} on={on} label={sc.label} desc={sc.desc}
                            onClick={() => editMemberScopes(m.user_id, on ? m.scopes.filter(x => x !== sc.key) : [...m.scopes, sc.key])} />
                        );
                      })}
                      <button onClick={() => removeMember(m.user_id)} title="Remove member"
                        className="p-1 rounded hover:opacity-80" style={{ color: "var(--red)" }}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Allocated stations */}
      <Section
        title="Allocated stations"
        sub={playersKnown
          ? `${viewStations.length} station${viewStations.length === 1 ? "" : "s"} · ${totalPlayers} player${totalPlayers === 1 ? "" : "s"} combined`
          : `${viewStations.length} station${viewStations.length === 1 ? "" : "s"} assigned to this fleet.`}
        right={isGlobalAdmin ? (
          <div className="flex items-center gap-2">
            <select
              value={allocPick}
              onChange={e => setAllocPick(e.target.value)}
              className="field w-auto! py-2! text-sm"
              aria-label="Allocate a station"
            >
              <option value="">Allocate a station…</option>
              {unallocated.map(s => <option key={s.station_id} value={s.station_id}>{s.station_name}</option>)}
            </select>
            <button onClick={allocate} disabled={!allocPick} className="btn-light py-2! px-4! text-[13px]">
              <Plus size={13} /> Allocate
            </button>
          </div>
        ) : undefined}
      >
        {viewStations.length === 0 ? (
          <EmptyRow>No stations allocated.</EmptyRow>
        ) : (
          <div>
            {viewStations.map(s => {
              const pc = stationPlayers(s);
              return (
                <div key={s.station_id} className="tbl-row flex items-center justify-between gap-3 px-5 py-3">
                  <button onClick={() => router.push(`/stations/${s.station_id}`)}
                    className="flex items-center gap-3 min-w-0 hover:opacity-80 text-left">
                    <FleetBadge fleet={fleet} size={32} />
                    <span className="text-[15px] truncate">{s.station_name}</span>
                  </button>
                  <span className="flex items-center gap-3 shrink-0">
                    {pc !== undefined && (
                      <span className="text-[14px] tabular" style={{ color: "var(--muted)" }}>
                        {pc} player{pc === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className={`status-sq ${s.online ? "on" : "off"}`}
                      style={{ width: 28, height: 28 }}
                      aria-label={s.online ? "Online" : "Offline"} />
                    {isGlobalAdmin && (
                      <button onClick={() => deallocate(s.station_id)} title="Deallocate station"
                        className="p-1 rounded hover:opacity-80" style={{ color: "var(--red)" }}>
                        <X size={14} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
