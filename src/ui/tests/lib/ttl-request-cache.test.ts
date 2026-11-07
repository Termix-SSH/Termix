import { afterEach, describe, expect, it, vi } from "vitest";
import { createTtlRequestCache } from "../../lib/ttl-request-cache";

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

  it("does not hand out a load that started before invalidate", async () => {
    const cache = createTtlRequestCache<string>(5_000);
    let finishOld!: (value: string) => void;
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValue("after");

    const before = cache.get(loader);
    cache.invalidate();
    const after = cache.get(loader);
    finishOld("before");

    await expect(after).resolves.toBe("after");
    await expect(before).resolves.toBe("after");
    expect(cache.peek()).toBe("after");
  });

  it("keeps the newer value when an older load fails after invalidate", async () => {
    const cache = createTtlRequestCache<string>(5_000);
    let failOld!: (error: Error) => void;
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (failOld = reject)),
      )
      .mockResolvedValue("after");

    const before = cache.get(loader);
    cache.invalidate();
    const after = cache.get(loader);
    failOld(new Error("boom"));

    await expect(after).resolves.toBe("after");
    await expect(before).rejects.toThrow("boom");
    expect(cache.peek()).toBe("after");
  });
});
