import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getUserInfo: vi.fn(),
  getUserPreferences: vi.fn(),
  saveUserPreferences: vi.fn(async () => ({})),
}));
const electron = vi.hoisted(() => ({ isElectron: vi.fn(() => true) }));

vi.mock("@/main-axios", () => api);
vi.mock("@/lib/electron", () => electron);
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n/i18n", () => ({
  changeAppLanguage: vi.fn(),
  consumeLoginLanguage: vi.fn(() => null),
}));
vi.mock("@/lib/db-health-monitor", () => ({ dbHealthMonitor: {} }));
vi.mock("@/hooks/use-permissions", () => ({ resetPermissionsCache: vi.fn() }));

import { resolveStorageMode } from "@/shell/controller/use-shell-lifecycle";

const cloud = {
  reopenTabsOnLogin: false,
  storageMode: "cloud",
  fontSize: "lg",
};

beforeEach(() => {
  vi.clearAllMocks();
  electron.isElectron.mockReturnValue(true);
});

describe("resolveStorageMode", () => {
  it("falls back to this device on a desktop with no linked account (#1809)", async () => {
    api.getUserInfo.mockResolvedValue({ linked: null });

    const prefs = await resolveStorageMode(cloud);

    expect(prefs.storageMode).toBe("local");
    expect(api.saveUserPreferences).toHaveBeenCalledWith({
      storageMode: "local",
    });
  });

  it("keeps cloud mode on a linked desktop", async () => {
    api.getUserInfo.mockResolvedValue({ linked: { username: "a" } });

    expect((await resolveStorageMode(cloud)).storageMode).toBe("cloud");
    expect(api.saveUserPreferences).not.toHaveBeenCalled();
  });

  it("keeps cloud mode in the browser", async () => {
    electron.isElectron.mockReturnValue(false);

    expect((await resolveStorageMode(cloud)).storageMode).toBe("cloud");
    expect(api.getUserInfo).not.toHaveBeenCalled();
  });

  it("keeps the prefs when the account can't be read", async () => {
    api.getUserInfo.mockRejectedValue(new Error("offline"));

    expect((await resolveStorageMode(cloud)).storageMode).toBe("cloud");
  });
});
