"use client";

import { useState } from "react";
import Image from "next/image";
import { api } from "../../lib/api";
import { invalidateMe } from "../../lib/useMe";
import { KeyRound } from "lucide-react";

export default function LoginPage() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!key.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.login(key.trim());
      if (res.success) {
        invalidateMe();
        // Force a full navigation so the new HttpOnly session cookie is observed
        // immediately. This also avoids stale client/router cache behavior that
        // made login appear to work only with DevTools open.
        window.location.replace("/");
      } else {
        setErr(res.error || "That key didn't work. Check it and try again.");
      }
    } catch {
      setErr("Couldn't reach the backend. Try again in a bit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6">
      <div className="max-w-sm mx-auto pt-24 pb-20">
        <div className="card p-8">
          <div className="flex flex-col items-center gap-3 mb-6 text-center">
            <Image src="/logo.webp" alt="Orion Copy Server logo" width={56} height={56} style={{ borderRadius: 12 }} />
            <div>
              <p className="eyebrow mb-1.5">Orion Copy Server</p>
              <h1 className="text-[28px] font-medium tracking-tight">Log in</h1>
              <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Use your operator key.</p>
            </div>
          </div>

          <label className="block text-sm mb-1.5" style={{ color: "var(--muted)" }}>Operator key</label>
          <div className="field flex items-center gap-2 mb-4 !py-2.5">
            <KeyRound size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
            {/* No name= on purpose: keeps password managers from storing
                the operator key, which is session-scoped by design. */}
            <input autoFocus type="password" value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="op_…"
              autoComplete="current-password"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text)" }} />
          </div>

          {err && (
            <div className="card mb-4 px-4 py-3 text-sm" style={{ color: "var(--red)" }}>{err}</div>
          )}

          <button onClick={submit} disabled={busy || !key.trim()} className="btn-light w-full !py-3 text-sm justify-center">
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            No key? Ask an Orion Copy Server admin to issue one.
          </p>
        </div>
      </div>
    </div>
  );
}
