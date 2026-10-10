import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initialPluginState,
  onboardingDefaults,
  resetBundledIndexCache,
} from "../../plugins/bundled-index.js";

let dir: string;

function writeIndex(plugins: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "bundled-index.json"),
    JSON.stringify({ version: 1, plugins }),
  );
  resetBundledIndexCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-bundled-index-"));
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = dir;
  resetBundledIndexCache();
});

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.ELECTRON_EMBEDDED;
  delete process.env.TEST_SSO_CLIENT;
  fs.rmSync(dir, { recursive: true, force: true });
  resetBundledIndexCache();
});

describe("onboardingDefaults", () => {
  it("treats everything as recommended without an index", () => {
    expect(onboardingDefaults("anything")).toEqual({
      recommended: true,
      consent: false,
    });
  });

  it("reads recommended and consent from the index", () => {
    writeIndex({
      kept: { onboarding: { recommended: true, consent: false } },
      ask: { onboarding: { recommended: true, consent: true } },
    });
    expect(onboardingDefaults("kept")).toEqual({
      recommended: true,
      consent: false,
    });
    expect(onboardingDefaults("ask").consent).toBe(true);
    expect(onboardingDefaults("other")).toEqual({
      recommended: false,
      consent: false,
    });
  });

  it("recommends desktop-only plugins in the desktop app only", () => {
    writeIndex({ desk: { onboarding: { recommended: "desktop" } } });
    expect(onboardingDefaults("desk").recommended).toBe(false);
    process.env.ELECTRON_EMBEDDED = "true";
    expect(onboardingDefaults("desk").recommended).toBe(true);
  });
});

describe("enabledByEnv", () => {
  it("recommends a plugin once its environment config is set", () => {
    writeIndex({
      sso: { onboarding: { enabledByEnv: ["TEST_SSO_CLIENT"] } },
    });
    expect(onboardingDefaults("sso").recommended).toBe(false);
    expect(initialPluginState("sso", "bundled", true)).toBe("disabled");
    process.env.TEST_SSO_CLIENT = "  ";
    expect(onboardingDefaults("sso").recommended).toBe(false);
    process.env.TEST_SSO_CLIENT = "termix";
    expect(onboardingDefaults("sso").recommended).toBe(true);
    expect(initialPluginState("sso", "bundled", true)).toBe("enabled");
  });
});

describe("initialPluginState", () => {
  beforeEach(() => {
    writeIndex({
      kept: { onboarding: { recommended: true } },
      ask: { onboarding: { recommended: true, consent: true } },
    });
  });

  it("enables every bundled plugin on an existing install", () => {
    expect(initialPluginState("other", "bundled", false)).toBe("enabled");
    expect(initialPluginState("ask", "bundled", false)).toBe("enabled");
  });

  it("enables only recommended, non-consent plugins on a fresh install", () => {
    expect(initialPluginState("kept", "bundled", true)).toBe("enabled");
    expect(initialPluginState("ask", "bundled", true)).toBe("disabled");
    expect(initialPluginState("other", "bundled", true)).toBe("disabled");
  });

  it("never enables a plugin dropped into the data directory", () => {
    expect(initialPluginState("kept", "user", true)).toBe("disabled");
    expect(initialPluginState("kept", "user", false)).toBe("disabled");
  });
});
