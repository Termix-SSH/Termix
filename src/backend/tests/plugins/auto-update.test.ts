import { beforeEach, describe, expect, it, vi } from "vitest";

const manage = vi.hoisted(() => ({
  isLinkedDesktop: vi.fn(async () => false),
  updateAllPlugins: vi.fn(),
}));
const notify = vi.hoisted(() => ({ sendCoreAlert: vi.fn(async () => {}) }));

vi.mock("../../plugins/manage.js", () => manage);
vi.mock("../../notify/core-notify.js", () => notify);

import { runPluginAutoUpdate } from "../../plugins/auto-update.js";

beforeEach(() => {
  manage.isLinkedDesktop.mockResolvedValue(false);
  manage.updateAllPlugins.mockReset();
  notify.sendCoreAlert.mockClear();
});

describe("runPluginAutoUpdate", () => {
  it("only touches plugins with auto-update on", async () => {
    manage.updateAllPlugins.mockResolvedValue({
      updated: [{ id: "docker", version: "1.1.0" }],
      needsReview: [],
      failed: [],
    });
    await runPluginAutoUpdate();
    expect(manage.updateAllPlugins).toHaveBeenCalledWith({
      userId: null,
      onlyAutoUpdate: true,
    });
    expect(notify.sendCoreAlert).not.toHaveBeenCalled();
  });

  it("alerts admins about an update that asks for more", async () => {
    manage.updateAllPlugins.mockResolvedValue({
      updated: [],
      needsReview: [{ id: "docker", capabilities: ["notify:send"] }],
      failed: [],
    });
    await runPluginAutoUpdate();
    expect(notify.sendCoreAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "admins",
        dedupeKey: "plugin-review:docker:notify:send",
      }),
    );
  });

  it("does nothing on a linked desktop", async () => {
    manage.isLinkedDesktop.mockResolvedValue(true);
    await runPluginAutoUpdate();
    expect(manage.updateAllPlugins).not.toHaveBeenCalled();
  });
});
