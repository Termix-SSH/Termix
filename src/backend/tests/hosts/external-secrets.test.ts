import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSecretSourceRepository: () => ({
    listVisibleToUser: async () => [],
    decryptToken: () => "",
  }),
  createCurrentSettingsRepository: () => ({ get: async () => null }),
}));

const {
  clearExternalSecretCache,
  resolveExternalSecretRefs,
  resolveSecretReference,
} = await import("../../hosts/external-secrets.js");

const source = {
  id: "src-1",
  userId: "alice",
  name: "1P",
  kind: "onepassword-connect",
  baseUrl: "https://connect.internal",
  token: "enc",
  shared: false,
  createdAt: "",
  updatedAt: "",
};

describe("external secret references", () => {
  beforeEach(() => clearExternalSecretCache());

  it("replaces references in the host's secret fields and leaves plain secrets alone", async () => {
    const resolver = vi.fn(async (_s, ref: string) => `resolved:${ref}`);
    const host: Record<string, unknown> = {
      password: "op://Infra/box/password",
      key: "-----BEGIN OPENSSH PRIVATE KEY-----",
      sudoPassword: "op://Infra/box/sudo",
      username: "op://not-a-secret-field",
    };
    await resolveExternalSecretRefs(host, "alice", {
      resolver,
      pickSource: async () => source,
    });
    expect(host.password).toBe("resolved:op://Infra/box/password");
    expect(host.sudoPassword).toBe("resolved:op://Infra/box/sudo");
    expect(host.key).toBe("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(host.username).toBe("op://not-a-secret-field");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("caches a resolved reference per source for a minute", async () => {
    const resolver = vi.fn(async () => "s3cret");
    let clock = 1_000_000;
    const deps = { resolver, pickSource: async () => source, now: () => clock };
    await resolveSecretReference("alice", "op://v/i/f", deps);
    await resolveSecretReference("alice", "op://v/i/f", deps);
    expect(resolver).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await resolveSecretReference("alice", "op://v/i/f", deps);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when the user has no secret source", async () => {
    await expect(
      resolveSecretReference("bob", "op://v/i/f", {
        resolver: async () => "x",
        pickSource: async () => null,
      }),
    ).rejects.toThrow(/no secret source/);
  });
});
