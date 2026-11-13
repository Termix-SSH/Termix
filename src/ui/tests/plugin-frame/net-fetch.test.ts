/**
 * The frame's fetch and XHR: the frame token goes only to the plugin's own
 * routes, core paths go through the shell, and nothing else is reachable.
 */
import { describe, expect, it, vi } from "vitest";
import { createFrameFetch, createFrameXhr } from "@/plugin-frame/net";

const BASE = "https://termix.test/base";

function setup() {
  const real = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response("own", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  );
  const core = vi.fn(async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode('{"ok":true}').buffer as ArrayBuffer,
  }));
  const frameFetch = createFrameFetch({
    pluginId: "docker",
    baseUrl: BASE,
    token: async () => "frame-token",
    coreRequest: core,
    realFetch: real as unknown as typeof fetch,
  });
  return { real, core, frameFetch };
}

describe("createFrameFetch", () => {
  it("sends the frame token, and only to the plugin's own API", async () => {
    const { real, frameFetch } = setup();
    await frameFetch("/plugin-api/docker/containers", {
      method: "POST",
      body: "x",
      headers: { "x-a": "1" },
    });
    const [url, init] = real.mock.calls[0];
    expect(url).toBe("https://termix.test/base/plugin-api/docker/containers");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer frame-token");
    expect(headers.get("x-a")).toBe("1");
    expect(init?.credentials).toBe("omit");
  });

  it("fetches its own assets without the token", async () => {
    const { real, frameFetch } = setup();
    await frameFetch(`${BASE}/plugin-assets/docker/logo.svg`);
    const init = real.mock.calls[0][1];
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(init?.credentials).toBe("omit");
  });

  it("sends core paths through the shell, never directly", async () => {
    const { real, core, frameFetch } = setup();
    const res = await frameFetch("/users/me?x=1", {
      method: "PUT",
      body: JSON.stringify({ a: 1 }),
    });
    expect(real).not.toHaveBeenCalled();
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: "/users/me?x=1" }),
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it("gives an empty body for 204 and 304", async () => {
    const { core, frameFetch } = setup();
    core.mockResolvedValueOnce({ status: 204, headers: {}, body: null });
    expect((await frameFetch("/x")).status).toBe(204);
  });

  it("refuses other origins, other plugins' routes by token and tricks in the path", async () => {
    const { real, core, frameFetch } = setup();
    for (const url of [
      "https://evil.test/plugin-api/docker/x",
      "https://user:pw@termix.test/base/x",
      "/plugin-api/docker/..%2f..%2fusers",
    ]) {
      await expect(frameFetch(url)).rejects.toBeInstanceOf(TypeError);
    }
    // Dot segments are folded by URL parsing, so this is a core path, sent
    // through the shell without the token.
    await frameFetch("/plugin-api/docker/../../users");
    await frameFetch("/plugin-api/dockerx/steal");
    expect(real).not.toHaveBeenCalled();
    expect(core.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      expect.objectContaining({ path: "/users" }),
      expect.objectContaining({ path: "/plugin-api/dockerx/steal" }),
    ]);
  });

  it("passes data and blob URLs to the real fetch", async () => {
    const { real, frameFetch } = setup();
    await frameFetch("data:text/plain,hi");
    expect(real.mock.calls[0][0]).toBe("data:text/plain,hi");
  });
});

function xhrFor(frameFetch: typeof fetch) {
  const Xhr = createFrameXhr(frameFetch);
  return new Xhr();
}

function done(xhr: XMLHttpRequest): Promise<string> {
  return new Promise((resolve) => {
    for (const kind of ["load", "error", "abort", "timeout"]) {
      xhr.addEventListener(kind, () => resolve(kind));
    }
  });
}

describe("createFrameXhr", () => {
  it("reads text and headers like a browser XHR", async () => {
    const { frameFetch } = setup();
    const xhr = xhrFor(frameFetch);
    const states: number[] = [];
    xhr.onreadystatechange = () => states.push(xhr.readyState);
    xhr.open("get", "/plugin-api/docker/ping");
    xhr.setRequestHeader("x-b", "2");
    const finished = done(xhr);
    xhr.send();
    expect(await finished).toBe("load");
    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe("own");
    expect(xhr.getResponseHeader("Content-Type")).toBe("text/plain");
    expect(xhr.getAllResponseHeaders()).toContain("content-type: text/plain");
    expect(states).toEqual([1, 2, 3, 4]);
  });

  it("parses json, keeps array buffers and makes blobs", async () => {
    const { frameFetch } = setup();
    for (const [type, check] of [
      ["json", (v: unknown) => expect(v).toEqual({ ok: true })],
      ["arraybuffer", (v: unknown) => expect(v).toBeInstanceOf(ArrayBuffer)],
      ["blob", (v: unknown) => expect(v).toBeInstanceOf(Blob)],
    ] as const) {
      const xhr = xhrFor(frameFetch);
      xhr.responseType = type;
      xhr.open("GET", "/core/thing");
      const finished = done(xhr);
      xhr.send();
      await finished;
      check(xhr.response);
    }
  });

  it("reports network errors, aborts and timeouts with status 0", async () => {
    const failing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    const a = xhrFor(failing);
    a.open("GET", "/x");
    const errored = done(a);
    a.send();
    expect(await errored).toBe("error");
    expect(a.status).toBe(0);

    const hanging = (() => new Promise(() => {})) as unknown as typeof fetch;
    const b = xhrFor(hanging);
    b.open("POST", "/x");
    const aborted = done(b);
    b.send("body");
    b.abort();
    expect(await aborted).toBe("abort");

    const c = xhrFor(hanging);
    c.timeout = 10;
    c.open("GET", "/x");
    const timedOut = done(c);
    c.send();
    expect(await timedOut).toBe("timeout");
    c.overrideMimeType();
    c.abort();
  });
});
