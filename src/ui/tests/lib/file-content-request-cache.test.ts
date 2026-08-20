import { describe, expect, it, vi } from "vitest";
import {
  getCachedFileContent,
  invalidateCachedFileContent,
  shouldPrefetchFileContent,
} from "../../lib/file-content-request-cache";

describe("file content request cache", () => {
  it("coalesces reads and reloads after invalidation", async () => {
    const loader = vi.fn(async () => ({ content: "hello", path: "/note" }));

    await Promise.all([
      getCachedFileContent("session", "/note", loader),
      getCachedFileContent("session", "/note", loader),
    ]);
    expect(loader).toHaveBeenCalledOnce();

    invalidateCachedFileContent("session", "/note");
    await getCachedFileContent("session", "/note", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("only prefetches known small files on an unconstrained network", () => {
    expect(
      shouldPrefetchFileContent(
        { name: "note", path: "/note", type: "file", size: 512 * 1024 },
        512 * 1024,
      ),
    ).toBe(true);
    expect(
      shouldPrefetchFileContent(
        { name: "large", path: "/large", type: "file", size: 512 * 1024 + 1 },
        512 * 1024,
      ),
    ).toBe(false);
    expect(
      shouldPrefetchFileContent(
        { name: "unknown", path: "/unknown", type: "file" },
        512 * 1024,
      ),
    ).toBe(false);
    expect(
      shouldPrefetchFileContent(
        { name: "note", path: "/note", type: "file", size: 100 },
        0,
      ),
    ).toBe(false);
  });
});
