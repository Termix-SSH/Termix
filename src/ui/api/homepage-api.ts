import { homepageApi, handleApiError } from "@/main-axios";
import type {
  HomepageItemRow,
  HomepageLayoutData,
  HomepageLayoutRow,
  WidgetTypeId,
} from "@/types/homepage-types";

export async function getHomepageItems(): Promise<HomepageItemRow[]> {
  try {
    const res = await homepageApi.get("/items");
    return res.data;
  } catch (error) {
    throw handleApiError(error, "fetch homepage items");
  }
}

export async function createHomepageItem(data: {
  typeId: WidgetTypeId;
  title?: string | null;
  config?: Record<string, unknown>;
}): Promise<HomepageItemRow> {
  try {
    const res = await homepageApi.post("/items", data);
    return res.data;
  } catch (error) {
    throw handleApiError(error, "create homepage item");
  }
}

export async function updateHomepageItem(
  id: number,
  data: {
    title?: string | null;
    config?: Record<string, unknown>;
  },
): Promise<HomepageItemRow> {
  try {
    const res = await homepageApi.put(`/items/${id}`, data);
    return res.data;
  } catch (error) {
    throw handleApiError(error, "update homepage item");
  }
}

export async function deleteHomepageItem(id: number): Promise<void> {
  try {
    await homepageApi.delete(`/items/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete homepage item");
  }
}

export async function getHomepageLayout(): Promise<HomepageLayoutRow | null> {
  try {
    const res = await homepageApi.get("/layout");
    return res.data;
  } catch (error) {
    throw handleApiError(error, "fetch homepage layout");
  }
}

export async function saveHomepageLayout(
  layout: HomepageLayoutData,
): Promise<HomepageLayoutRow> {
  try {
    const res = await homepageApi.put("/layout", layout);
    return res.data;
  } catch (error) {
    throw handleApiError(error, "save homepage layout");
  }
}

export function getHomepageFaviconUrl(url: string): string {
  try {
    const base = (homepageApi.defaults.baseURL ?? "").replace(/\/$/, "");
    return `${base}/favicon?url=${encodeURIComponent(url)}`;
  } catch {
    return "";
  }
}
