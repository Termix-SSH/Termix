import { authApi } from "@/main-axios";

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

export async function getOpenTabs(): Promise<OpenTabRecord[]> {
  const response = await authApi.get("/open-tabs");
  return response.data;
}

export async function syncOpenTabs(tabs: OpenTabSyncPayload[]): Promise<void> {
  await authApi.put("/open-tabs", { tabs });
}

export async function deleteOpenTab(instanceId: string): Promise<void> {
  await authApi.delete(`/open-tabs/${instanceId}`);
}

export async function patchOpenTab(
  instanceId: string,
  updates: Partial<
    Pick<OpenTabRecord, "label" | "tabOrder" | "backendSessionId">
  >,
): Promise<void> {
  await authApi.patch(`/open-tabs/${instanceId}`, updates);
}

export async function addOpenTab(tab: OpenTabUpsertPayload): Promise<void> {
  await authApi.post("/open-tabs", tab);
}

export async function getActiveSessions(): Promise<ActiveSessionInfo[]> {
  const response = await authApi.get("/open-tabs/active-sessions");
  return response.data;
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
}

export async function getUserPreferences(): Promise<UserPreferences> {
  const response = await authApi.get("/user-preferences");
  return response.data;
}

export async function saveUserPreferences(
  prefs: Partial<UserPreferences>,
): Promise<void> {
  await authApi.put("/user-preferences", prefs);
}
