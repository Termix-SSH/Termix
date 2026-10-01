import { beforeEach, describe, expect, it, vi } from "vitest";

const hub = vi.hoisted(() => ({
  value: null as null | { deliver: ReturnType<typeof vi.fn> },
}));
const resolveAudience = vi.hoisted(() => vi.fn(async () => ["u1", "u2"]));

vi.mock("../../plugins/notify-hub.js", () => ({
  activeNotifyHub: async () => hub.value,
}));
vi.mock("../../plugins/ctx-notify.js", () => ({ resolveAudience }));

const { sendCoreAlert, CORE_ALERT_SOURCE } =
  await import("../../notify/core-notify.js");

beforeEach(() => {
  hub.value = { deliver: vi.fn(async () => ({ recipients: 2 })) };
  resolveAudience.mockClear();
});

describe("core alerts", () => {
  it("hands the alert to the hub as coming from Termix", async () => {
    await sendCoreAlert({ title: "t", audience: "admins" });
    expect(hub.value!.deliver).toHaveBeenCalledWith({
      source: CORE_ALERT_SOURCE,
      recipients: ["u1", "u2"],
      notification: { title: "t", audience: "admins" },
    });
  });

  it("is a no-op with no hub, and never throws", async () => {
    hub.value = null;
    await expect(
      sendCoreAlert({ title: "t", audience: "admins" }),
    ).resolves.toBeUndefined();

    hub.value = { deliver: vi.fn(async () => Promise.reject(new Error("x"))) };
    await expect(
      sendCoreAlert({ title: "t", audience: "admins" }),
    ).resolves.toBeUndefined();
  });
});
