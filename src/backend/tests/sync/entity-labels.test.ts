import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

vi.mock("../../database/db/index.js", () => ({}));

import { registerCoreSyncEntities } from "../../sync/entities.js";
import {
  listEntityTypes,
  resetSyncRegistry,
} from "../../plugins/sync-registry.js";

afterEach(() => resetSyncRegistry());

describe("core sync entities", () => {
  it("each has a label in the Sync panel", () => {
    registerCoreSyncEntities();
    const en = JSON.parse(
      fs.readFileSync(
        new URL("../../../ui/locales/en.json", import.meta.url),
        "utf8",
      ),
    );
    const missing = listEntityTypes().filter((type) => !en.sync.entities[type]);
    expect(missing).toEqual([]);
  });
});
