import { useCallback, useEffect, useState } from "react";
import { matchesPermission } from "@/lib/permissions";

export interface PermissionsState {
  permissions: string[];
  isAdmin: boolean;
  /** False until the call answers, so gated UI does not flash in or out. */
  loaded: boolean;
  has: (permission: string) => boolean;
}

/** Fired when a user's grants may have changed, so every surface re-reads them. */
const PERMISSIONS_CHANGED_EVENT = "permissionsChanged";

interface CachedPermissions {
  permissions: string[];
  isAdmin: boolean;
}

/**
 * Shared across every hook instance. A terminal per split pane would otherwise
 * fire one identical request each.
 */
let cache: CachedPermissions | null = null;
let inFlight: Promise<CachedPermissions> | null = null;

function load(): Promise<CachedPermissions> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = import("@/api/rbac-api")
    .then(({ getMyPermissions }) => getMyPermissions())
    .then((result) => {
      cache = {
        permissions: result.permissions ?? [],
        isAdmin: !!result.isAdmin,
      };
      return cache;
    })
    .catch(() => {
      // Deny by default. A failed lookup hides gated UI rather than showing
      // something the server would refuse anyway.
      cache = { permissions: [], isAdmin: false };
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** The same answer usePermissions().has gives, for code outside a component. */
export async function hasPermission(permission: string): Promise<boolean> {
  const { permissions, isAdmin } = await load();
  return matchesPermission(permissions, isAdmin, permission);
}

/**
 * Warms the permissions cache before the shell mounts, so permission-gated
 * rail items are already known on first paint instead of popping in once
 * usePermissions' own fetch resolves.
 */
export function preloadPermissions(): Promise<void> {
  return load().then(() => undefined);
}

export function notifyPermissionsChanged(): void {
  cache = null;
  window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT));
}

/**
 * The current user's grants.
 *
 * Freshness is eventually consistent: the backend caches per user with a TTL
 * and this caches until notifyPermissionsChanged fires, so a revoke can leave
 * a stale button on screen briefly. That is acceptable because the button is
 * not the boundary - clicking it hits a route that checks again and refuses.
 */
export function usePermissions(): PermissionsState {
  const [state, setState] = useState<CachedPermissions & { loaded: boolean }>(
    () =>
      cache
        ? { ...cache, loaded: true }
        : { permissions: [], isAdmin: false, loaded: false },
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      load().then((result) => {
        if (!cancelled) setState({ ...result, loaded: true });
      });
    };

    refresh();
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, refresh);
    };
  }, []);

  const has = useCallback(
    (permission: string) =>
      matchesPermission(state.permissions, state.isAdmin, permission),
    [state.permissions, state.isAdmin],
  );

  return { ...state, has };
}

/** Test seam. */
export function resetPermissionsCache(): void {
  cache = null;
  inFlight = null;
}

/** Test seam: answers every hook with these grants, no request made. */
export function setPermissionsForTesting(
  permissions: string[],
  isAdmin = false,
): void {
  cache = { permissions, isAdmin };
  inFlight = null;
  window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT));
}
