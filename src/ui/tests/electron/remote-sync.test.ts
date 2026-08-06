import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { SYNCED_ENTITY_TYPES } =
  require("../../../../electron/remote-sync-entities.cjs") as {
    SYNCED_ENTITY_TYPES: readonly string[];
  };

describe("desktop remote sync entities", () => {
  it("includes user preferences", () => {
    expect(SYNCED_ENTITY_TYPES).toContain("userPreferences");
  });
});
