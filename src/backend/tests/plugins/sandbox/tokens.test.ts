/**
 * Actor tokens: a sandboxed plugin can only act as a user core minted a live
 * token for, on its own channel.
 */
import { describe, expect, it } from "vitest";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";

describe("SandboxTokenStore", () => {
  it("resolves a token to the user it was minted for", () => {
    const store = new SandboxTokenStore();
    const token = store.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "request",
    });
    expect(store.resolve(token, "docker")?.userId).toBe("alice");
  });

  it("refuses a token minted for another plugin", () => {
    const store = new SandboxTokenStore();
    const token = store.mint({
      pluginId: "snippets",
      userId: "admin",
      kind: "request",
    });
    expect(store.resolve(token, "docker")).toBeNull();
  });

  it("refuses an unknown or guessed token", () => {
    const store = new SandboxTokenStore();
    store.mint({ pluginId: "docker", userId: "admin", kind: "request" });
    expect(store.resolve("admin", "docker")).toBeNull();
    expect(store.resolve(undefined, "docker")).toBeNull();
  });

  it("refuses a token after it expires or is revoked", () => {
    let now = 1000;
    const store = new SandboxTokenStore({ now: () => now, ttlMs: 50 });
    const expiring = store.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "request",
    });
    now += 51;
    expect(store.resolve(expiring, "docker")).toBeNull();

    const revoked = store.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "socket",
    });
    store.revoke(revoked);
    expect(store.resolve(revoked, "docker")).toBeNull();
  });

  it("drops every token of a plugin whose process went away", () => {
    const store = new SandboxTokenStore();
    const a = store.mint({ pluginId: "docker", userId: "a", kind: "request" });
    const b = store.mint({
      pluginId: "snippets",
      userId: "b",
      kind: "request",
    });
    store.revokePlugin("docker");
    expect(store.resolve(a, "docker")).toBeNull();
    expect(store.resolve(b, "snippets")?.userId).toBe("b");
  });

  it("mints tokens that do not repeat", () => {
    const store = new SandboxTokenStore();
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(store.mint({ pluginId: "p", userId: "u", kind: "request" }));
    }
    expect(seen.size).toBe(1000);
  });
});
