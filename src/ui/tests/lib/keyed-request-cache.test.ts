import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyedRequestCache } from "../../lib/keyed-request-cache";

afterEach(() => vi.useRealTimers());

describe("createKeyedRequestCache", () => {
  it("coalesces requests per key without mixing keys", async () => {
    let resolve!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const cache = createKeyedRequestCache<string>(5_000);

    const first = cache.get("host:1", loader);
    const duplicate = cache.get("host:1", loader);
    const other = cache.get("host:2", async () => "other");
    resolve("shared");

    await expect(Promise.all([first, duplicate, other])).resolves.toEqual([
      "shared",
      "shared",
      "other",
    ]);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("can show stale data immediately while forcing one refresh", async () => {
    vi.useFakeTimers();
    const cache = createKeyedRequestCache<string>(1_000);
    await cache.get("directory", async () => "old");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(cache.peek("directory", 30_000)).toBe("old");

    const loader = vi.fn(async () => "fresh");
    const [a, b] = await Promise.all([
      cache.get("directory", loader, { force: true }),
      cache.get("directory", loader, { force: true }),
    ]);
    expect([a, b]).toEqual(["fresh", "fresh"]);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("evicts the least recently used entry when bounded", async () => {
    const cache = createKeyedRequestCache<number>(10_000, 2);
    await cache.get("a", async () => 1);
    await cache.get("b", async () => 2);
    expect(cache.peek("a")).toBe(1);
    await cache.get("c", async () => 3);

    expect(cache.peek("a")).toBe(1);
    expect(cache.peek("b")).toBeNull();
    expect(cache.peek("c")).toBe(3);
  });

  it("keeps stale data when a refresh fails", async () => {
    const cache = createKeyedRequestCache<string>(1_000);
    await cache.get("key", async () => "safe");

    await expect(
      cache.get(
        "key",
        async () => {
          throw new Error("offline");
        },
        { force: true },
      ),
    ).rejects.toThrow("offline");
    expect(cache.peek("key")).toBe("safe");
  });

  it("does not let an invalidated request overwrite newer data", async () => {
    let resolveOld!: (value: string) => void;
    const cache = createKeyedRequestCache<string>(10_000);
    const oldRequest = cache.get(
      "key",
      () => new Promise<string>((resolve) => (resolveOld = resolve)),
    );

    cache.set("key", "optimistic");
    resolveOld("old");
    await oldRequest;

    expect(cache.peek("key")).toBe("optimistic");
  });
});
