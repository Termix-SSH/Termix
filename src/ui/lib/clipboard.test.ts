import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    delete (window as { electronClipboard?: unknown }).electronClipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", {
      value,
      configurable: true,
    });
  }

  it("uses the electron bridge when present", async () => {
    const writeText = vi.fn().mockResolvedValue(true);
    (window as { electronClipboard?: unknown }).electronClipboard = {
      writeText,
      readText: vi.fn(),
    };

    const ok = await copyToClipboard("hello");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const ok = await copyToClipboard("world");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("world");
  });

  it("falls back to execCommand when navigator.clipboard is undefined (Brave / non-HTTPS)", async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const ok = await copyToClipboard("fallback");

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when the async write throws", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const ok = await copyToClipboard("retry");

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when every approach fails", async () => {
    setClipboard(undefined);
    (document as unknown as { execCommand: () => boolean }).execCommand =
      () => {
        throw new Error("no execCommand");
      };

    const ok = await copyToClipboard("nope");

    expect(ok).toBe(false);
  });
});
