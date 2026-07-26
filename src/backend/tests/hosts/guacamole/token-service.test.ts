import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  guacLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { GuacamoleTokenService } =
  await import("../../../hosts/guacamole/token-service.js");

describe("GuacamoleTokenService", () => {
  const tokenService = GuacamoleTokenService.getInstance();

  it("disables RDP pre-authentication when no credentials are configured", () => {
    const token = tokenService.createRdpToken("windows.example.test", "", "");
    const decrypted = tokenService.decryptToken(token);

    expect(decrypted?.connection.settings).toMatchObject({
      hostname: "windows.example.test",
      port: 3389,
      "ignore-cert": true,
      "disable-auth": true,
    });
    expect(decrypted?.connection.settings.username).toBeUndefined();
    expect(decrypted?.connection.settings.password).toBeUndefined();
  });

  it("keeps normal RDP credential authentication unchanged", () => {
    const token = tokenService.createRdpToken(
      "windows.example.test",
      "Administrator",
      "secret",
    );
    const decrypted = tokenService.decryptToken(token);

    expect(decrypted?.connection.settings).toMatchObject({
      hostname: "windows.example.test",
      username: "Administrator",
      password: "secret",
      port: 3389,
    });
    expect(decrypted?.connection.settings["disable-auth"]).toBeUndefined();
  });

  it("preserves recording metadata outside guacd connection settings", () => {
    const recording = {
      hostId: 42,
      userId: "user-1",
      protocol: "vnc" as const,
      path: "recording.guac",
      startedAt: "2026-07-14T00:00:00.000Z",
    };
    const token = tokenService.createVncToken(
      "vnc.example.test",
      "user",
      "secret",
      {},
      recording,
    );

    expect(tokenService.decryptToken(token)?.recording).toEqual(recording);
  });

  it("preserves termixMeta through the encrypt/decrypt round trip", () => {
    const termixMeta = {
      termixConnectId: "connect-1",
      hostId: 7,
      ownerUserId: "user-1",
      protocol: "rdp" as const,
    };
    const token = tokenService.createRdpToken(
      "windows.example.test",
      "Administrator",
      "secret",
      {},
      undefined,
      termixMeta,
    );

    expect(tokenService.decryptToken(token)?.termixMeta).toEqual(termixMeta);
  });

  it("createJoinToken sets connection.join, not connection.type", () => {
    const token = tokenService.createJoinToken("guacd-conn-123", true);
    const decrypted = tokenService.decryptToken(token);

    expect(decrypted?.connection.join).toBe("guacd-conn-123");
    expect(decrypted?.connection.type).toBeUndefined();
    expect(decrypted?.connection.readOnly).toBe(true);
  });

  it("createJoinToken round-trips a read-write join through decryptToken", () => {
    const token = tokenService.createJoinToken("guacd-conn-456", false);
    const decrypted = tokenService.decryptToken(token);

    expect(decrypted?.connection.join).toBe("guacd-conn-456");
    expect(decrypted?.connection.readOnly).toBe(false);
    expect(decrypted?.recording).toBeUndefined();
  });
});
