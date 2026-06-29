import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAccess = vi.fn();

vi.mock("fs/promises", () => ({
  access: mockAccess,
}));

import { applyAgentAuth, resolveAgentSocket } from "./terminal-auth-helpers.js";

describe("resolveAgentSocket", () => {
  const originalEnv = process.env.SSH_AUTH_SOCK;
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockAccess.mockReset();
    delete process.env.SSH_AUTH_SOCK;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SSH_AUTH_SOCK = originalEnv;
    } else {
      delete process.env.SSH_AUTH_SOCK;
    }
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("uses explicit socket path from terminalConfig over SSH_AUTH_SOCK", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-env/agent.123";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({
      agentSocketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    });

    expect(result).toEqual({
      socketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    });
    expect(mockAccess).toHaveBeenCalledWith(
      "/run/user/1000/gnupg/S.gpg-agent.ssh",
    );
  });

  it("falls back to SSH_AUTH_SOCK when no explicit path is provided", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.456";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({});

    expect(result).toEqual({ socketPath: "/tmp/ssh-XXXX/agent.456" });
  });

  it("falls back to SSH_AUTH_SOCK when agentSocketPath is empty string", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.789";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({ agentSocketPath: "  " });

    expect(result).toEqual({ socketPath: "/tmp/ssh-XXXX/agent.789" });
  });

  it("reads agent socket path from serialized terminal config", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket(
      JSON.stringify({ agentSocketPath: "/tmp/serialized-agent.sock" }),
    );

    expect(result).toEqual({ socketPath: "/tmp/serialized-agent.sock" });
  });

  it("returns error for invalid serialized terminal config", async () => {
    const result = await resolveAgentSocket("{");

    expect(result).toEqual({
      error: "Invalid terminal configuration for SSH agent auth.",
    });
  });

  it("returns error when neither SSH_AUTH_SOCK nor explicit path is set", async () => {
    const result = await resolveAgentSocket({});

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("SSH_AUTH_SOCK");
  });

  it("returns error when terminalConfig is undefined and SSH_AUTH_SOCK is not set", async () => {
    const result = await resolveAgentSocket(undefined);

    expect(result).toHaveProperty("error");
  });

  it("returns error on non-Windows when socket file is missing", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/missing-agent.sock";
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveAgentSocket({});

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      "/tmp/missing-agent.sock",
    );
  });

  it("skips file existence check on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.SSH_AUTH_SOCK = "\\\\.\\pipe\\openssh-ssh-agent";

    const result = await resolveAgentSocket({});

    expect(result).toEqual({
      socketPath: "\\\\.\\pipe\\openssh-ssh-agent",
    });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("attaches an ssh2 agent to a connect config", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockAccess.mockResolvedValue(undefined);
    const config: Record<string, unknown> = {};

    const result = await applyAgentAuth(config, {
      agentSocketPath: "/tmp/ssh-agent.sock",
    });

    expect(result).toEqual({ socketPath: "/tmp/ssh-agent.sock" });
    expect(config.agent).toBeDefined();
  });
});
