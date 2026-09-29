import { describe, expect, it } from "vitest";
import {
  hasSshOptions,
  parseSshOptions,
  sshOptionsForWrite,
} from "../../hosts/ssh-options.js";

describe("parseSshOptions", () => {
  it("keeps the connection options, typed, and drops everything else", () => {
    expect(
      parseSshOptions(
        JSON.stringify({
          keepaliveInterval: "30",
          keepaliveCountMax: 3,
          allowLegacyAlgorithms: false,
          agentSocketPath: "/run/agent",
          agentIdentity: null,
          agentForwarding: true,
          environmentVariables: [{ key: "A", value: 1 }, null],
          theme: "nord",
          cfAccessClientId: "gone",
        }),
      ),
    ).toEqual({
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      allowLegacyAlgorithms: false,
      agentSocketPath: "/run/agent",
      agentIdentity: null,
      agentForwarding: true,
      environmentVariables: [{ key: "A", value: "1" }],
    });
  });

  it("reads twice-stringified rows and ignores garbage", () => {
    expect(
      parseSshOptions(JSON.stringify(JSON.stringify({ keepaliveInterval: 5 }))),
    ).toEqual({ keepaliveInterval: 5 });
    expect(parseSshOptions("nope")).toEqual({});
    expect(parseSshOptions(null)).toEqual({});
    expect(parseSshOptions([1])).toEqual({});
  });

  it("says whether a value carries any option", () => {
    expect(hasSshOptions({ theme: "nord" })).toBe(false);
    expect(hasSshOptions({ agentForwarding: false })).toBe(true);
  });
});

describe("sshOptionsForWrite", () => {
  it("stores the payload's own options", () => {
    expect(
      sshOptionsForWrite({ sshOptions: { keepaliveInterval: 9, junk: 1 } }),
    ).toBe(JSON.stringify({ keepaliveInterval: 9 }));
    expect(sshOptionsForWrite({ sshOptions: null })).toBeNull();
  });

  it("takes them from a 2.8 terminalConfig when the payload has none", () => {
    expect(
      sshOptionsForWrite({
        terminalConfig: { keepaliveCountMax: 2, theme: "nord" },
      }),
    ).toBe(JSON.stringify({ keepaliveCountMax: 2 }));
  });

  it("leaves the column alone when neither carries any", () => {
    expect(sshOptionsForWrite({ terminalConfig: { theme: "nord" } })).toBe(
      undefined,
    );
    expect(sshOptionsForWrite({})).toBeUndefined();
  });
});
