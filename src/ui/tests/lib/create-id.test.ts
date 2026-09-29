import { afterEach, describe, expect, it, vi } from "vitest";
import { createId } from "@/lib/create-id";

afterEach(() => vi.unstubAllGlobals());

describe("createId", () => {
  it("uses randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(createId()).toBe("uuid-1");
  });

  it("falls back without randomUUID, e.g. over plain http", () => {
    vi.stubGlobal("crypto", {});
    const first = createId();
    const second = createId();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
