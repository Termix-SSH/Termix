import { describe, it, expect } from "vitest";
import { createFakeContext } from "@termix/plugin-sdk/testing";
import { registerTailscaleSshAuth } from "../../src/backend/ssh-auth-provider.js";
import { TAILSCALE_CHECK_TIMEOUT_MS } from "../../src/backend/tailscale-check.js";

function register() {
  const { ctx, auth } = createFakeContext({ pluginId: "tailscale" });
  registerTailscaleSshAuth(ctx);
  return auth.sshAuthProviders.find(
    (provider) => provider.type === "tailscale",
  )!;
}

describe("tailscale SSH auth provider", () => {
  it("registers as type tailscale", () => {
    expect(register()).toBeTruthy();
  });

  it("turns off keyboard-interactive, with a long timeout for the terminal", () => {
    const provider = register();
    const terminal = provider.connectOptions?.(
      { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
      "terminal",
    );
    expect(terminal).toMatchObject({
      tryKeyboard: false,
      readyTimeout: TAILSCALE_CHECK_TIMEOUT_MS,
      timeout: TAILSCALE_CHECK_TIMEOUT_MS,
    });

    const fleet = provider.connectOptions?.(
      { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
      "fleet",
    );
    expect(fleet).toEqual({ tryKeyboard: false });
  });

  it("prepare always reports ready", async () => {
    const provider = register();
    const outcome = await provider.prepare(
      {},
      { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
      {
        client: {},
        userId: "u1",
        hostId: 1,
        purpose: "terminal",
        interactive: true,
        log: () => {},
      },
    );
    expect(outcome).toEqual({ status: "ready" });
  });

  describe("onBanner", () => {
    it("holds the connection when the banner carries a check URL", () => {
      const provider = register();
      const decision = provider.onBanner?.(
        "# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/abc123\n",
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
      );
      expect(decision).toMatchObject({
        action: "hold",
        details: { url: "https://login.tailscale.com/a/abc123" },
      });
    });

    it("releases the hold on the completion banner", () => {
      const provider = register();
      const decision = provider.onBanner?.(
        "Authentication checked with Tailscale SSH.",
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
      );
      expect(decision).toEqual({ action: "release" });
    });

    it("ignores an ordinary MOTD banner", () => {
      const provider = register();
      const decision = provider.onBanner?.(
        "Welcome to Ubuntu 24.04 LTS\n",
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
      );
      expect(decision).toBeUndefined();
    });
  });

  describe("onAuthFailed", () => {
    it("retries once in forced password mode", () => {
      const provider = register();
      const outcome = provider.onAuthFailed?.(
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
        {
          error: new Error("All configured authentication methods failed"),
          retries: 0,
          canRetry: true,
          methodNotAvailable: false,
        },
      );
      expect(outcome).toMatchObject({
        status: "retry",
        patch: { username: "root+password" },
      });
    });

    it("fails after a retry has already happened", () => {
      const provider = register();
      const outcome = provider.onAuthFailed?.(
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
        {
          error: new Error("All configured authentication methods failed"),
          retries: 1,
          canRetry: true,
          methodNotAvailable: false,
        },
      );
      expect(outcome).toMatchObject({ status: "error", code: "failed" });
    });

    it("does nothing for an unrelated failure", () => {
      const provider = register();
      const outcome = provider.onAuthFailed?.(
        { id: 1, ip: "100.1.1.1", port: 22, username: "root" },
        {
          client: {},
          userId: "u1",
          hostId: 1,
          purpose: "terminal",
          interactive: true,
          log: () => {},
        },
        {
          error: new Error("connection reset"),
          retries: 0,
          canRetry: true,
          methodNotAvailable: false,
        },
      );
      expect(outcome).toBeUndefined();
    });
  });
});
