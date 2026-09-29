import { describe, expect, it } from "vitest";
import {
  createHostSettingsSync,
  hostImportNormalizer,
  hostPayloadLegacy,
} from "../../src/backend/host-import.js";

describe("hostImportNormalizer", () => {
  it("reads a 2.8 export's quick actions and startup snippet", () => {
    expect(
      hostImportNormalizer({
        quickActions: [
          { name: "Restart", snippetId: "3" },
          { name: "Broken", snippetId: "" },
        ],
        terminalConfig: JSON.stringify({ startupSnippetId: 5, fontSize: 12 }),
      }),
    ).toEqual({
      quickActions: [{ name: "Restart", snippetId: 3 }],
      startupSnippetId: 5,
    });
  });

  it("leaves an export that carries this plugin's settings to core", () => {
    expect(
      hostImportNormalizer({
        pluginSettings: { snippets: { startupSnippetId: 1 } },
        terminalConfig: { startupSnippetId: 5 },
      }),
    ).toBeNull();
  });

  it("writes nothing for a host without either", () => {
    expect(hostImportNormalizer({ name: "web" })).toBeNull();
  });
});

describe("hostPayloadLegacy", () => {
  it("puts the 2.8 fields back for older clients", () => {
    expect(
      hostPayloadLegacy({
        quickActions: [{ name: "Up", snippetId: 2 }],
        startupSnippetId: 7,
      }),
    ).toEqual({
      quickActions: [{ name: "Up", snippetId: 2 }],
      terminalConfig: { startupSnippetId: 7 },
    });
    expect(hostPayloadLegacy({})).toEqual({ quickActions: [] });
  });
});

describe("hostSettingsSync", () => {
  const sync = createHostSettingsSync({
    findSyncIdById: async (id) => (id === 2 ? "sync-2" : null),
    findIdBySyncId: async (syncId) => (syncId === "sync-2" ? 9 : null),
  });

  it("sends sync ids and drops what does not map", async () => {
    expect(await sync.exportValue("startupSnippetId", 2)).toBe("sync-2");
    expect(await sync.exportValue("startupSnippetId", 4)).toBeNull();
    expect(
      await sync.exportValue("quickActions", [
        { name: "A", snippetId: 2 },
        { name: "B", snippetId: 4 },
      ]),
    ).toEqual([{ name: "A", snippetId: "sync-2" }]);
  });

  it("maps sync ids back to this side's rows", async () => {
    expect(await sync.importValue("startupSnippetId", "sync-2")).toBe(9);
    expect(await sync.importValue("startupSnippetId", "missing")).toBeNull();
    expect(
      await sync.importValue("quickActions", [
        { name: "A", snippetId: "sync-2" },
      ]),
    ).toEqual([{ name: "A", snippetId: 9 }]);
  });
});
