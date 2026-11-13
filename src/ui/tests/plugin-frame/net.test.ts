import { describe, expect, it, vi } from "vitest";
import { createFrameFetch, resolveRoute } from "@/plugin-frame/net";

const BASE = "https://termix.example/base";

describe("resolveRoute", () => {
  it("sends the plugin's own routes and assets straight to the server", () => {
    expect(
      resolveRoute("/plugin-api/docker/containers?x=1", "docker", BASE),
    ).toEqual({
      kind: "own-api",
      path: "/plugin-api/docker/containers",
      url: "https://termix.example/base/plugin-api/docker/containers?x=1",
    });
    expect(
      resolveRoute(
        `${BASE}/plugin-assets/docker/locales/en.json`,
        "docker",
        BASE,
      ).kind,
    ).toBe("own-asset");
  });

  it("treats everything else on the server as a core request", () => {
    expect(resolveRoute("/host/db/host", "docker", BASE)).toMatchObject({
      kind: "core",
      path: "/host/db/host",
    });
    expect(
      resolveRoute("/plugin-api/snippets/list", "docker", BASE),
    ).toMatchObject({
      kind: "core",
      path: "/plugin-api/snippets/list",
    });
  });

  it("blocks other servers, credentials in URLs and encoded escapes", () => {
    for (const url of [
      "https://evil.example/x",
      "https://user:pw@termix.example/base/plugin-api/docker/x",
      "/plugin-api/docker/..%2fusers",
    ]) {
      expect(resolveRoute(url, "docker", BASE).kind, url).toBe("blocked");
    }
  });

  it("resolves encoded dots before deciding, so they never hide a core path", () => {
    expect(
      resolveRoute("/plugin-api/docker/%2e%2e/%2e%2e/users/me", "docker", BASE),
    ).toMatchObject({ kind: "core", path: "/users/me" });
  });

  it("does not let a prefix of another plugin's id pass as its own", () => {
    expect(resolveRoute("/plugin-api/docker-evil/x", "docker", BASE).kind).toBe(
      "core",
    );
  });
});

describe("createFrameFetch", () => {
  it("adds the frame token to its own routes and never sends cookies", async () => {
    const realFetch = vi.fn(async () => new Response("ok"));
    const frameFetch = createFrameFetch({
      pluginId: "docker",
      baseUrl: BASE,
      token: async () => "tkn",
      coreRequest: vi.fn(),
      realFetch: realFetch as never,
    });
    await frameFetch("/plugin-api/docker/x", {
      headers: { Authorization: "Bearer forged" },
    });
    const [url, init] = realFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${BASE}/plugin-api/docker/x`);
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tkn");
  });

  it("hands core requests to the shell and refuses blocked ones", async () => {
    const coreRequest = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode('{"ok":true}').buffer as ArrayBuffer,
    }));
    const realFetch = vi.fn();
    const frameFetch = createFrameFetch({
      pluginId: "docker",
      baseUrl: BASE,
      token: async () => "tkn",
      coreRequest,
      realFetch: realFetch as never,
    });
    const response = await frameFetch("/users/me");
    expect(await response.json()).toEqual({ ok: true });
    expect(coreRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/users/me", body: null }),
    );
    await expect(frameFetch("https://evil.example/")).rejects.toThrow();
    expect(realFetch).not.toHaveBeenCalled();
  });
});
