import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type {
  AlertItem,
  AlertRule,
  AlertsMeta,
  ChannelDetail,
  ChannelSummary,
  ChannelType,
  Severity,
} from "../types";

export interface ItemQuery {
  unread?: boolean;
  source?: string;
  severity?: Severity;
  limit?: number;
  before?: number;
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export type RuleInput = Omit<AlertRule, "id">;

function apiError(error: unknown, action: string): Error {
  const data = (
    error as { response?: { data?: { error?: string; message?: string } } }
  )?.response?.data;
  return new Error(
    data?.error ||
      data?.message ||
      (error instanceof Error ? error.message : `Failed to ${action}`),
  );
}

async function call<T>(
  action: string,
  request: () => Promise<{ data: T }>,
): Promise<T> {
  try {
    return (await request()).data;
  } catch (error) {
    throw apiError(error, action);
  }
}

function query(params: ItemQuery): string {
  const search = new URLSearchParams();
  if (params.unread) search.set("unread", "true");
  if (params.source) search.set("source", params.source);
  if (params.severity) search.set("severity", params.severity);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.before) search.set("before", String(params.before));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createAlertsApi(api: PluginApiClient) {
  return {
    items: (params: ItemQuery = {}) =>
      call<{ items: AlertItem[]; unread: number }>("load alerts", () =>
        api.get(`/items${query(params)}`),
      ),
    unread: () =>
      call<{ count: number }>("count alerts", () => api.get("/unread")),
    setRead: (ids: number[] | "all", read = true) =>
      call<{ count: number }>("update alerts", () =>
        api.post(
          "/items/read",
          ids === "all" ? { all: true, read } : { ids, read },
        ),
      ),
    remove: (id: number) =>
      call<{ success: boolean }>("delete alert", () =>
        api.delete(`/items/${id}`),
      ),
    clear: (onlyRead: boolean) =>
      call<{ removed: number }>("clear alerts", () =>
        api.delete(`/items${onlyRead ? "?read=true" : ""}`),
      ),
    categories: () =>
      call<Array<{ source: string; category: string }>>("load categories", () =>
        api.get("/categories"),
      ),
    meta: () => call<AlertsMeta>("load channel types", () => api.get("/meta")),
    channels: () =>
      call<ChannelSummary[]>("load channels", () => api.get("/channels")),
    channel: (id: number) =>
      call<ChannelDetail>("load channel", () => api.get(`/channels/${id}`)),
    createChannel: (input: ChannelInput) =>
      call<ChannelDetail>("create channel", () => api.post("/channels", input)),
    updateChannel: (id: number, input: Partial<ChannelInput>) =>
      call<ChannelDetail>("update channel", () =>
        api.put(`/channels/${id}`, input),
      ),
    deleteChannel: (id: number) =>
      call<{ success: boolean }>("delete channel", () =>
        api.delete(`/channels/${id}`),
      ),
    testChannel: async (id: number) => {
      const result = await call<{ success: boolean; error?: string }>(
        "test channel",
        () => api.post(`/channels/${id}/test`),
      );
      if (!result.success) throw new Error(result.error || "Test failed");
    },
    rules: () => call<AlertRule[]>("load rules", () => api.get("/rules")),
    createRule: (input: RuleInput) =>
      call<AlertRule>("create rule", () => api.post("/rules", input)),
    updateRule: (id: number, input: RuleInput) =>
      call<AlertRule>("update rule", () => api.put(`/rules/${id}`, input)),
    deleteRule: (id: number) =>
      call<{ success: boolean }>("delete rule", () =>
        api.delete(`/rules/${id}`),
      ),
  };
}

export type AlertsApi = ReturnType<typeof createAlertsApi>;
