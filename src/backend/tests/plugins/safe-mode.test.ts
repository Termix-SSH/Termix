import { afterEach, describe, expect, it } from "vitest";
import {
  mayRunInSafeMode,
  safeModeOn,
  safeModePluginIds,
} from "../../plugins/safe-mode.js";
import type { PluginManifest } from "../../plugins/manifest.js";

function plugin(id: string, manifest: Partial<PluginManifest> = {}) {
  return { id, manifest: { id, ...manifest } as PluginManifest };
}

const plugins = [
  plugin("layout", {
    contributes: { layouts: [{ id: "classic" }] },
    dependencies: { helper: "^1.0.0" },
  } as Partial<PluginManifest>),
  plugin("themes", {
    contributes: { themes: [{ id: "dark" }] },
  } as Partial<PluginManifest>),
  plugin("helper"),
  plugin("docker"),
];

afterEach(() => {
  delete process.env.TERMIX_SAFE_MODE;
});

describe("safeModeOn", () => {
  it("reads 1 and true, anything else is off", () => {
    expect(safeModeOn()).toBe(false);
    process.env.TERMIX_SAFE_MODE = "1";
    expect(safeModeOn()).toBe(true);
    process.env.TERMIX_SAFE_MODE = " TRUE ";
    expect(safeModeOn()).toBe(true);
    process.env.TERMIX_SAFE_MODE = "0";
    expect(safeModeOn()).toBe(false);
  });
});

describe("safeModePluginIds", () => {
  it("keeps layout and theme plugins and what they depend on", () => {
    expect([...safeModePluginIds(plugins)].sort()).toEqual([
      "helper",
      "layout",
      "themes",
    ]);
  });
});

describe("mayRunInSafeMode", () => {
  it("lets every plugin run when safe mode is off", () => {
    expect(mayRunInSafeMode("docker", plugins)).toBe(true);
  });

  it("only lets look plugins run when safe mode is on", () => {
    process.env.TERMIX_SAFE_MODE = "1";
    expect(mayRunInSafeMode("docker", plugins)).toBe(false);
    expect(mayRunInSafeMode("layout", plugins)).toBe(true);
    expect(mayRunInSafeMode("helper", plugins)).toBe(true);
  });
});
