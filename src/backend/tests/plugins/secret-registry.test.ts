/**
 * Cross-plugin secret references: the permission gate, the two null cases, and
 * what an uninstall does to a borrower still pointing at the provider.
 *
 * The distinction under test throughout is between a denial (an error, because
 * the caller asked for something it may not have) and an absence (null, because
 * the thing legitimately is not there). A consumer that cannot tell those apart
 * would read "you may not" as "not configured" and fall back to something
 * weaker, so every case below asserts which of the two it got.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const {
  clearSecretRegistry,
  getSecretRegistration,
  listSecrets,
  offerSecret,
  readSharedSecret,
  resolveSecretRequirements,
  withdrawAllForPlugin,
  withdrawSecret,
  PluginSecretActorError,
  PluginSecretPermissionError,
  PluginSecretUndeclaredError,
} = await import("../../plugins/secret-registry.js");

const PROVIDER = "ai-assistant";
const KEY = "api-key";
const PERMISSION = "ai.secrets.share";
const SECRET = "sk-live-value";

/** Permissions the acting user currently holds. Mutated mid-test. */
let granted = new Set<string>();
let auditEntries: Array<Record<string, unknown>> = [];

function offer(overrides: Partial<Parameters<typeof offerSecret>[0]> = {}) {
  return offerSecret({
    pluginId: PROVIDER,
    pluginName: "AI Assistant",
    key: KEY,
    permission: PERMISSION,
    resolve: () => SECRET,
    ...overrides,
  });
}

/** A consumer manifest declaring the reference, as the real one would. */
function consumer(
  requiresSecret: Array<{ plugin: string; key: string; optional?: boolean }> = [
    { plugin: PROVIDER, key: KEY, optional: true },
  ],
) {
  return { id: "reporting-plugin", requiresSecret } as never;
}

function context(userId: string | undefined) {
  return {
    resolveUserId: () => userId,
    hasPermission: async (_userId: string, permission: string) =>
      granted.has(permission),
    audit: (entry: Record<string, unknown>) => {
      auditEntries.push(entry);
    },
  } as never;
}

function read(
  manifest = consumer(),
  userId: string | undefined = "user-1",
  providerPluginId = PROVIDER,
  key = KEY,
) {
  return readSharedSecret(manifest, providerPluginId, key, context(userId));
}

/**
 * A read with no acting user. Separate from read() on purpose: a default
 * parameter cannot express this, since passing undefined explicitly would
 * just fall back to the default and quietly test the wrong thing.
 */
function readAnonymously(manifest = consumer()) {
  return readSharedSecret(manifest, PROVIDER, KEY, context(undefined));
}

