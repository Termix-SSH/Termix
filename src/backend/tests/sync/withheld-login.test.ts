import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentials = vi.hoisted(() => new Map<number, unknown>());
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentCredentialRepository: () => ({
    findById: async (id: number) => credentials.get(id) ?? null,
  }),
}));

const { isWithheldShare, sharedLoginWithheld } =
  await import("../../sync/withheld-login.js");

const withheld = JSON.stringify({
  permissionLevel: "use",
  secretWithheld: true,
});

beforeEach(() => {
  vi.stubEnv("ELECTRON_EMBEDDED", "true");
  credentials.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("withheld shared logins", () => {
  it("reads the flag from a shared copy", () => {
    expect(isWithheldShare(withheld)).toBe(true);
    expect(isWithheldShare(JSON.stringify({ permissionLevel: "manage" }))).toBe(
      false,
    );
    expect(isWithheldShare("not json")).toBe(false);
    expect(isWithheldShare(null)).toBe(false);
  });

  it("refuses a withheld host copy with no login of its own", async () => {
    expect(
      await sharedLoginWithheld({
        authType: "password",
        sharedSource: withheld,
      }),
    ).toBe(true);
    expect(
      await sharedLoginWithheld({
        authType: "password",
        sharedSource: withheld,
        password: "device login",
      }),
    ).toBe(false);
    expect(
      await sharedLoginWithheld({ authType: "none", sharedSource: withheld }),
    ).toBe(false);
  });

  it("refuses an own host that uses a withheld credential", async () => {
    credentials.set(4, { id: 4, sharedSource: withheld });
    expect(
      await sharedLoginWithheld({ authType: "credential", credentialId: 4 }),
    ).toBe(true);
  });

  it("never refuses on a server", async () => {
    vi.stubEnv("ELECTRON_EMBEDDED", "");
    expect(
      await sharedLoginWithheld({
        authType: "password",
        sharedSource: withheld,
      }),
    ).toBe(false);
  });
});
