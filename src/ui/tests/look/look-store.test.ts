import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getLook: vi.fn(),
  saveUserLook: vi.fn(async () => {}),
  saveDefaultLook: vi.fn(
    async (d: { layout?: string | null; theme?: string | null }) => ({
      layout: d.layout ?? null,
      theme: d.theme ?? null,
    }),
  ),
}));
vi.mock("@/api/look-api", () => api);

import {
  chooseDefaultLook,
  chooseLayout,
  chooseThemeForAccount,
  chosenLayoutId,
  getLookState,
  loadLook,
  resetLook,
  safeLayoutRequested,
} from "@/look/look-store";

const response = {
  layoutId: null,
  themeId: null,
  defaults: { layout: "admin-pick", theme: null },
  defaultLook: { layout: null, theme: null },
  safeLayout: false,
  unavailable: [],
};

beforeEach(() => {
  localStorage.clear();
  resetLook();
  api.getLook.mockReset();
  api.saveUserLook.mockClear();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("look store", () => {
  it("fetches once and resolves the layout", async () => {
    api.getLook.mockResolvedValue(response);
    await Promise.all([loadLook(), loadLook()]);
    expect(api.getLook).toHaveBeenCalledTimes(1);
    expect(chosenLayoutId()).toBe("admin-pick");
    expect(localStorage.getItem("termix-layout")).toBe("admin-pick");
  });

  it("never rejects, and remembers the last layout when the server fails", async () => {
    localStorage.setItem("termix-layout", "remembered");
    api.getLook.mockRejectedValue(new Error("offline"));
    await expect(loadLook()).resolves.toBeNull();
    expect(getLookState().loaded).toBe(true);
    expect(chosenLayoutId()).toBe("remembered");
  });

  it("saves choices and asks plugins to reload for a new layout", async () => {
    api.getLook.mockResolvedValue(response);
    await loadLook();
    const changed = vi.fn();
    window.addEventListener("termix:plugins-changed", changed);
    await chooseLayout("mine");
    expect(api.saveUserLook).toHaveBeenCalledWith({ layoutId: "mine" });
    expect(chosenLayoutId()).toBe("mine");
    expect(changed).toHaveBeenCalled();
    await chooseThemeForAccount("nord");
    expect(getLookState().response?.themeId).toBe("nord");
    await chooseDefaultLook({ theme: "dracula" });
    expect(getLookState().response?.defaults.theme).toBe("dracula");
    window.removeEventListener("termix:plugins-changed", changed);
  });

  it("asks for the repair view from the address or the server", async () => {
    api.getLook.mockResolvedValue({ ...response, safeLayout: true });
    expect(safeLayoutRequested()).toBe(false);
    await loadLook();
    expect(safeLayoutRequested()).toBe(true);
    resetLook();
    window.history.replaceState(null, "", "/?safe-layout=1");
    expect(safeLayoutRequested()).toBe(true);
  });
});
