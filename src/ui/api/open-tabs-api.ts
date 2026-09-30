import { authApi } from "@/main-axios";
import { createTtlRequestCache } from "@/lib/ttl-request-cache";
import type { CustomKeybinding } from "@/types/keybindings";

// OPEN TABS API
// ============================================================================

export interface OpenTabRecord {
  id: string;
  userId: string;
  tabType: string;
  hostId: number | null;
  label: string;
  tabOrder: number;
  backendSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenTabSyncPayload {
  id: string;
  tabType: string;
  hostId?: number | null;
  label: string;
  tabOrder: number;
  backendSessionId?: string | null;
}

export interface OpenTabUpsertPayload {
  id: string;
  tabType: string;
  hostId?: number | null;
  label: string;
  tabOrder: number;
  backendSessionId?: string | null;
}

export interface ActiveSessionInfo {
  sessionId: string;
  hostId: number;
  hostName: string;
  tabInstanceId: string | null;
  isConnected: boolean;
  createdAt: number;
}

// Negative IDs identify remote-only shared hosts, absent from the local DB.
function hasPersistableHostId(tab: { hostId?: number | null }): boolean {
  return tab.hostId == null || (Number.isInteger(tab.hostId) && tab.hostId > 0);
}

const activeSessionsCache = createTtlRequestCache<ActiveSessionInfo[]>(2_000);

export async function getOpenTabs(): Promise<OpenTabRecord[]> {
  const response = await authApi.get("/open-tabs");
  return response.data;
}

export async function syncOpenTabs(tabs: OpenTabSyncPayload[]): Promise<void> {
  await authApi.put("/open-tabs", { tabs: tabs.filter(hasPersistableHostId) });
}

export async function deleteOpenTab(instanceId: string): Promise<void> {
  await authApi.delete(`/open-tabs/${instanceId}`);
}

export async function patchOpenTab(
  instanceId: string,
  updates: Partial<
    Pick<OpenTabRecord, "hostId" | "label" | "tabOrder" | "backendSessionId">
  >,
): Promise<void> {
  if (!hasPersistableHostId(updates)) return;
  await authApi.patch(`/open-tabs/${instanceId}`, updates);
}

export async function addOpenTab(tab: OpenTabUpsertPayload): Promise<void> {
  if (!hasPersistableHostId(tab)) return;
  await authApi.post("/open-tabs", tab);
}

/** The caller's own live sessions. */
export async function getActiveSessions(): Promise<ActiveSessionInfo[]> {
  return activeSessionsCache.get(async () => {
    const response = await authApi.get("/open-tabs/active-sessions");
    return Array.isArray(response.data) ? response.data : [];
  });
}

/** How long a detached terminal session is kept, in minutes. */
export async function getSessionTimeoutMinutes(): Promise<number> {
  const response = await authApi.get("/open-tabs/session-timeout");
  return Number(response.data?.minutes) || 30;
}

// ============================================================================
// USER PREFERENCES API
// ============================================================================

export interface UserPreferences {
  reopenTabsOnLogin: boolean;
  theme?: string | null;
  fontSize?: string | null;
  accentColor?: string | null;
  language?: string | null;
  storageMode?: string | null;
  commandPaletteEnabled?: boolean | null;
  showHostTags?: boolean | null;
  hostTrayOnClick?: boolean | null;
  pinAppRail?: boolean | null;
  expandAppRailOnHover?: boolean | null;
  showPinAppRailButton?: boolean | null;
  disableUpdateCheck?: boolean | null;
  confirmTabClose?: boolean | null;
  hiddenRailTabs?: string | null;
  compactHostView?: boolean | null;
  statusColorScheme?: string | null;
  customKeybindings?: string | null;
}

export function parseCustomKeybindings(
  raw?: string | null,
): CustomKeybinding[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const userPreferencesCache = createTtlRequestCache<UserPreferences>(10_000);

/**
 * Cached briefly so the loading gate's prefetch and the shell's own read on
 * mount share one request instead of two, which is what let stale
 * localStorage flags (hiddenRailTabs, pinAppRail) flash before the real
 * values landed a moment after the shell first rendered.
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  return userPreferencesCache.get(async () => {
    const response = await authApi.get("/user-preferences");
    return response.data;
  });
}

export async function saveUserPreferences(
  prefs: Partial<UserPreferences>,
): Promise<void> {
  await authApi.put("/user-preferences", prefs);
}
