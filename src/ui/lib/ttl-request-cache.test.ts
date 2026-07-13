import { afterEach, describe, expect, it, vi } from "vitest";
import { createTtlRequestCache } from "./ttl-request-cache";

afterEach(() => {
  vi.useRealTimers();
});

describe("createTtlRequestCache", () => {
  it("dedupes concurrent loaders into a single request", async () => {
    const cache = createTtlRequestCache<string>(5_000);
    let calls = 0;
    const loader = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "ok";
    });

    const [a, b] = await Promise.all([cache.get(loader), cache.get(loader)]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(calls).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves cached value within TTL without reloading", async () => {
    const cache = createTtlRequestCache<number>(10_000);
    const loader = vi.fn(async () => 42);

    await cache.get(loader);
    await cache.get(loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.peek()).toBe(42);
  });

  it("reloads after TTL expires", async () => {
    vi.useFakeTimers();
    const cache = createTtlRequestCache<number>(1_000);
    const loader = vi.fn(async () => Date.now());

    await cache.get(loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    await cache.get(loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache rejected loaders", async () => {
    const cache = createTtlRequestCache<string>(5_000);
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.get(loader)).rejects.toThrow("boom");
    await expect(cache.get(loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidate drops the cached entry", async () => {
    const cache = createTtlRequestCache<string>(5_000);
    const loader = vi.fn(async () => "v1");

    await cache.get(loader);
    cache.invalidate();
    expect(cache.peek()).toBeNull();

    loader.mockResolvedValueOnce("v2");
    await expect(cache.get(loader)).resolves.toBe("v2");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
