import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isUserDataUnlocked: vi.fn(),
}));

vi.mock("../../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    isUserDataUnlocked: mocks.isUserDataUnlocked,
  },
}));

const { applyHostEnrollmentDefaults, requireHostEnrollmentAccessForPath } =
  await import("../../../database/routes/host-enrollment-auth.js");

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

describe("requireHostEnrollmentAccessForPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUserDataUnlocked.mockReturnValue(true);
  });

  it("accepts an API key scoped to an unlocked user", () => {
    const res = response();
    const next = vi.fn();

    requireHostEnrollmentAccessForPath(
      { path: "/enroll", userId: "user-1", apiKeyId: "key-1" } as never,
      res as never,
      next,
    );

    expect(mocks.isUserDataUnlocked).toHaveBeenCalledWith("user-1");
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects regular JWT sessions", () => {
    const res = response();
    const next = vi.fn();

    requireHostEnrollmentAccessForPath(
      { path: "/enroll", userId: "user-1" } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Host enrollment requires an API key",
      code: "API_KEY_REQUIRED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("reports locked encrypted data explicitly", () => {
    mocks.isUserDataUnlocked.mockReturnValue(false);
    const res = response();
    const next = vi.fn();

    requireHostEnrollmentAccessForPath(
      { path: "/enroll", userId: "user-1", apiKeyId: "key-1" } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json).toHaveBeenCalledWith({
      error: "User data is locked. Sign in before enrolling hosts.",
      code: "DATA_LOCKED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("leaves the existing host route unchanged", () => {
    const res = response();
    const next = vi.fn();

    requireHostEnrollmentAccessForPath(
      { path: "/db/host", userId: "user-1" } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.isUserDataUnlocked).not.toHaveBeenCalled();
  });
});

describe("applyHostEnrollmentDefaults", () => {
  it("creates a usable SSH host from a minimal enrollment payload", () => {
    expect(applyHostEnrollmentDefaults({ ip: "server.example" })).toEqual({
      connectionType: "ssh",
      ip: "server.example",
      port: 22,
      authType: "none",
      enableTerminal: true,
      enableSsh: true,
    });
  });

  it("preserves explicit enrollment settings", () => {
    expect(
      applyHostEnrollmentDefaults({
        ip: "server.example",
        port: 2222,
        authType: "password",
        enableTerminal: false,
      }),
    ).toMatchObject({
      port: 2222,
      authType: "password",
      enableTerminal: false,
    });
  });
});
