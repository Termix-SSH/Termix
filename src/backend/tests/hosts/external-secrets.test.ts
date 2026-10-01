import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearExternalSecretCache,
  isSecretReference,
  resolveExternalSecretRefs,
  resolveSecretReference,
} = await import("../../hosts/external-secrets.js");
const { setSecretResolverOwnerSource, resetSecretResolverRegistryForTests } =
  await import("../../hosts/connect/secret-resolver-registry.js");

describe("isSecretReference", () => {
  it("recognises a scheme:// reference without confusing it with a secret", () => {
    expect(isSecretReference("op://v/i/f")).toBe(true);
    expect(isSecretReference("  op://v/i/f")).toBe(true);
    expect(isSecretReference("vault+https://x")).toBe(true);
    expect(isSecretReference("hunter2")).toBe(false);
    expect(isSecretReference(undefined)).toBe(false);
  });
});

describe("external secret references", () => {
  beforeEach(() => clearExternalSecretCache());

  it("replaces references in the host's secret fields and leaves plain secrets alone", async () => {
    const resolver = vi.fn(
      async (_userId: string, ref: string) => `resolved:${ref}`,
    );
    const host: Record<string, unknown> = {
      password: "op://Infra/box/password",
      key: "-----BEGIN OPENSSH PRIVATE KEY-----",
      sudoPassword: "op://Infra/box/sudo",
      username: "op://not-a-secret-field",
    };
    await resolveExternalSecretRefs(host, "alice", { resolver });
    expect(host.password).toBe("resolved:op://Infra/box/password");
    expect(host.sudoPassword).toBe("resolved:op://Infra/box/sudo");
    expect(host.key).toBe("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(host.username).toBe("op://not-a-secret-field");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("caches a resolved reference per user for a minute", async () => {
    const resolver = vi.fn(async () => "s3cret");
    let clock = 1_000_000;
    const deps = { resolver, now: () => clock };
    await resolveSecretReference("alice", "op://v/i/f", deps);
    await resolveSecretReference("alice", "op://v/i/f", deps);
    expect(resolver).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await resolveSecretReference("alice", "op://v/i/f", deps);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when no plugin resolves the scheme", async () => {
    await expect(
      resolveSecretReference("bob", "op://v/i/f", {}),
    ).rejects.toThrow(/needs the .* plugin|no enabled plugin resolves/);
  });

  it("names the plugin that would resolve a disabled scheme", async () => {
    setSecretResolverOwnerSource(() => [
      {
        scheme: "op",
        pluginId: "secret-sources",
        pluginName: "Secret Sources",
      },
    ]);
    try {
      await expect(
        resolveSecretReference("bob", "op://v/i/f", {}),
      ).rejects.toThrow("needs the Secret Sources plugin");
    } finally {
      resetSecretResolverRegistryForTests();
    }
  });
});
