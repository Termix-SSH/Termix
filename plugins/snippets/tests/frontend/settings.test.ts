import { describe, expect, it } from "vitest";
import { readSnippetSettings } from "../../src/frontend/settings";

describe("readSnippetSettings", () => {
  it("falls back to the manifest defaults", () => {
    expect(readSnippetSettings({})).toEqual({
      foldersCollapsed: true,
      showCommands: true,
      confirmExecution: false,
    });
  });

  it("reads saved values", () => {
    expect(
      readSnippetSettings({
        foldersCollapsed: false,
        showCommands: false,
        confirmExecution: true,
      }),
    ).toEqual({
      foldersCollapsed: false,
      showCommands: false,
      confirmExecution: true,
    });
  });
});
