"use client";

import Link from "next/link";
import { useMe } from "../../lib/useMe";
import { Avatar, SectionTitle } from "../../components/ui";

export default function AccountPage() {
  const { me, loggedIn, loading, isGlobalAdmin } = useMe();
  if (loading) return <div className="mx-auto max-w-[900px] pt-10"><div className="skeleton h-6 w-48"/></div>;
  if (!loggedIn || !me) return <div className="mx-auto max-w-[900px] pt-20"><p>Please <Link href="/login" className="link-blue">login</Link>.</p></div>;

  return <div className="mx-auto max-w-[1000px] pt-8 pb-14">
    <SectionTitle>Account</SectionTitle>
    <div className="card p-8 mt-5">
      <div className="flex items-center gap-5"><Avatar size={88}/><div><h1 className="text-3xl font-medium">{me.operator_label ?? me.user_id}</h1><p className="font-mono text-xs mt-2" style={{color:"var(--muted)"}}>Key ID: {me.key_id ?? "—"}</p><span className="inline-block mt-3 px-2 py-1 rounded text-xs" style={{background:isGlobalAdmin?"#1a3a2a":"#223047",color:isGlobalAdmin?"var(--green)":"var(--link)"}}>{isGlobalAdmin?"MASTER":"SCOPED OPERATOR"}</span></div></div>
    </div>

    <div className="grid md:grid-cols-2 gap-4 mt-5">
      <div className="card p-5"><p className="eyebrow mb-3">Permissions</p>{isGlobalAdmin?<p>Full dashboard access</p>:<div className="flex flex-wrap gap-2">{(me.permissions??[]).map(p=><span key={p} className="font-mono text-xs px-2 py-1 rounded" style={{background:"var(--surface2)",color:"var(--link)"}}>{p}</span>)}</div>}</div>
      <div className="card p-5"><p className="eyebrow mb-3">Station scope</p>{isGlobalAdmin?<p>All stations</p>:<div className="space-y-1">{(me.station_ids??[]).map(id=><div key={id} className="font-mono text-xs" style={{color:"var(--muted)"}}>{id}</div>)}</div>}</div>
    </div>
    {isGlobalAdmin && <div className="mt-5"><Link href="/operators" className="btn-light">Manage scoped keys</Link></div>}
  </div>;
}
