import { describe, expect, it, vi, beforeEach } from "vitest";

const authApiMock = vi.hoisted(() => ({
  get: vi.fn(async () => ({ data: {} })),
  post: vi.fn(async () => ({ data: {} })),
  delete: vi.fn(async () => ({ data: { success: true } })),
}));

const browserMock = vi.hoisted(() => ({
  startAuthentication: vi.fn(async () => ({ id: "cred-1" })),
  startRegistration: vi.fn(async () => ({ id: "cred-1" })),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

vi.mock("@/main-axios", () => ({
  authApi: authApiMock,
  handleApiError: (error: unknown) => error,
}));

vi.mock("@simplewebauthn/browser", () => browserMock);

import { isPasskeySupported, loginWithPasskey } from "../../api/webauthn-api";

beforeEach(() => {
  authApiMock.get.mockClear();
  authApiMock.post.mockClear();
  authApiMock.delete.mockClear();
  browserMock.startAuthentication.mockClear();
  browserMock.browserSupportsWebAuthn.mockClear();
});

describe("isPasskeySupported", () => {
  it("reports what the browser helper returns", () => {
    browserMock.browserSupportsWebAuthn.mockReturnValueOnce(false);
    expect(isPasskeySupported()).toBe(false);
    browserMock.browserSupportsWebAuthn.mockReturnValueOnce(true);
    expect(isPasskeySupported()).toBe(true);
  });
});

describe("loginWithPasskey", () => {
  it("passes the challenge from options through to verify", async () => {
    authApiMock.post
      .mockResolvedValueOnce({
        data: { options: { challenge: "abc" }, challengeId: "chal-1" },
      })
      .mockResolvedValueOnce({ data: { success: true, username: "luke" } });

    const result = await loginWithPasskey("luke", true);

    expect(authApiMock.post).toHaveBeenNthCalledWith(
      1,
      "/users/webauthn/authenticate/options",
      { username: "luke" },
    );
    expect(browserMock.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "abc" },
    });
    expect(authApiMock.post).toHaveBeenNthCalledWith(
      2,
      "/users/webauthn/authenticate/verify",
      {
        challengeId: "chal-1",
        response: { id: "cred-1" },
        rememberMe: true,
      },
    );
    expect(result).toEqual({ success: true, username: "luke" });
  });

  it("omits the username so discoverable passkeys work", async () => {
    authApiMock.post
      .mockResolvedValueOnce({
        data: { options: { challenge: "abc" }, challengeId: "chal-2" },
      })
      .mockResolvedValueOnce({ data: { success: true } });

    await loginWithPasskey();

    expect(authApiMock.post).toHaveBeenNthCalledWith(
      1,
      "/users/webauthn/authenticate/options",
      {},
    );
    expect(authApiMock.post).toHaveBeenNthCalledWith(
      2,
      "/users/webauthn/authenticate/verify",
      expect.objectContaining({ rememberMe: false }),
    );
  });

  it("returns the totp challenge instead of a session", async () => {
    authApiMock.post
      .mockResolvedValueOnce({
        data: { options: { challenge: "abc" }, challengeId: "chal-3" },
      })
      .mockResolvedValueOnce({
        data: { success: true, requires_totp: true, temp_token: "tmp" },
      });

    const result = await loginWithPasskey("luke");

    expect(result.requires_totp).toBe(true);
    expect(result.temp_token).toBe("tmp");
  });

  it("surfaces a cancelled prompt to the caller", async () => {
    authApiMock.post.mockResolvedValueOnce({
      data: { options: { challenge: "abc" }, challengeId: "chal-4" },
    });
    const cancelled = Object.assign(new Error("cancelled"), {
      name: "NotAllowedError",
    });
    browserMock.startAuthentication.mockRejectedValueOnce(cancelled);

    await expect(loginWithPasskey("luke")).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(authApiMock.post).toHaveBeenCalledTimes(1);
  });
});
