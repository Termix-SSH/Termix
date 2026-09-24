import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ electron: false }));

vi.mock("@/main-axios", () => ({
  authApi: { defaults: { baseURL: "http://server:8080/" } },
  createRemoteOriginApiInstance: vi.fn(),
}));
vi.mock("@/lib/electron", () => ({ isElectron: () => state.electron }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: () => "device-1" }));

import { pluginFetch } from "@/lib/plugin-transport";

const fetchMock = vi.fn(async () => new Response("ok"));

beforeEach(() => {
  state.electron = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("pluginFetch", () => {
  it("fetches the plugin's own mount point with the session cookie", async () => {
    await pluginFetch("ai", "chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://server:8080/plugin-api/ai/chat/stream");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    const headers = init.headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-termix-device-id")).toBe("device-1");
    expect(headers.get("authorization")).toBeNull();
  });

  it("sends the stored token in the desktop app, like the shared client", async () => {
    state.electron = true;
    localStorage.setItem("jwt", "token-1");

    await pluginFetch("ai", "/status");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://server:8080/plugin-api/ai/status");
    const headers = init.headers as Headers;
    expect(headers.get("x-electron-app")).toBe("true");
    expect(headers.get("authorization")).toBe("Bearer token-1");
  });
});
