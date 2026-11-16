import { describe, expect, it, vi } from "vitest";
import {
  fetchImage,
  IMAGE_MAX_BYTES,
  ImageProxyError,
} from "../../plugins/image-proxy.js";
import {
  createDnsLookupHook,
  isLoopbackAddress,
} from "../../utils/safe-outbound-fetch.js";

function reply(
  status: number,
  headers: Record<string, string>,
  body: Uint8Array | string = "",
) {
  return new Response(status === 302 ? null : body, { status, headers });
}

describe("fetchImage", () => {
  it("hands back a picture with its type", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, { "content-type": "image/png; charset=binary" }, "png"),
    );
    const out = await fetchImage(
      "https://icons.example/a.png",
      fetchImpl as never,
    );
    expect(out.type).toBe("image/png");
    expect(out.body.toString()).toBe("png");
    // LAN hosts are allowed by name, with loopback refused at connect.
    const call = fetchImpl.mock.calls[0] as unknown[];
    expect(call[2]).toEqual(["icons.example"]);
    expect(call[5]).toBe(isLoopbackAddress);
  });

  it("refuses anything that is not a picture", async () => {
    const fetchImpl = async () =>
      reply(200, { "content-type": "text/html" }, "<html>");
    await expect(
      fetchImage("https://x.example/", fetchImpl as never),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("refuses this machine and odd addresses before asking", async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      "http://127.0.0.1:30001/users/me",
      "http://[::1]/",
      "http://0.0.0.0/",
      "file:///etc/passwd",
      "http://user:pass@x.example/",
      42,
    ]) {
      await expect(fetchImage(url, fetchImpl as never)).rejects.toBeInstanceOf(
        ImageProxyError,
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks every redirect again and stops after three", async () => {
    const toLoopback = vi.fn(async () =>
      reply(302, { location: "http://127.0.0.1/secret.png" }),
    );
    await expect(
      fetchImage("https://x.example/a.png", toLoopback as never),
    ).rejects.toMatchObject({ status: 403 });

    const loop = vi.fn(async () =>
      reply(302, { location: "https://x.example/again.png" }),
    );
    await expect(
      fetchImage("https://x.example/a.png", loop as never),
    ).rejects.toMatchObject({ status: 502 });
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it("refuses a picture over the limit, declared or not", async () => {
    const declared = async () =>
      reply(200, {
        "content-type": "image/png",
        "content-length": String(IMAGE_MAX_BYTES + 1),
      });
    await expect(
      fetchImage("https://x.example/a.png", declared as never),
    ).rejects.toMatchObject({ status: 413 });

    const big = async () =>
      reply(
        200,
        { "content-type": "image/png" },
        new Uint8Array(IMAGE_MAX_BYTES + 10),
      );
    await expect(
      fetchImage("https://x.example/a.png", big as never),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("refusing addresses at connect time", () => {
  it("knows loopback in every spelling", () => {
    for (const address of [
      "127.0.0.1",
      "127.5.5.5",
      "::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
      "::",
    ]) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
    for (const address of ["192.168.1.10", "10.0.0.1", "8.8.8.8", "fe80::1"]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });

  it("refuses a name that resolves to loopback even when private is allowed", () => {
    const callback = vi.fn();
    const hook = createDnsLookupHook(
      ((_host: string, _options: unknown, done: (...args: unknown[]) => void) =>
        done(null, [{ address: "127.0.0.1", family: 4 }])) as never,
      true,
      isLoopbackAddress,
    );
    hook("rebind.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: "This destination is not allowed" }),
      "",
      0,
    );
  });
});
