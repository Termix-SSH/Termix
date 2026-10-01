import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildRdpFile, validateNativeRdpOptions } =
  require("../../../../electron/native-rdp.cjs") as {
    buildRdpFile: (options: Record<string, unknown>) => string;
    validateNativeRdpOptions: (options: Record<string, unknown>) => unknown;
  };

describe("native Windows RDP", () => {
  it("creates a credential-prompting RDP file without a password", () => {
    const result = buildRdpFile({
      host: "server.example.com",
      port: 3390,
      username: "alice",
      domain: "EXAMPLE",
      password: "must-not-be-written",
    });

    expect(result).toContain("full address:s:server.example.com:3390");
    expect(result).toContain("username:s:EXAMPLE\\alice");
    expect(result).toContain("prompt for credentials:i:1");
    expect(result).not.toContain("must-not-be-written");
  });

  it("rejects unsafe host and port values", () => {
    expect(() =>
      validateNativeRdpOptions({ host: "bad\r\nvalue" }),
    ).not.toThrow();
    expect(() => validateNativeRdpOptions({ host: "server/path" })).toThrow();
    expect(() =>
      validateNativeRdpOptions({ host: "server", port: 70000 }),
    ).toThrow();
  });
});
