"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type Ban, type Role, type Member, type User, type Station, type Deployment, type StationEvent, type EosSession } from "../../../lib/api";
import { useMe } from "../../../lib/useMe";
import { fmt, ago } from "../../../lib/utils";
import { EmptyRow, FleetIcon, NotFound } from "../../../components/ui";
import { SpinUpModal } from "../../../components/SpinUpModal";
import { DraftersTab, WhitelistTab, NetvarsTab, EditorLevelsTab } from "../../../components/StationAdvancedTabs";
import {
  ChevronLeft, Plus, Trash2, X, Shield,
  Rocket, Calendar, Radio,
} from "lucide-react";

type Tab = "bans" | "drafters" | "roles" | "members" | "deployments" | "sessions" | "netvars" | "levels" | "whitelist" | "events";

// ── Shared UI ────────────────────────────────────────────────────────────────

function Modal({ title, eyebrow, onClose, children }: {
  title: string; eyebrow?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-md p-6">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 className="text-[24px] font-medium mb-5">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>{label}</label>
      {children}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="card mb-4 px-5 py-3.5 text-[15px]" style={{ color: "var(--red)" }}>
      {msg}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-md px-4 py-3" style={{ background: "var(--surface2)", border: "1px solid var(--line)" }}>
      <div className="text-[12px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-[20px] font-medium tabular" style={{ color: accent ?? "var(--text)" }}>{value}</div>
    </div>
  );
}

function TableHead({ cols, headers }: { cols: string; headers: string[] }) {
  return (
    <div className="tbl-head grid items-center gap-2 px-5 py-3.5" style={{ gridTemplateColumns: cols }}>
      {headers.map(h => (
        <span key={h} className="text-[14px] font-bold">{h}</span>
      ))}
    </div>
  );
}

// ── Bans tab ─────────────────────────────────────────────────────────────────

