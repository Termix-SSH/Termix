import { describe, expect, it } from "vitest";
import { startablePluginIds } from "../../plugins/boot-state.js";

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
