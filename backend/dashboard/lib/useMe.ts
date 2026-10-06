"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type Me } from "./api";

let _cache: Me | null | undefined = undefined;
let _inflight: Promise<Me | null> | null = null;

export function hasPermission(me: Me | null, permission: string): boolean {
  if (!me) return false;
  if (me.is_global_admin) return true;
  const perms = me.permissions ?? [];
  return perms.includes("*") || perms.includes(permission);
}

export function hasStationAccess(me: Me | null, stationId: string | null | undefined): boolean {
  if (!me || !stationId) return false;
  if (me.is_global_admin) return true;
  const ids = me.station_ids ?? [];
  return ids.includes("*") || ids.includes(stationId);
}

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(_cache);
  const [loading, setLoading] = useState(_cache === undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    _inflight = api.me();
    const m = await _inflight.catch(() => null);
    _cache = m; _inflight = null;
    setMe(m); setLoading(false);
    return m;
  }, []);

  useEffect(() => {
    // State already reflects the module cache via initial values; only fetch when
    // nothing is cached yet. Async continuations only -- no synchronous setState.
    if (_cache !== undefined) return;
    let cancelled = false;
    const p = _inflight ?? (_inflight = api.me());
    p.then(m => {
      if (cancelled) return;
      _cache = m; _inflight = null;
      setMe(m); setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      _cache = null; _inflight = null;
      setMe(null); setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const m = me ?? null;
  const hasPermissionCb = useCallback((p: string) => hasPermission(m, p), [m]);
  const hasStationAccessCb = useCallback((id: string | null | undefined) => hasStationAccess(m, id), [m]);
  const canReadStation = useCallback((id: string | null | undefined) => hasStationAccess(m, id) && hasPermission(m, "stations:view"), [m]);
  const canManageStation = useCallback((id: string | null | undefined) => hasStationAccess(m, id) && hasPermission(m, "stations:manage"), [m]);
  const canLaunchStation = useCallback((id: string | null | undefined) => hasStationAccess(m, id) && hasPermission(m, "stations:launch"), [m]);

  // Fleet-level helpers: this deployment gates fleets by global admin only
  // (per-fleet scopes are enforced server-side per station). No fleet id needed.
  const fleetAdmin = useCallback(() => Boolean(m?.is_global_admin), [m]);
  return {
    me: m,
    loading,
    loggedIn: !!m,
    isGlobalAdmin: !!m?.is_global_admin,
    hasPermission: hasPermissionCb,
    hasStationAccess: hasStationAccessCb,
    canReadStation,
    canManageStation,
    canLaunchStation,
    // Kept so fleet pages keep working; fleet access == global admin here.
    canRead: fleetAdmin,
    canWrite: fleetAdmin,
    canLaunch: fleetAdmin,
    canManage: fleetAdmin,
    refresh,
  };
}

export function invalidateMe() { _cache = undefined; _inflight = null; }
