import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  readStatusColorScheme,
  useStatusColorScheme,
  getStatusClasses,
} from "../../hooks/use-status-color-scheme";

const PREFS_KEY = "hostSidebarPreferences";

function writePrefs(scheme: string) {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ display: { statusColorScheme: scheme } }),
  );
}

describe("readStatusColorScheme", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to accent when nothing is cached", () => {
    expect(readStatusColorScheme()).toBe("accent");
  });

  it("reads the scheme out of the sidebar preferences cache", () => {
    writePrefs("status");
    expect(readStatusColorScheme()).toBe("status");
  });

  it("falls back to accent on malformed cache", () => {
    localStorage.setItem(PREFS_KEY, "not json");
    expect(readStatusColorScheme()).toBe("accent");
  });
});

describe("useStatusColorScheme", () => {
  beforeEach(() => localStorage.clear());

  it("picks up the cached scheme on mount", () => {
    writePrefs("status");
    const { result } = renderHook(() => useStatusColorScheme());
    expect(result.current).toBe("status");
  });

  it("updates when the sidebar preferences change event fires", () => {
    const { result } = renderHook(() => useStatusColorScheme());
    expect(result.current).toBe("accent");

    act(() => {
      writePrefs("status");
      window.dispatchEvent(new Event("hostSidebarPreferencesChanged"));
    });

    expect(result.current).toBe("status");
  });
});

describe("getStatusClasses", () => {
  it("uses green/red for the status scheme", () => {
    expect(getStatusClasses(true, "status", "dot")).toContain("emerald");
    expect(getStatusClasses(false, "status", "dot")).toContain("red");
  });

  it("uses the accent color for the accent scheme", () => {
    expect(getStatusClasses(true, "accent", "dot")).toContain("accent-brand");
  });
});
