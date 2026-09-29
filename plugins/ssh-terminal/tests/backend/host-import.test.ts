import { describe, expect, it } from "vitest";
import {
  hostImportNormalizer,
  hostPayloadLegacy,
} from "../../src/backend/host-import";

describe("hostImportNormalizer", () => {
  it("reads a 2.8 export's terminalConfig into the host settings", () => {
    expect(
      hostImportNormalizer({
        enableTerminal: false,
        terminalConfig: {
          fontSize: 16,
          autoTmux: true,
          keepaliveInterval: 30,
          startupSnippetId: 2,
        },
      }),
    ).toEqual({
      enableTerminal: false,
      inheritAppearance: false,
      fontSize: 16,
      autoTmux: true,
    });
  });

  it("reads the raw JSON a SQLite export carries", () => {
    expect(
      hostImportNormalizer({
        terminalConfig: JSON.stringify({ localEcho: "on" }),
      }),
    ).toEqual({ localEcho: "on" });
  });

  it("leaves terminalConfig alone when the export carries the plugin's own values", () => {
    expect(
      hostImportNormalizer({
        pluginSettings: { "ssh-terminal": { autoTmux: false } },
        terminalConfig: { autoTmux: true },
      }),
    ).toBeNull();
  });

  it("imports nothing from a row without terminal values", () => {
    expect(hostImportNormalizer({ name: "x" })).toBeNull();
  });
});

describe("hostPayloadLegacy", () => {
  it("puts the settings back in the 2.8 terminalConfig shape", () => {
    const { terminalConfig } = hostPayloadLegacy({
      autoTmux: true,
      inheritAppearance: true,
      fontSize: 20,
    }) as { terminalConfig: Record<string, unknown> };
    expect(terminalConfig.autoTmux).toBe(true);
    expect(terminalConfig).not.toHaveProperty("fontSize");
    expect(terminalConfig).not.toHaveProperty("localEcho");
  });

  it("includes the look of a host that has its own", () => {
    const { terminalConfig } = hostPayloadLegacy({
      inheritAppearance: false,
      fontSize: 20,
    }) as { terminalConfig: Record<string, unknown> };
    expect(terminalConfig.fontSize).toBe(20);
    expect(terminalConfig.theme).toBe("termix");
  });
});
