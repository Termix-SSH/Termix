import { describe, expect, it, vi } from "vitest";
import {
  createAiGate,
  isAiGloballyEnabled,
  readPrivateAllowlist,
  resolveAiAccess,
} from "../../src/backend/gating.js";
import { DEFAULT_PRIVATE_ALLOWLIST } from "../../src/backend/egress.js";

/** The plugin's settings as ctx.settings reads them: admin, then per user. */
function settings(
  admin: Record<string, unknown>,
  user: Record<string, unknown> = {},
) {
  return {
    get: vi.fn(async (key: string) => admin[key]) as never,
    getUser: vi.fn(async (_userId: string, key: string) => user[key]) as never,
  };
}

describe("AI gating", () => {
  it("is off until an admin turns it on, so an upgrade enables nothing", async () => {
    expect(await isAiGloballyEnabled(settings({}))).toBe(false);
    expect(await isAiGloballyEnabled(settings({ globallyEnabled: true }))).toBe(
      true,
    );
  });

  it("blocks everyone when the admin switch is off", async () => {
    const reader = settings(
      { globallyEnabled: false },
      { enabled: true, allowReadOnlyCommands: true },
    );

    const access = await resolveAiAccess(reader, "user-1");

    expect(access).toEqual({ enabled: false, allowReadOnlyCommands: false });
    // The kill switch short-circuits, so the user's choice is never read.
    expect(reader.getUser).not.toHaveBeenCalled();
  });

  it("treats a user who never chose as not enabled", async () => {
    const access = await resolveAiAccess(
      settings({ globallyEnabled: true }),
      "user-1",
    );
    expect(access.enabled).toBe(false);
  });

  it("allows only when both gates are open", async () => {
    const access = await resolveAiAccess(
      settings(
        { globallyEnabled: true },
        { enabled: true, allowReadOnlyCommands: true },
      ),
      "user-1",
    );
    expect(access).toEqual({ enabled: true, allowReadOnlyCommands: true });
  });

  it("keeps read-only commands off unless separately opted in", async () => {
    const access = await resolveAiAccess(
      settings({ globallyEnabled: true }, { enabled: true }),
      "user-1",
    );
    expect(access.allowReadOnlyCommands).toBe(false);
  });

  it("reads the private endpoint list, with defaults when unset", async () => {
    expect(await readPrivateAllowlist(settings({}))).toEqual(
      DEFAULT_PRIVATE_ALLOWLIST,
    );
    expect(
      await readPrivateAllowlist(
        settings({ privateEndpoints: "ollama.lan\n10.0.0.5" }),
      ),
    ).toEqual(["ollama.lan", "10.0.0.5"]);
  });
});

describe("createAiGate", () => {
  function response() {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        res.statusCode = code;
        return { json: (body: unknown) => (res.body = body) };
      },
    };
    return res;
  }

  it("answers 401 without a user and 403 while the assistant is off", async () => {
    const next = vi.fn();
    const noUser = response();
    await createAiGate(settings({ globallyEnabled: true }), () => undefined)(
      {},
      noUser,
      next,
    );
    expect(noUser.statusCode).toBe(401);

    const off = response();
    await createAiGate(settings({ globallyEnabled: false }), () => "user-1")(
      {},
      off,
      next,
    );
    expect(off.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes an opted-in user through with their access attached", async () => {
    const next = vi.fn();
    const req: { aiAccess?: unknown } = {};
    await createAiGate(
      settings({ globallyEnabled: true }, { enabled: true }),
      () => "user-1",
    )(req, response(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.aiAccess).toEqual({
      enabled: true,
      allowReadOnlyCommands: false,
    });
  });
});
