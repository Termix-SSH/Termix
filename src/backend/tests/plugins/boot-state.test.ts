import { describe, expect, it } from "vitest";
import {
  missingShippedPluginIds,
  startablePluginIds,
} from "../../plugins/boot-state.js";

describe("startablePluginIds", () => {
  it("starts enabled plugins and retries ones that failed or were blocked", () => {
    const ids = startablePluginIds([
      { id: "a", state: "enabled" },
      { id: "b", state: "failed" },
      { id: "c", state: "blocked" },
      { id: "d", state: "disabled" },
      { id: "e", state: "pending" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("missingShippedPluginIds", () => {
  const records = [
    { id: "gone", tier: "bundled", state: "enabled" },
    { id: "here", tier: "bundled", state: "enabled" },
    { id: "off", tier: "bundled", state: "disabled" },
    { id: "failed", tier: "bundled", state: "failed" },
    { id: "community", tier: "community", state: "enabled" },
    { id: "removed", tier: "bundled", state: "enabled" },
  ];

  it("lists shipped plugins that are on but not in the image", () => {
    expect(
      missingShippedPluginIds(records, new Set(["here"]), new Set(["removed"])),
    ).toEqual(["failed", "gone"]);
  });

  it("finds nothing when every plugin is present", () => {
    const present = new Set(records.map((record) => record.id));
    expect(missingShippedPluginIds(records, present, new Set())).toEqual([]);
  });
});
