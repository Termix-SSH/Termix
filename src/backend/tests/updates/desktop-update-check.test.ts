import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCoreAlert = vi.hoisted(() => vi.fn(async () => {}));
const latest = vi.hoisted(() => ({
  value: null as null | { version: string; url: string; prerelease?: boolean },
}));
const channel = vi.hoisted(() => ({ value: "stable", asked: [] as string[] }));
const version = vi.hoisted(() => ({ value: "2.9.0" as string | null }));
const disabled = vi.hoisted(() => ({ value: false }));

vi.mock("../../notify/core-notify.js", () => ({ sendCoreAlert }));
vi.mock("../../utils/app-version.js", () => ({
  getLocalVersion: () => version.value,
}));
vi.mock("../../utils/latest-release.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/latest-release.js")>()),
  fetchLatestRelease: async (wanted: string) => {
    channel.asked.push(wanted);
    return latest.value;
  },
}));
vi.mock("../../updates/update-channel.js", () => ({
  getCoreChannel: async () => channel.value,
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    listAll: async () => [{ id: "local" }],
  }),
  createCurrentUserPreferenceRepository: () => ({
    findByUserId: async () => ({ disableUpdateCheck: disabled.value }),
  }),
}));

const { checkForDesktopUpdate } =
  await import("../../updates/desktop-update-check.js");

beforeEach(() => {
  sendCoreAlert.mockClear();
  version.value = "2.9.0";
  disabled.value = false;
  channel.value = "stable";
  channel.asked = [];
  latest.value = {
    version: "2.9.1",
    url: "https://github.com/Termix-SSH/Termix/releases/tag/v2.9.1",
  };
});

describe("desktop update check", () => {
  it("sends one alert per newer release, linking to it", async () => {
    await checkForDesktopUpdate();
    expect(sendCoreAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "termix.update",
        dedupeKey: "update:2.9.1",
        link: { url: latest.value!.url },
        audience: "admins",
      }),
    );
  });

  it("stays quiet when up to date, ahead, or turned off", async () => {
    version.value = "2.9.1";
    await checkForDesktopUpdate();
    version.value = "26.10.0";
    await checkForDesktopUpdate();
    version.value = "2.9.0";
    disabled.value = true;
    await checkForDesktopUpdate();
    expect(sendCoreAlert).not.toHaveBeenCalled();
  });

  it("follows the beta channel", async () => {
    channel.value = "beta";
    latest.value = {
      version: "2.9.1-beta.2",
      url: "https://github.com/Termix-SSH/Termix/releases/tag/v2.9.1-beta.2",
      prerelease: true,
    };
    await checkForDesktopUpdate();
    expect(channel.asked).toEqual(["beta"]);
    expect(sendCoreAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Termix 2.9.1-beta.2 is available",
        dedupeKey: "update:2.9.1-beta.2",
      }),
    );
  });

  it("does not offer the matching stable as older than its own beta", async () => {
    version.value = "2.9.1-beta.2";
    await checkForDesktopUpdate();
    expect(sendCoreAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "update:2.9.1" }),
    );
  });
});
