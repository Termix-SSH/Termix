import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLocalAdaptivePreferences,
  getLocalPreference,
  LOCAL_ADAPTIVE_PREFERENCES_KEY,
  recordLocalPreference,
} from "../../lib/local-adaptive-preferences";

describe("local adaptive preferences", () => {
  beforeEach(() => localStorage.removeItem(LOCAL_ADAPTIVE_PREFERENCES_KEY));

  it("keeps the fallback until local evidence is strong enough", () => {
    recordLocalPreference("host-action:1", "files", 1_000);
    recordLocalPreference("host-action:1", "files", 1_001);

    expect(
      getLocalPreference(
        "host-action:1",
        ["terminal", "files"],
        "terminal",
        1_002,
      ),
    ).toBe("terminal");

    recordLocalPreference("host-action:1", "files", 1_003);
    expect(
      getLocalPreference(
        "host-action:1",
        ["terminal", "files"],
        "terminal",
        1_004,
      ),
    ).toBe("files");
  });

  it("uses decayed local counts and ignores unavailable actions", () => {
    const month = 30 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 8; i++) {
      recordLocalPreference("host-action:1", "docker", i);
    }
    for (let i = 0; i < 4; i++) {
      recordLocalPreference("host-action:1", "files", month + i);
    }

    expect(
      getLocalPreference(
        "host-action:1",
        ["terminal", "files"],
        "terminal",
        month + 10,
      ),
    ).toBe("files");
  });

  it("persists only aggregate local action statistics", () => {
    recordLocalPreference("host-action:42", "terminal", 10);

    const stored = JSON.parse(
      localStorage.getItem(LOCAL_ADAPTIVE_PREFERENCES_KEY) ?? "{}",
    );
    expect(stored).toEqual({
      version: 1,
      scopes: {
        "host-action:42": {
          actions: {
            terminal: {
              weight: 1,
              updatedAt: 10,
              observations: 0,
              successes: 0,
              cancellations: 0,
              fallbacks: 0,
            },
          },
          updatedAt: 10,
        },
      },
    });
  });

  it("recovers from malformed local data and can be reset", () => {
    localStorage.setItem(
      LOCAL_ADAPTIVE_PREFERENCES_KEY,
      JSON.stringify({ version: 1, scopes: { broken: "raw input" } }),
    );

    expect(
      getLocalPreference("broken", ["terminal", "files"], "terminal", 10),
    ).toBe("terminal");
    recordLocalPreference("host-action:1", "files", 11);
    clearLocalAdaptivePreferences();
    expect(localStorage.getItem(LOCAL_ADAPTIVE_PREFERENCES_KEY)).toBeNull();
  });
});
