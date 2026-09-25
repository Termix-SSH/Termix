/**
 * A display token is the only credential on the public /display socket, so
 * it has to be one this server minted, unedited and recent.
 */

import { describe, expect, it } from "vitest";
import {
  GuacamoleTokenService,
  TOKEN_TTL_MS,
  isServerOwnedSetting,
} from "../../src/backend/token-service.js";

process.env.JWT_SECRET = "remote-desktop-test-secret";

function decode(token: string) {
  return JSON.parse(Buffer.from(token, "base64").toString("utf8")) as {
    iv: string;
    value: string;
    mac: string;
  };
}

function encode(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

describe("verifyToken", () => {
  it("accepts a fresh token it minted", () => {
    const tokens = new GuacamoleTokenService();
    const token = tokens.createRdpToken("10.0.0.7", "admin", "secret");
    expect(tokens.verifyToken(token)?.connection.settings.hostname).toBe(
      "10.0.0.7",
    );
  });

  it("refuses an edited ciphertext or IV", () => {
    const tokens = new GuacamoleTokenService();
    const data = decode(tokens.createRdpToken("10.0.0.7", "admin", "secret"));
    const iv = Buffer.from(data.iv, "base64");
    iv[0] ^= 0xff;
    expect(
      tokens.verifyToken(encode({ ...data, iv: iv.toString("base64") })),
    ).toBeNull();
    expect(
      tokens.verifyToken(encode({ ...data, value: `A${data.value.slice(1)}` })),
    ).toBeNull();
  });

  it("refuses a token with no MAC, as guacamole-lite alone would accept", () => {
    const tokens = new GuacamoleTokenService();
    const { iv, value } = decode(tokens.createRdpToken("h", "u", "p"));
    expect(tokens.verifyToken(encode({ iv, value }))).toBeNull();
  });

  it("refuses a token once it is older than the TTL", () => {
    let now = 1_000_000;
    const tokens = new GuacamoleTokenService(undefined, () => now);
    const token = tokens.createJoinToken("session-1", true);
    now += TOKEN_TTL_MS - 1;
    expect(tokens.verifyToken(token)).not.toBeNull();
    now += 2;
    expect(tokens.verifyToken(token)).toBeNull();
  });

  it("refuses garbage", () => {
    const tokens = new GuacamoleTokenService();
    expect(tokens.verifyToken("not-a-token")).toBeNull();
    expect(tokens.verifyToken(encode({ iv: 1 }))).toBeNull();
  });
});

describe("isServerOwnedSetting", () => {
  it.each([
    "guacdHost",
    "guacdPort",
    "drive-path",
    "create-drive-path",
    "recording-path",
    "recording-name",
    "create-recording-path",
    "typescript-path",
    "sftp-private-key-path",
  ])("keeps %s for the server", (key) => {
    expect(isServerOwnedSetting(key)).toBe(true);
  });

  it.each(["width", "security", "ignore-cert", "color-depth", "enable-drive"])(
    "lets a caller set %s",
    (key) => {
      expect(isServerOwnedSetting(key)).toBe(false);
    },
  );
});
