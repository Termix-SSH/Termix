import { beforeEach, describe, expect, it, vi } from "vitest";

const automationFetch = vi.fn();

vi.mock("../../automations/http.js", () => ({
  automationFetch: (...args: unknown[]) => automationFetch(...args),
}));

const { sendAutomationNotification } = await import(
  "../../automations/notify.js"
);

beforeEach(() => {
  automationFetch.mockReset();
  automationFetch.mockResolvedValue({ ok: true });
});

describe("sendAutomationNotification", () => {
  it("keeps alert-compatible host and rule fields in webhook payloads", async () => {
    await sendAutomationNotification(
      { id: 1, type: "webhook", config: '{"url":"https://example.com"}' },
      {
        title: "CPU warning",
        body: "cpu.percent is at 97",
        severity: "warning",
        context: {
          host: { id: 11, name: "Proxmox Node" },
          trigger: { value: 97, threshold: 90 },
          run: { automationId: 42 },
        },
      },
    );

    const options = automationFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toMatchObject({
      hostName: "Proxmox Node",
      hostId: 11,
      ruleName: "CPU warning",
      ruleId: 42,
      value: 97,
      threshold: 90,
      message: "cpu.percent is at 97",
    });
  });
});
