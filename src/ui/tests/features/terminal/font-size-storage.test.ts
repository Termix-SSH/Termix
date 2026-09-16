import { beforeEach, describe, expect, it } from "vitest";
import {
  fontSizeStorageKey,
  readFontSize,
  saveFontSize,
} from "@/features/terminal/font-size-storage";

beforeEach(() => localStorage.clear());
describe("persistent terminal zoom", () => {
  it("survives repeated mounts and option refreshes", () => {
    const key = fontSizeStorageKey("host-sync-id");
    saveFontSize(localStorage, key, 14, 18);
    for (let mount = 0; mount < 3; mount++)
      expect(readFontSize(localStorage, key, 14)).toBe(18);
  });
  it("invalidates an override when defaults change while unmounted", () => {
    const key = fontSizeStorageKey(1);
    saveFontSize(localStorage, key, 14, 18);
    expect(readFontSize(localStorage, key, 16)).toBeNull();
    expect(readFontSize(localStorage, key, 14)).toBeNull();
  });
  it("does not share storage for missing host identities", () => {
    const key = fontSizeStorageKey(undefined);
    saveFontSize(localStorage, key, 14, 18);
    expect(readFontSize(localStorage, key, 14)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
  it("ignores legacy values without a known configured size", () => {
    localStorage.setItem("legacy", "18");
    expect(readFontSize(localStorage, "legacy", 14)).toBeNull();
  });
});
