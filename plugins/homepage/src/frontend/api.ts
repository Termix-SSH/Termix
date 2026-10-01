import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type {
  HomepageItemRow,
  HomepageLayoutData,
  HomepageLayoutRow,
  WidgetTypeId,
} from "./types.js";

let api: PluginApiClient | null = null;

/** Set once from activate(app); the widget canvas calls the functions below. */
export function setHomepageApi(client: PluginApiClient | null): void {
  api = client;
}

function client(): PluginApiClient {
  if (!api) throw new Error("Homepage plugin API is not ready");
  return api;
}

export async function getHomepageItems(): Promise<HomepageItemRow[]> {
  const res = await client().get<HomepageItemRow[]>("/items");
  return res.data;
}

export async function createHomepageItem(data: {
  typeId: WidgetTypeId;
  title?: string | null;
  config?: Record<string, unknown>;
}): Promise<HomepageItemRow> {
  const res = await client().post<HomepageItemRow>("/items", data);
  return res.data;
}

export async function updateHomepageItem(
  id: number,
  data: { title?: string | null; config?: Record<string, unknown> },
): Promise<HomepageItemRow> {
  const res = await client().put<HomepageItemRow>(`/items/${id}`, data);
  return res.data;
}

export async function deleteHomepageItem(id: number): Promise<void> {
  await client().delete(`/items/${id}`);
}

export async function getHomepageLayout(): Promise<HomepageLayoutRow | null> {
  const res = await client().get<HomepageLayoutRow | null>("/layout");
  return res.data;
}

export async function saveHomepageLayout(
  layout: HomepageLayoutData,
): Promise<HomepageLayoutRow> {
  const res = await client().put<HomepageLayoutRow>("/layout", layout);
  return res.data;
}
