import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeContext } from "@termix/plugin-sdk/testing";

vi.mock("../../../../src/backend/database/repositories/factory.js", () => ({
  createCurrentNotificationChannelRepository: vi.fn(),
}));

const { setTunnelServices } = await import("../../src/backend/tunnels.js");
const { executeStep } = await import("../../src/backend/actions/index.js");

afterEach(() => {
  setTunnelServices(null);
});

function context(dryRun = false) {
  return {
    userId: "user-1",
    automationId: 1,
    runId: 1,
    dryRun,
    template: {},
  } as never;
}

const step = (action: "connect" | "disconnect") =>
  ({
    id: "s1",
    type: "tunnel",
    action,
    tunnelName: "7::0::web::8080::db::5432",
  }) as never;

describe("the tunnel step", () => {
  it("starts and stops the tunnel through tunnels.access as the automation's owner", async () => {
    const fake = createFakeContext({ pluginId: "automations" });
    const tunnels = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    fake.ctx.services.provide("tunnels.access", tunnels);
    const get = vi.spyOn(fake.ctx.services, "get");
    setTunnelServices(fake.ctx.services);

    const connected = await executeStep(step("connect"), context());
    expect(connected.success).toBe(true);
    expect(tunnels.start).toHaveBeenCalledWith("7::0::web::8080::db::5432");
    expect(get).toHaveBeenCalledWith("tunnels.access", { userId: "user-1" });

    const stopped = await executeStep(step("disconnect"), context());
    expect(stopped.success).toBe(true);
    expect(tunnels.stop).toHaveBeenCalledWith("7::0::web::8080::db::5432");
  });

  it("reports the tunnel plugin's own error", async () => {
    const fake = createFakeContext({ pluginId: "automations" });
    fake.ctx.services.provide("tunnels.access", {
      start: vi.fn(async () => {
        throw new Error('Tunnel "x" is not configured');
      }),
      stop: vi.fn(),
    });
    setTunnelServices(fake.ctx.services);

    const result = await executeStep(step("connect"), context());
    expect(result.success).toBe(false);
    expect(result.error ?? result.output).toMatch(/not configured/);
  });

  it("fails the step cleanly while the tunnels plugin is off", async () => {
    // No provider: the optional dependency is missing.
    setTunnelServices(
      createFakeContext({ pluginId: "automations" }).ctx.services,
    );
    const withoutProvider = await executeStep(step("connect"), context());
    expect(withoutProvider.success).toBe(false);
    expect(withoutProvider.error ?? withoutProvider.output).toMatch(
      /tunnels plugin is not available/,
    );

    setTunnelServices(null);
    const inactive = await executeStep(step("disconnect"), context());
    expect(inactive.success).toBe(false);
  });

  it("only describes what it would do on a dry run", async () => {
    const result = await executeStep(step("connect"), context(true));
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Would connect tunnel/);
  });
});