describe("shared secret registry", () => {
  beforeEach(() => {
    clearSecretRegistry();
    granted = new Set([PERMISSION]);
    auditEntries = [];
  });
  afterEach(() => clearSecretRegistry());

  describe("registration", () => {
    it("round-trips an offer", () => {
      const registration = offer();

      expect(getSecretRegistration(PROVIDER, KEY)).toBe(registration);
      expect(listSecrets()).toHaveLength(1);
      expect(registration.generation).toBeGreaterThan(0);
    });

    it("keys offers by plugin as well as name", () => {
      offer();
      offer({ pluginId: "other-plugin", resolve: () => "other-value" });

      expect(listSecrets()).toHaveLength(2);
      expect(getSecretRegistration("other-plugin", KEY)?.pluginId).toBe(
        "other-plugin",
      );
    });

    it("only withdraws the offer that is actually current", () => {
      const first = offer();
      const second = offer();

      // A crashed-and-restarted provider must not withdraw the replacement its
      // own restart installed.
      expect(withdrawSecret(PROVIDER, KEY, first)).toBe(false);
      expect(getSecretRegistration(PROVIDER, KEY)).toBe(second);

      expect(withdrawSecret(PROVIDER, KEY, second)).toBe(true);
      expect(getSecretRegistration(PROVIDER, KEY)).toBeUndefined();
    });

    it("reports a withdraw of something never offered", () => {
      expect(withdrawSecret(PROVIDER, "nothing")).toBe(false);
    });
  });

  describe("reading", () => {
    it("resolves for a user who holds the permission", async () => {
      offer();

      await expect(read()).resolves.toBe(SECRET);
    });

    it("denies a user without the permission, though the secret exists", async () => {
      offer();
      granted = new Set();

      // The whole point of the per-call check: the plugin is installed, the
      // key is set, and this user still gets nothing.
      await expect(read()).rejects.toBeInstanceOf(PluginSecretPermissionError);
      expect(getSecretRegistration(PROVIDER, KEY)).toBeDefined();
    });

    it("denies with the 403 shape a route can pass straight through", async () => {
      offer();
      granted = new Set();

      const error = await read().catch((caught) => caught);

      expect(error.status).toBe(403);
      expect(error.body).toEqual({
        error: "Insufficient permissions",
        required: PERMISSION,
      });
    });

    it("never runs the provider's resolver for a denied read", async () => {
      const resolve = vi.fn(() => SECRET);
      offer({ resolve });
      granted = new Set();

      await expect(read()).rejects.toBeInstanceOf(PluginSecretPermissionError);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("returns null when the provider is installed but the key is not set", async () => {
      offer({ resolve: () => null });

      // Absence, not denial: the user may read it, there is just nothing there.
      await expect(read()).resolves.toBeNull();
    });

    it("treats an empty string as not set", async () => {
      offer({ resolve: () => "" });

      await expect(read()).resolves.toBeNull();
    });

    it("returns null when the providing plugin is not installed at all", async () => {
      await expect(read()).resolves.toBeNull();
    });

    it("gives the same answer for absent and unset, so neither leaks install state", async () => {
      const unset = await read();
      offer({ resolve: () => null });
      const absent = await read();

      expect(unset).toBeNull();
      expect(absent).toBeNull();
    });

    it("refuses a plugin reading something its manifest never declared", async () => {
      offer();

      await expect(read(consumer([]), "user-1")).rejects.toBeInstanceOf(
        PluginSecretUndeclaredError,
      );
    });

    it("refuses a declared reference to a different key on the same plugin", async () => {
      offer();

      await expect(
        read(consumer([{ plugin: PROVIDER, key: "other-key" }])),
      ).rejects.toBeInstanceOf(PluginSecretUndeclaredError);
    });

    it("refuses a read that cannot be attributed to a user", async () => {
      offer();

      await expect(readAnonymously()).rejects.toBeInstanceOf(
        PluginSecretActorError,
      );
    });

    it("returns null for an anonymous read of an absent provider", async () => {
      // Absence is settled before the actor is, so a borrower whose provider
      // is gone gets the same null whether or not it had a user to act as.
      await expect(readAnonymously()).resolves.toBeNull();
    });

    it("passes the acting user to the resolver, so per-user keys stay per-user", async () => {
      const resolve = vi.fn((userId: string) => `key-for-${userId}`);
      offer({ resolve });

      await expect(read(consumer(), "user-7")).resolves.toBe("key-for-user-7");
      expect(resolve).toHaveBeenCalledWith("user-7");
    });

    it("propagates a resolver failure rather than reporting it as unset", async () => {
      offer({
        resolve: () => {
          throw new Error("vault unreachable");
        },
      });

      // Reported as null, a consumer would fall back to a weaker path on what
      // is actually a transient provider fault.
      await expect(read()).rejects.toThrow("vault unreachable");
    });
  });

  describe("revocation takes effect immediately", () => {
    it("stops resolving the moment the permission is revoked", async () => {
      offer();
      await expect(read()).resolves.toBe(SECRET);

      granted = new Set();

      // No restart, no reinstall: the next call is already denied.
      await expect(read()).rejects.toBeInstanceOf(PluginSecretPermissionError);
    });

    it("serves the rotated value on the next read, with nothing to invalidate", async () => {
      let current = SECRET;
      offer({ resolve: () => current });

      await expect(read()).resolves.toBe(SECRET);
      current = "sk-live-rotated";
      await expect(read()).resolves.toBe("sk-live-rotated");
    });

    it("nulls out a borrower's reference when the provider clears the secret", async () => {
      let current: string | null = SECRET;
      offer({ resolve: () => current });

      await expect(read()).resolves.toBe(SECRET);
      current = null;
      await expect(read()).resolves.toBeNull();
    });
  });

  describe("uninstalling the provider", () => {
    it("nulls out the reference rather than leaving a dangling handle", async () => {
      offer();
      await expect(read()).resolves.toBe(SECRET);

      expect(withdrawAllForPlugin(PROVIDER)).toBe(1);

      // The borrower is still installed, still declares the reference, and
      // still holds the permission. It simply gets null now, the same answer
      // as a provider that was never installed -- no throw, no stale value.
      await expect(read()).resolves.toBeNull();
      expect(getSecretRegistration(PROVIDER, KEY)).toBeUndefined();
    });

    it("keeps no copy of the value behind after an uninstall", async () => {
      const resolve = vi.fn(() => SECRET);
      offer({ resolve });
      await read();
      resolve.mockClear();

      withdrawAllForPlugin(PROVIDER);

      // Nothing cached the earlier read: the answer comes from the absence of
      // a registration, not from a remembered value.
      await expect(read()).resolves.toBeNull();
      expect(resolve).not.toHaveBeenCalled();
    });

    it("withdraws every key the plugin offered, not just the one read", () => {
      offer();
      offer({ key: "webhook-secret" });
      offer({ pluginId: "unrelated-plugin" });

      expect(withdrawAllForPlugin(PROVIDER)).toBe(2);
      expect(listSecrets()).toHaveLength(1);
      expect(getSecretRegistration("unrelated-plugin", KEY)).toBeDefined();
    });

    it("starts working again if the provider is reinstalled, with no borrower restart", async () => {
      offer();
      withdrawAllForPlugin(PROVIDER);
      await expect(read()).resolves.toBeNull();

      offer({ resolve: () => "sk-live-reinstalled" });

      await expect(read()).resolves.toBe("sk-live-reinstalled");
    });
  });

  describe("requirement resolution", () => {
    it("reports an offered reference as available", () => {
      offer();

      const resolution = resolveSecretRequirements(consumer());

      expect(resolution.available).toEqual([`${PROVIDER}:${KEY}`]);
      expect(resolution.unavailable).toEqual([]);
      expect(resolution.errors).toEqual([]);
    });

    it("reports an absent optional reference without an error", () => {
      const resolution = resolveSecretRequirements(consumer());

      expect(resolution.unavailable).toEqual([`${PROVIDER}:${KEY}`]);
      expect(resolution.errors).toEqual([]);
    });

    it("reports an absent required reference as an error", () => {
      const resolution = resolveSecretRequirements(
        consumer([{ plugin: PROVIDER, key: KEY }]),
      );

      expect(resolution.errors).toHaveLength(1);
      expect(resolution.errors[0]).toContain(PROVIDER);
    });

    it("ignores any user's permissions, because activation is per-instance", () => {
      offer();
      granted = new Set();

      // A user without the grant must get a clear denial from the call, not a
      // plugin that mysteriously refuses to start.
      expect(resolveSecretRequirements(consumer()).available).toHaveLength(1);
    });

    it("is empty for a manifest that borrows nothing", () => {
      const resolution = resolveSecretRequirements({ id: "plain" } as never);

      expect(resolution.available).toEqual([]);
      expect(resolution.unavailable).toEqual([]);
      expect(resolution.errors).toEqual([]);
    });
  });

  describe("audit", () => {
    it("records an allowed read without the value", async () => {
      offer();
      await read();

      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]).toMatchObject({
        userId: "user-1",
        consumerPluginId: "reporting-plugin",
        providerPluginId: PROVIDER,
        key: KEY,
        success: true,
        resolved: true,
      });
      expect(JSON.stringify(auditEntries[0])).not.toContain(SECRET);
    });

    it("records a denial", async () => {
      offer();
      granted = new Set();
      await read().catch(() => undefined);

      expect(auditEntries[0]).toMatchObject({
        success: false,
        resolved: false,
      });
    });

    it("distinguishes an allowed read that found nothing", async () => {
      offer({ resolve: () => null });
      await read();

      expect(auditEntries[0]).toMatchObject({ success: true, resolved: false });
    });

    it("writes nothing when the provider is not installed", async () => {
      await read();

      // There is no provider to attribute the read to, and no decision was
      // made about the user -- an audit line here would be noise.
      expect(auditEntries).toEqual([]);
    });
  });
});
