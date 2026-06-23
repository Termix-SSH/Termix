import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  guacLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { GuacamoleTokenService } = await import("./token-service.js");

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
});