function BansTab({ stationId, mayManage }: { stationId: string; mayManage: boolean }) {
  const [bans, setBans]       = useState<Ban[] | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(() => {
    api.stationBans(stationId).then(setBans).catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function revoke(userId: string) {
    setRevoking(userId);
    try { await api.unbanUser(userId, stationId); load(); }
    finally { setRevoking(null); }
  }

  const cols = "1.2fr 1.4fr 1fr auto";

  return (
    <div>
      {err && <ErrBox msg={err} />}
      <TableHead cols={cols} headers={["Player", "Reason", "Expires", ""]} />
      <div>
        {!bans ? (
          <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
        ) : bans.length === 0 ? (
          <EmptyRow>No active bans on this station.</EmptyRow>
        ) : bans.map(b => (
          <div key={b.user_id + b.reason} className="tbl-row grid items-center gap-2 px-5 py-3.5 text-[15px]" style={{ gridTemplateColumns: cols }}>
            <span className="font-medium truncate">{b.username}</span>
            <span className="text-sm truncate" style={{ color: "var(--muted)" }}>{b.reason || "—"}</span>
            <span className="text-sm tabular" style={{ color: b.expiration ? "var(--yellow)" : "var(--muted)" }}>
              {b.expiration ? fmt(b.expiration) : "Permanent"}
            </span>
            <span>
              {mayManage && (
                <button onClick={() => revoke(b.user_id)} disabled={revoking === b.user_id}
                  className="btn-dark py-1.5! px-3! text-[13px]">
                  {revoking === b.user_id ? "…" : "Revoke"}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Roles tab ────────────────────────────────────────────────────────────────

function RolesTab({ stationId, mayManage }: { stationId: string; mayManage: boolean }) {
  const [roles, setRoles]         = useState<Role[] | null>(null);
  const [err, setErr]             = useState<string | null>(null);
  const [creating, setCreating]   = useState(false);
  const [editPerms, setEditPerms] = useState<Role | null>(null);
  const [newName, setNewName]     = useState("");
  const [newDesc, setNewDesc]     = useState("");
  const [newPerms, setNewPerms]   = useState("");
  const [saving, setSaving]       = useState(false);

  const load = useCallback(() => {
    api.stationRoles(stationId).then(setRoles).catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.createRole(stationId, newName.trim(), newDesc.trim());
      setCreating(false); setNewName(""); setNewDesc("");
      load();
    } finally { setSaving(false); }
  }

  async function remove(roleId: string) {
    await api.deleteRole(stationId, roleId);
    load();
  }

  async function savePerms() {
    if (!editPerms) return;
    setSaving(true);
    try {
      const perms = newPerms.split(",").map(s => s.trim()).filter(Boolean);
      await api.setRolePermissions(stationId, editPerms.role_id, perms);
      setEditPerms(null);
      load();
    } finally { setSaving(false); }
  }

  return (
    <div>
      {err && <ErrBox msg={err} />}
      {mayManage && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setCreating(true)} className="btn-light py-2! px-4! text-[13px]">
            <Plus size={13} /> New Role
          </button>
        </div>
      )}

      {creating && (
        <Modal title="Create Role" eyebrow="Station staff" onClose={() => setCreating(false)}>
          <Field label="Name">
            <input className="field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Moderator" autoFocus />
          </Field>
          <Field label="Description (optional)">
            <input className="field" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Can manage bans" />
          </Field>
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={() => setCreating(false)} className="btn-dark text-sm">Cancel</button>
            <button onClick={create} disabled={saving || !newName.trim()} className="btn-light py-2.5! px-5! text-sm">Create</button>
          </div>
        </Modal>
      )}

      {editPerms && (
        <Modal title={editPerms.role_name} eyebrow="Permissions" onClose={() => setEditPerms(null)}>
          <Field label="Permissions (comma-separated)">
            <textarea className="field" style={{ resize: "vertical", minHeight: 80 }}
              value={newPerms} onChange={e => setNewPerms(e.target.value)}
              placeholder="ban_user, kick_user, manage_events" />
          </Field>
          <p className="text-[13px] mb-4 font-mono" style={{ color: "var(--muted)" }}>
            Current: {editPerms.permissions.join(", ") || "none"}
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditPerms(null)} className="btn-dark text-sm">Cancel</button>
            <button onClick={savePerms} disabled={saving} className="btn-light py-2.5! px-5! text-sm">Save</button>
          </div>
        </Modal>
      )}

      <div className="space-y-3">
        {!roles ? (
          <div className="card p-5"><div className="skeleton h-5 w-1/3" /></div>
        ) : roles.length === 0 ? (
          <div className="card"><EmptyRow>No roles yet{mayManage ? " — create one above." : "."}</EmptyRow></div>
        ) : roles.map(role => (
          <div key={role.role_id} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Shield size={14} style={{ color: "var(--link)" }} />
                  <span className="text-[16px] font-medium">{role.role_name}</span>
                  {role.role_description && (
                    <span className="text-[13px]" style={{ color: "var(--muted)" }}>— {role.role_description}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {role.permissions.length === 0 ? (
                    <span className="text-[13px]" style={{ color: "var(--muted)" }}>No permissions</span>
                  ) : role.permissions.map(p => (
                    <span key={p} className="font-mono text-[13px] px-2 py-0.5 rounded"
                      style={{ background: "var(--surface2)", color: "var(--link)" }}>{p}</span>
                  ))}
                </div>
              </div>
              {mayManage && (
                <div className="flex gap-2 shrink-0 items-center">
                  <button
                    onClick={() => { setEditPerms(role); setNewPerms(role.permissions.join(", ")); }}
                    className="btn-dark py-1.5! px-3! text-[13px]">
                    Permissions
                  </button>
                  <button onClick={() => remove(role.role_id)} title="Delete role"
                    className="p-1.5 rounded hover:opacity-80" style={{ color: "var(--muted)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Members tab ───────────────────────────────────────────────────────────────

function MembersTab({ stationId, mayManage }: { stationId: string; mayManage: boolean }) {
  const [members, setMembers]     = useState<Member[] | null>(null);
  const [roles, setRoles]         = useState<Role[]>([]);
  const [users, setUsers]         = useState<User[]>([]);
  const [err, setErr]             = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [selUser, setSelUser]     = useState("");
  const [selRole, setSelRole]     = useState("");
  const [saving, setSaving]       = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.stationMembers(stationId),
      api.stationRoles(stationId),
      api.users(),
    ]).then(([m, r, u]) => { setMembers(m); setRoles(r); setUsers(u); })
      .catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function assign() {
    if (!selUser || !selRole) return;
    setSaving(true);
    try {
      await api.assignRole(stationId, selUser, selRole);
      setAssigning(false); setSelUser(""); setSelRole("");
      load();
    } finally { setSaving(false); }
  }

  async function removeRole(userId: string, roleId: string) {
    await api.removeRole(stationId, userId, roleId);
    load();
  }

  const roleMap = Object.fromEntries(roles.map(r => [r.role_id, r.role_name]));
  const cols = "1fr 0.8fr 1.6fr";

  return (
    <div>
      {err && <ErrBox msg={err} />}
      {mayManage && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setAssigning(true)} className="btn-light py-2! px-4! text-[13px]">
            <Plus size={13} /> Assign Role
          </button>
        </div>
      )}

      {assigning && (
        <Modal title="Assign Role" eyebrow="Station staff" onClose={() => setAssigning(false)}>
          <Field label="User">
            <select className="field" value={selUser} onChange={e => setSelUser(e.target.value)}>
              <option value="">Select user…</option>
              {users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select className="field" value={selRole} onChange={e => setSelRole(e.target.value)}>
              <option value="">Select role…</option>
              {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
            </select>
          </Field>
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={() => setAssigning(false)} className="btn-dark text-sm">Cancel</button>
            <button onClick={assign} disabled={saving || !selUser || !selRole} className="btn-light py-2.5! px-5! text-sm">Assign</button>
          </div>
        </Modal>
      )}

      <TableHead cols={cols} headers={["Member", "Platform", "Roles"]} />
      <div>
        {!members ? (
          <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
        ) : members.length === 0 ? (
          <EmptyRow>No staff assigned to this station.</EmptyRow>
        ) : members.map(m => (
          <div key={m.user_id} className="tbl-row grid items-center gap-2 px-5 py-3.5 text-[15px]" style={{ gridTemplateColumns: cols }}>
            <span className="font-medium truncate">{m.username}</span>
            <span className="text-sm" style={{ color: "var(--muted)" }}>{m.platform ?? "—"}</span>
            <span className="flex flex-wrap gap-1.5">
              {m.roles.length === 0 && <span className="text-[13px]" style={{ color: "var(--muted)" }}>—</span>}
              {m.roles.map(rId => (
                <span key={rId} className="inline-flex items-center gap-1.5 font-mono text-[13px] px-2 py-0.5 rounded"
                  style={{ background: "var(--surface2)", color: "var(--link)" }}>
                  {roleMap[rId] ?? rId}
                  {mayManage && (
                    <button onClick={() => removeRole(m.user_id, rId)} title="Remove role"
                      className="hover:opacity-70" style={{ color: "var(--muted)" }}>
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Deployments tab ───────────────────────────────────────────────────────────

const DEFAULT_EOS_FORM = {
  server_name: "", ip_address: "", port: "", max_players: "10",
  bucket: "A2_4729", build_id: "4729", imgui_port: "",
};

const DEFAULT_BULK_FORM = {
  server_name: "OCE", ip_address: "127.0.0.1", base_port: "7777",
  count: "1", max_players: "10", bucket: "20996", build_id: "20996", imgui_port_base: "25108",
};

function DeploymentsTab({ stationId, mayLaunch, onStationChanged }: { stationId: string; mayLaunch: boolean; onStationChanged: () => void }) {
  const [deps, setDeps]           = useState<Deployment[] | null>(null);
  const [err, setErr]             = useState<string | null>(null);
  const [spinning, setSpinning]     = useState(false);
  const [spinResult, setSpinResult] = useState<string | null>(null);

  const [allocTarget, setAllocTarget] = useState<Deployment | null>(null);
  const [eosForm, setEosForm]         = useState(DEFAULT_EOS_FORM);
  const [allocSaving, setAllocSaving] = useState(false);
  const [allocErr, setAllocErr]       = useState<string | null>(null);

  const [bulkOpen, setBulkOpen]     = useState(false);
  const [bulkForm, setBulkForm]     = useState(DEFAULT_BULK_FORM);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkErr, setBulkErr]       = useState<string | null>(null);
  const [bulkDone, setBulkDone]     = useState<number | null>(null);

  const load = useCallback(() => {
    api.stationDeployments(stationId).then(setDeps).catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  function onSpinDone(msg: string) {
    setSpinning(false);
    setSpinResult(msg);
    onStationChanged();
    setTimeout(load, 8000);
  }

  function openAlloc(dep: Deployment) {
    setEosForm({
      server_name: dep.deployment_name ?? "",
      ip_address:  dep.ip_address ?? "",
      port:        "",
      max_players: "10",
      bucket:      "A2_4729",
      build_id:    "4729",
      imgui_port:  "",
    });
    setAllocErr(null);
    setAllocTarget(dep);
  }

  async function bulkLaunch() {
    setBulkSaving(true);
    setBulkErr(null);
    try {
      const results = await api.bulkAddSessions(stationId, parseInt(bulkForm.count, 10) || 1, {
        server_name:    bulkForm.server_name,
        ip_address:     bulkForm.ip_address,
        base_port:      parseInt(bulkForm.base_port, 10) || 7777,
        max_players:    parseInt(bulkForm.max_players, 10) || 10,
        bucket:         bulkForm.bucket,
        build_id:       parseInt(bulkForm.build_id, 10) || 20996,
        imgui_port_base: parseInt(bulkForm.imgui_port_base, 10) || 0,
      });
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        setBulkErr(`${failed.length} session(s) failed to create`);
      } else {
        setBulkDone(results.length);
        setBulkOpen(false);
        setBulkForm(DEFAULT_BULK_FORM);
      }
    } catch (e: unknown) {
      setBulkErr(e instanceof Error ? e.message : "error");
    } finally { setBulkSaving(false); }
  }

  async function allocate() {
    if (!allocTarget) return;
    setAllocSaving(true);
    setAllocErr(null);
    try {
      const res = await api.addSession({
        server_name:   eosForm.server_name,
        ip_address:    eosForm.ip_address,
        port:          eosForm.port,
        max_players:   parseInt(eosForm.max_players, 10) || 10,
        bucket:        eosForm.bucket,
        build_id:      parseInt(eosForm.build_id, 10) || 4729,
        imgui_port:    eosForm.imgui_port,
        station_id:    stationId,
        deployment_id: allocTarget.deployment_id,
      });
      if (res.success) { setAllocTarget(null); }
      else setAllocErr(res.error ?? "Failed to allocate session");
    } catch (e: unknown) {
      setAllocErr(e instanceof Error ? e.message : "error");
    } finally { setAllocSaving(false); }
  }

  const cols = "1.4fr 1fr 0.8fr 0.7fr 0.6fr 1fr auto";

  return (
    <div>
      {err && <ErrBox msg={err} />}
      {mayLaunch && (
        <div className="flex justify-end gap-2 mb-4">
          <button onClick={() => { setBulkErr(null); setBulkDone(null); setBulkOpen(true); }} className="btn-dark py-2! text-[13px]">
            <Radio size={13} /> Bulk EOS Sessions
          </button>
          <button
            onClick={() => { setSpinResult(null); setSpinning(true); }}
            className="btn-light py-2! px-4! text-[13px]">
            <Rocket size={13} /> Spin Up Server
          </button>
        </div>
      )}

      {bulkDone !== null && (
        <div className="card mb-4 px-5 py-3.5 text-[15px]" style={{ color: "var(--green)" }}>
          {bulkDone} EOS session{bulkDone !== 1 ? "s" : ""} launched successfully.
          <button className="ml-3 text-[13px] underline" style={{ color: "var(--muted)" }} onClick={() => setBulkDone(null)}>dismiss</button>
        </div>
      )}

      {bulkOpen && (
        <Modal title="Bulk Launch EOS Sessions" eyebrow="Matchmaking" onClose={() => setBulkOpen(false)}>
          <p className="text-[13px] mb-4" style={{ color: "var(--muted)" }}>
            Creates N EOS matchmaking sessions with ports starting from the base port.
            Server names will be suffixed _1, _2, …
          </p>
          {bulkErr && <ErrBox msg={bulkErr} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Session Count">
              <input type="number" min="1" max="50" className="field"
                value={bulkForm.count} onChange={e => setBulkForm(f => ({ ...f, count: e.target.value }))} />
            </Field>
            <Field label="Base Port">
              <input type="number" className="field"
                value={bulkForm.base_port} onChange={e => setBulkForm(f => ({ ...f, base_port: e.target.value }))} />
            </Field>
          </div>
          <Field label="Server Name Prefix">
            <input className="field"
              value={bulkForm.server_name} onChange={e => setBulkForm(f => ({ ...f, server_name: e.target.value }))}
              placeholder="OCE" />
          </Field>
          <Field label="IP Address">
            <input className="field"
              value={bulkForm.ip_address} onChange={e => setBulkForm(f => ({ ...f, ip_address: e.target.value }))}
              placeholder="127.0.0.1" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket">
              <input className="field"
                value={bulkForm.bucket} onChange={e => setBulkForm(f => ({ ...f, bucket: e.target.value }))} />
            </Field>
            <Field label="Build ID">
              <input type="number" className="field"
                value={bulkForm.build_id} onChange={e => setBulkForm(f => ({ ...f, build_id: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max Players">
              <input type="number" className="field"
                value={bulkForm.max_players} onChange={e => setBulkForm(f => ({ ...f, max_players: e.target.value }))} />
            </Field>
            <Field label="IMGUI Base Port">
              <input type="number" className="field"
                value={bulkForm.imgui_port_base} onChange={e => setBulkForm(f => ({ ...f, imgui_port_base: e.target.value }))}
                placeholder="25108 (0 to skip)" />
            </Field>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={() => setBulkOpen(false)} className="btn-dark text-sm">Cancel</button>
            <button onClick={bulkLaunch} disabled={bulkSaving || !bulkForm.server_name || !bulkForm.ip_address} className="btn-light py-2.5! px-5! text-sm">
              {bulkSaving ? "Launching…" : "Launch Sessions"}
            </button>
          </div>
        </Modal>
      )}

      {spinning && (
        <SpinUpModal
          initialStationId={stationId}
          lockStation
          onClose={() => setSpinning(false)}
          onDone={onSpinDone}
        />
      )}

      {spinResult && (
        <div className="card mb-4 px-5 py-3.5 text-[15px]" style={{ color: "var(--green)" }}>
          {spinResult}
          <button className="ml-3 text-[13px] underline" style={{ color: "var(--muted)" }} onClick={() => setSpinResult(null)}>dismiss</button>
        </div>
      )}

      {allocTarget && (
        <Modal title="Allocate to EOS Matchmaking" eyebrow="Matchmaking" onClose={() => setAllocTarget(null)}>
          <p className="text-[13px] mb-4" style={{ color: "var(--muted)" }}>
            This creates an EOS session that players can discover via matchmaking.
          </p>
          {allocErr && <ErrBox msg={allocErr} />}
          <Field label="Server Name">
            <input className="field"
              value={eosForm.server_name} onChange={e => setEosForm(f => ({ ...f, server_name: e.target.value }))}
              placeholder="OCE_1" />
          </Field>
          <Field label="IP Address">
            <input className="field"
              value={eosForm.ip_address} onChange={e => setEosForm(f => ({ ...f, ip_address: e.target.value }))}
              placeholder="203.0.113.10" />
          </Field>
          <Field label="Port">
            <input className="field"
              value={eosForm.port} onChange={e => setEosForm(f => ({ ...f, port: e.target.value }))}
              placeholder="7777" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max Players">
              <input type="number" className="field"
                value={eosForm.max_players} onChange={e => setEosForm(f => ({ ...f, max_players: e.target.value }))} />
            </Field>
            <Field label="Build ID">
              <input type="number" className="field"
                value={eosForm.build_id} onChange={e => setEosForm(f => ({ ...f, build_id: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket">
              <input className="field"
                value={eosForm.bucket} onChange={e => setEosForm(f => ({ ...f, bucket: e.target.value }))} />
            </Field>
            <Field label="IMGUI Port">
              <input className="field"
                value={eosForm.imgui_port} onChange={e => setEosForm(f => ({ ...f, imgui_port: e.target.value }))}
                placeholder="25108" />
            </Field>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={() => setAllocTarget(null)} className="btn-dark text-sm">Cancel</button>
            <button onClick={allocate} disabled={allocSaving || !eosForm.ip_address || !eosForm.port} className="btn-light py-2.5! px-5! text-sm">
              {allocSaving ? "Allocating…" : "Allocate"}
            </button>
          </div>
        </Modal>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <TableHead cols={cols} headers={["Deployment", "IP", "Region", "Status", "Players", "Created", ""]} />
          <div>
            {!deps ? (
              <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
            ) : deps.length === 0 ? (
              <EmptyRow>No deployments{mayLaunch ? " — spin one up above." : "."}</EmptyRow>
            ) : deps.map(d => (
              <div key={d.deployment_id} className="tbl-row grid items-center gap-2 px-5 py-3.5 text-[15px]" style={{ gridTemplateColumns: cols }}>
                <span className="font-medium truncate">{d.deployment_name ?? "—"}</span>
                <span className="font-mono text-[13px] truncate" style={{ color: "var(--muted)" }}>{d.ip_address ?? "—"}</span>
                <span className="text-sm" style={{ color: "var(--muted)" }}>{d.region ?? "—"}</span>
                <span>
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.14em] px-2 py-0.5"
                    style={{
                      color: d.online ? "var(--green)" : "var(--muted)",
                      background: d.online ? "rgba(139,212,80,0.1)" : "rgba(255,255,255,0.04)",
                      boxShadow: d.online ? "inset 0 0 0 1px rgba(139,212,80,0.35)" : "inset 0 0 0 1px var(--line)",
                      borderRadius: 3,
                    }}>
                    {d.online ? "Online" : "Offline"}
                  </span>
                </span>
                <span className="tabular text-center" style={{ color: "var(--link)" }}>{d.player_count}</span>
                <span className="text-[13px] tabular" style={{ color: "var(--muted)" }}>{fmt(d.created_at)}</span>
                <span className="text-right">
                  {mayLaunch && (
                    <button onClick={() => openAlloc(d)} className="btn-dark py-1.5! px-3! text-[13px]">
                      <Radio size={12} /> EOS
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

function EventsTab({ stationId, mayWrite }: { stationId: string; mayWrite: boolean }) {
  const [events, setEvents]   = useState<StationEvent[] | null>(null);
  const [deps, setDeps]       = useState<Deployment[]>([]);
  const [err, setErr]         = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({
    title: "", description: "", start_time: "", duration: "3600",
    deployment_id: "", public: true, signups_open: true,
  });

  const load = useCallback(() => {
    Promise.all([api.stationEvents(stationId), api.stationDeployments(stationId)])
      .then(([ev, d]) => { setEvents(ev); setDeps(d); })
      .catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.createEvent(stationId, {
        title:         form.title,
        description:   form.description,
        start_time:    form.start_time || new Date().toISOString(),
        duration:      parseInt(form.duration, 10) || 3600,
        deployment_id: form.deployment_id || undefined,
        public:        form.public,
        signups_open:  form.signups_open,
      });
      setCreating(false);
      setForm({ title: "", description: "", start_time: "", duration: "3600", deployment_id: "", public: true, signups_open: true });
      load();
    } finally { setSaving(false); }
  }

  async function remove(eventId: string) {
    await api.deleteEvent(stationId, eventId);
    load();
  }

  const cols = "1.4fr 1fr 0.7fr 0.6fr 0.7fr auto";

  return (
    <div>
      {err && <ErrBox msg={err} />}
      {mayWrite && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setCreating(true)} className="btn-light py-2! px-4! text-[13px]">
            <Calendar size={13} /> Create Event
          </button>
        </div>
      )}

      {creating && (
        <Modal title="Create Event" eyebrow="Station events" onClose={() => setCreating(false)}>
          <Field label="Title">
            <input className="field" autoFocus
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Weekly Tournament" />
          </Field>
          <Field label="Description">
            <textarea className="field" style={{ resize: "vertical", minHeight: 60 }}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Start Time">
            <input type="datetime-local" className="field"
              value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
          </Field>
          <Field label="Duration (seconds)">
            <input type="number" className="field"
              value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} />
          </Field>
          {deps.length > 0 && (
            <Field label="Deployment (optional)">
              <select className="field"
                value={form.deployment_id} onChange={e => setForm(f => ({ ...f, deployment_id: e.target.value }))}>
                <option value="">None</option>
                {deps.map(d => <option key={d.deployment_id} value={d.deployment_id}>{d.deployment_name ?? d.deployment_id.slice(0, 8)}</option>)}
              </select>
            </Field>
          )}
          <div className="flex gap-5 mb-5 text-sm">
            <label className="flex items-center gap-2 cursor-pointer" style={{ color: "var(--muted)" }}>
              <input type="checkbox" checked={form.public} onChange={e => setForm(f => ({ ...f, public: e.target.checked }))} />
              Public
            </label>
            <label className="flex items-center gap-2 cursor-pointer" style={{ color: "var(--muted)" }}>
              <input type="checkbox" checked={form.signups_open} onChange={e => setForm(f => ({ ...f, signups_open: e.target.checked }))} />
              Signups open
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCreating(false)} className="btn-dark text-sm">Cancel</button>
            <button onClick={create} disabled={saving || !form.title.trim()} className="btn-light py-2.5! px-5! text-sm">Create</button>
          </div>
        </Modal>
      )}

      <TableHead cols={cols} headers={["Title", "Start", "Duration", "Public", "Signups", ""]} />
      <div>
        {!events ? (
          <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
        ) : events.length === 0 ? (
          <EmptyRow>No events scheduled{mayWrite ? " — create one above." : "."}</EmptyRow>
        ) : events.map(e => (
          <div key={e.event_id} className="tbl-row grid items-center gap-2 px-5 py-3.5 text-[15px]" style={{ gridTemplateColumns: cols }}>
            <span className="font-medium truncate">{e.title}</span>
            <span className="text-[13px] tabular" style={{ color: "var(--muted)" }}>{fmt(e.start_time)}</span>
            <span className="text-sm tabular" style={{ color: "var(--muted)" }}>
              {e.duration >= 3600 ? `${e.duration / 3600}h` : `${e.duration / 60}m`}
            </span>
            <span className="text-sm" style={{ color: e.public ? "var(--green)" : "var(--muted)" }}>
              {e.public ? "Yes" : "No"}
            </span>
            <span className="text-sm" style={{ color: e.signups_open ? "var(--green)" : "var(--muted)" }}>
              {e.signups_open ? "Open" : "Closed"}
            </span>
            <span className="text-right">
              {mayWrite && (
                <button onClick={() => remove(e.event_id)} title="Delete event"
                  className="p-1.5 rounded hover:opacity-80" style={{ color: "var(--muted)" }}>
                  <Trash2 size={14} />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({ stationId }: { stationId: string }) {
  const [sessions, setSessions] = useState<EosSession[] | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sessions()
      .then(all => setSessions(all.filter(s => s.station_id === stationId)))
      .catch(e => setErr(e.message));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    setRemoving(id);
    try { await api.removeSession(id); load(); }
    finally { setRemoving(null); }
  }

  const cols = "1fr 1fr 1fr 0.6fr 0.6fr 0.8fr auto";

  return (
    <div>
      {err && <ErrBox msg={err} />}
      <p className="text-[13px] mb-4" style={{ color: "var(--muted)" }}>
        Active EOS matchmaking sessions for this station. Allocate new sessions from the Deployments tab.
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <TableHead cols={cols} headers={["Session", "Server", "IP", "Port", "Max", "Bucket", ""]} />
          <div>
            {!sessions ? (
              <div className="tbl-row px-5 py-8"><div className="skeleton h-5 w-1/3" /></div>
            ) : sessions.length === 0 ? (
              <EmptyRow>No active EOS sessions — allocate one from the Deployments tab.</EmptyRow>
            ) : sessions.map(s => (
              <div key={s.id} className="tbl-row grid items-center gap-2 px-5 py-3.5 text-[15px]" style={{ gridTemplateColumns: cols }}>
                <span className="font-mono text-[13px] truncate" style={{ color: "var(--muted)" }}>{s.id}</span>
                <span className="font-medium truncate">{s.server_name || "—"}</span>
                <span className="font-mono text-[13px] truncate" style={{ color: "var(--muted)" }}>{s.ip_address || "—"}</span>
                <span className="text-sm tabular" style={{ color: "var(--muted)" }}>{s.port || "—"}</span>
                <span className="tabular text-center" style={{ color: "var(--link)" }}>{s.max_players}</span>
                <span className="text-sm" style={{ color: "var(--muted)" }}>{s.bucket}</span>
                <span className="text-right">
                  <button onClick={() => remove(s.id)} disabled={removing === s.id} title="Remove session"
                    className="p-1.5 rounded hover:opacity-80"
                    style={{ color: "var(--muted)", opacity: removing === s.id ? 0.4 : 1 }}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "bans",        label: "Bans" },
  { id: "drafters",    label: "Drafters" },
  { id: "roles",       label: "Roles" },
  { id: "members",     label: "Members" },
  { id: "deployments", label: "Deployments" },
  { id: "sessions",    label: "EOS Sessions" },
  { id: "netvars",     label: "Netvars" },
  { id: "levels",      label: "Editor levels" },
  { id: "whitelist",   label: "Whitelist" },
  { id: "events",      label: "Events" },
];

export default function StationDetailPage() {
  const params = useParams<{ id: string }>();
  const stationId = params.id;
  const router = useRouter();
  const { isGlobalAdmin, canReadStation, canLaunchStation, canManageStation, hasStationAccess, hasPermission, loading: meLoading, loggedIn } = useMe();
  const [tab, setTab] = useState<Tab>("bans");
  const [station, setStation] = useState<Station | null>(null);
  const [stationLoaded, setStationLoaded] = useState(false);

  const loadStation = useCallback(() => {
    api.stations().then(list => setStation(list.find(s => s.station_id === stationId) ?? null))
      .catch(() => setStation(null)).finally(() => setStationLoaded(true));
  }, [stationId]);
  useEffect(() => { loadStation(); }, [loadStation]);

  if (!stationLoaded || meLoading) {
    return <div className="mx-auto max-w-[1100px] pt-8 pb-14"><div className="card"><EmptyRow>Loading station…</EmptyRow></div></div>;
  }
  if (!loggedIn) return <NotFound eyebrow="Logged out" title="Log in" message="Log in to open this station." actionLabel="Log in" actionHref="/login" />;
  if (!station) return <NotFound />;
  if (!canReadStation(stationId)) return <NotFound eyebrow="Access denied" title="No edit access" message={`You don’t have access to edit ${station.station_name}. Ask the master admin to add this station to your key.`} actionLabel="Back to stations" actionHref="/" />;

  const mayLaunch = isGlobalAdmin || canLaunchStation(stationId);
  const mayManage = isGlobalAdmin || canManageStation(stationId);
  const mayModerate = isGlobalAdmin || (hasStationAccess(stationId) && hasPermission("users:ban"));
  const mayWrite = mayManage;
  const mayGlobalLevels = isGlobalAdmin || hasPermission("global:levels");
  const mayGlobalNetvars = isGlobalAdmin || hasPermission("global:netvars");
  const visibleTabs = TABS.filter(t => {
    if (t.id === "levels") return mayGlobalLevels;
    if (t.id === "sessions") return isGlobalAdmin;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1100px] pt-8 pb-14">
      <div className="flex items-center gap-2 mb-5 text-[15px]" style={{ color: "var(--muted)" }}>
        <button onClick={() => router.push("/")} className="flex items-center gap-1.5 hover:opacity-80"><ChevronLeft size={16}/> Home</button>
        <span>/</span><span style={{ color: "var(--text)" }}>{station.station_name}</span>
      </div>

      <div className="card px-6 py-5 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <FleetIcon name={station.station_name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[28px] leading-tight font-medium tracking-tight truncate">{station.station_name}</h1>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1" style={{ color: station.online ? "var(--green)" : "var(--muted)", background: station.online ? "rgba(139,212,80,0.1)" : "rgba(255,255,255,0.04)", boxShadow: station.online ? "inset 0 0 0 1px rgba(139,212,80,0.35)" : "inset 0 0 0 1px var(--line)", borderRadius: 3 }}>{station.online ? "Online" : "Offline"}</span>
            </div>
            <div className="font-mono text-[13px] mt-1" style={{ color: "var(--muted)" }}>{stationId}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <StatTile label="Deployments" value={station.deployments} />
          <StatTile label="Online" value={station.online_deps} accent="var(--green)" />
          <StatTile label="Players" value={station.player_count} accent="var(--link)" />
          <StatTile label="Last seen" value={ago(station.last_online)} />
        </div>
      </div>

      <div className="card rounded-lg! flex gap-1 p-1.5 mb-4 w-fit max-w-full overflow-x-auto">
        {visibleTabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className="px-4 py-2 rounded-md text-sm whitespace-nowrap transition-colors" style={{ background: tab===t.id ? "rgba(255,255,255,0.07)" : "transparent", color: tab===t.id ? "var(--text)" : "var(--muted)", fontWeight: tab===t.id ? 500 : 400 }}>{t.label}</button>)}
      </div>

      {tab === "bans" && <BansTab stationId={stationId} mayManage={mayModerate} />}
      {tab === "drafters" && <DraftersTab stationId={stationId} mayManage={mayManage} />}
      {tab === "roles" && <RolesTab stationId={stationId} mayManage={mayManage} />}
      {tab === "members" && <MembersTab stationId={stationId} mayManage={mayManage} />}
      {tab === "deployments" && <DeploymentsTab stationId={stationId} mayLaunch={mayLaunch} onStationChanged={loadStation} />}
      {tab === "sessions" && isGlobalAdmin && <SessionsTab stationId={stationId} />}
      {tab === "netvars" && <NetvarsTab stationId={stationId} mayWrite={mayWrite} mayViewGlobalDumps={mayGlobalNetvars} />}
      {tab === "levels" && mayGlobalLevels && <EditorLevelsTab mayWrite={mayGlobalLevels} />}
      {tab === "whitelist" && <WhitelistTab stationId={stationId} mayManage={mayManage} />}
      {tab === "events" && <EventsTab stationId={stationId} mayWrite={mayManage} />}
    </div>
  );
}
