import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebEndpoint } from "../../src/shared/web-endpoint-config";

const isElectron = vi.hoisted(() => vi.fn(() => false));
vi.mock("@termix/plugin-sdk/ui", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isElectron,
}));

const pluginPost = vi.hoisted(() => vi.fn());

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "tunnel",
    render: "external",
    bindHost: "0.0.0.0",
    ...overrides,
  };
}

const host = { id: "7", ip: "192.168.1.10" };

beforeEach(async () => {
  const { setWebEndpointApi } =
    await import("../../src/frontend/web-endpoint-api");
  setWebEndpointApi({ post: pluginPost } as never);
  isElectron.mockReturnValue(false);
  pluginPost.mockReset();
  pluginPost.mockResolvedValue({ data: { port: 41234 } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openWebEndpointTunnel", () => {
  it("posts to the plugin's own /open route", async () => {
    // app.api is already rooted at /plugin-api/web-endpoint, so the path is
    // relative to that and must not repeat the prefix.
    const { openWebEndpointTunnel } =
      await import("../../src/frontend/web-endpoint-api");
    await openWebEndpointTunnel(7, "e1");

    expect(pluginPost).toHaveBeenCalledWith("/open", {
      hostId: 7,
      endpointId: "e1",
    });
  });

  it("returns the port", async () => {
    const { openWebEndpointTunnel } =
      await import("../../src/frontend/web-endpoint-api");
    await expect(openWebEndpointTunnel(7, "e1")).resolves.toBe(41234);
  });

  it("preserves the backend's reason instead of the generic message", async () => {
    // 502 is this route's likeliest real failure and carries the actionable
    // cause. Collapsing it into "Server error occurred" defeats the
    // per-failure-mode messaging entirely.
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: {
        status: 502,
        data: { error: "Timed out reaching the endpoint port" },
      },
    });
    pluginPost.mockRejectedValue(axiosError);
    const { openWebEndpointTunnel, WebEndpointTunnelError } =
      await import("../../src/frontend/web-endpoint-api");

    await expect(openWebEndpointTunnel(7, "e1")).rejects.toThrow(
      /Timed out reaching the endpoint port/,
    );
    await expect(openWebEndpointTunnel(7, "e1")).rejects.toBeInstanceOf(
      WebEndpointTunnelError,
    );
  });

  it("falls back to the shared handler when the body carries no string reason", async () => {
    // A body shaped { error: <object> } would otherwise render as
    // "[object Object]" to the user.
    pluginPost.mockRejectedValue(
      Object.assign(new Error("boom"), {
        isAxiosError: true,
        response: { status: 500, data: { error: { nested: true } } },
      }),
    );
    const { openWebEndpointTunnel } =
      await import("../../src/frontend/web-endpoint-api");
    await expect(openWebEndpointTunnel(7, "e1")).rejects.toThrow(
      /Could not open web endpoint tunnel/,
    );
  });

  it("treats a missing port as a failure rather than returning undefined", async () => {
    pluginPost.mockResolvedValue({ data: {} });
    const { openWebEndpointTunnel } =
      await import("../../src/frontend/web-endpoint-api");
    await expect(openWebEndpointTunnel(7, "e1")).rejects.toThrow(/no port/);
  });
});

describe("requireNumericHostId", () => {
  it("accepts a saved host id and rejects a quick-connect one", async () => {
    const { requireNumericHostId } =
      await import("../../src/frontend/web-endpoint-api");
    expect(requireNumericHostId("7")).toBe(7);
    for (const bad of ["quick-connect-1", "", "0", "-3", "abc"]) {
      expect(() => requireNumericHostId(bad)).toThrow(/saved host/);
    }
  });
});

/**
 * The backend now resolves and validates the target URL itself (host address,
 * tunnel port, loopback/session-cookie checks) before ever calling
 * ctx.desktop.openIsolatedWindow, so this call is a thin ask-and-report over
 * the plugin's own /open-window route rather than a client-side URL builder.
 */
describe("openWebEndpointExternally", () => {
  it("refuses outside the desktop app before calling the backend", async () => {
    const { openWebEndpointExternally } =
      await import("../../src/frontend/web-endpoint-api");
    await expect(openWebEndpointExternally(host, endpoint())).rejects.toThrow(
      /desktop app/,
    );
    expect(pluginPost).not.toHaveBeenCalled();
  });

  it("posts hostId, endpointId and ignoreCert to /open-window", async () => {
    isElectron.mockReturnValue(true);
    pluginPost.mockResolvedValue({ data: { success: true } });
    const { openWebEndpointExternally } =
      await import("../../src/frontend/web-endpoint-api");
    await openWebEndpointExternally(host, endpoint({ ignoreCert: true }));
    expect(pluginPost).toHaveBeenCalledWith("/open-window", {
      hostId: 7,
      endpointId: "e1",
      ignoreCert: true,
    });
  });

  it("preserves the backend's reason instead of the generic message", async () => {
    isElectron.mockReturnValue(true);
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 502, data: { error: "No window to attach to" } },
    });
    pluginPost.mockRejectedValue(axiosError);
    const { openWebEndpointExternally, WebEndpointTunnelError } =
      await import("../../src/frontend/web-endpoint-api");
    await expect(
      openWebEndpointExternally(host, endpoint()),
    ).rejects.toBeInstanceOf(WebEndpointTunnelError);
  });
});
