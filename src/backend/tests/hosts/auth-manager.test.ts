import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findCredentialByIdForUser: async () => null,
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  authLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SSHAuthManager } from "../../hosts/auth-manager.js";

function createManager() {
  const sent: Record<string, unknown>[] = [];
  const ws = { send: (data: string) => sent.push(JSON.parse(data)) } as any;
  const manager = new SSHAuthManager({
    userId: "user-1",
    ws,
    hostId: 1,
    isKeyboardInteractive: false,
    keyboardInteractiveResponded: false,
    keyboardInteractiveFinish: null,
    totpPromptSent: false,
    warpgateAuthPromptSent: false,
    totpTimeout: null,
    warpgateAuthTimeout: null,
    totpAttempts: 0,
  });
  return { manager, sent };
}

describe("SSHAuthManager.handleKeyboardInteractive", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("routes a TOTP verification prompt to the totp flow", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "",
      "",
      "",
      [{ prompt: "Verification code: ", echo: true }],
      finish,
      { username: "root", authType: "none" },
    );

    expect(sent).toEqual([
      {
        type: "connection_log",
        data: {
          stage: "auth",
          level: "info",
          message: "TOTP verification required",
        },
      },
      { type: "totp_required", prompt: "Verification code: " },
    ]);
    expect(finish).not.toHaveBeenCalled();
  });

  it("forwards echo:true for a JumpCloud-style push/TOTP menu prompt", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "",
      "",
      "",
      [{ prompt: "Choose [1] Push, or [2] TOTP: ", echo: true }],
      finish,
      { username: "root", authType: "none" },
    );

    expect(sent).toEqual([
      {
        type: "connection_log",
        data: {
          stage: "auth",
          level: "info",
          message: "Password authentication required",
        },
      },
      {
        type: "password_required",
        prompt: "Choose [1] Push, or [2] TOTP: ",
        echo: true,
      },
    ]);
  });

  it("silently auto-answers a plain password prompt when a stored password exists", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "",
      "",
      "",
      [{ prompt: "Password: ", echo: false }],
      finish,
      { username: "root", password: "hunter2", authType: "password" },
    );

    expect(finish).toHaveBeenCalledWith(["hunter2"]);
    expect(sent).toEqual([]);
  });

  it("prompts the user for a push-confirm prompt and accepts an empty response", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "",
      "",
      "",
      [{ prompt: "Press enter to send Push request: ", echo: true }],
      finish,
      { username: "root", authType: "none" },
    );

    expect(sent).toEqual([
      {
        type: "connection_log",
        data: {
          stage: "auth",
          level: "info",
          message: "Password authentication required",
        },
      },
      {
        type: "password_required",
        prompt: "Press enter to send Push request: ",
        echo: true,
      },
    ]);

    manager.context.keyboardInteractiveFinish?.([""]);

    expect(finish).toHaveBeenCalledWith([""]);
  });

  it("uses a longer timeout for push-style prompts than generic prompts", () => {
    vi.useFakeTimers();
    try {
      const { manager, sent } = createManager();
      const finish = vi.fn();

      manager.handleKeyboardInteractive(
        "",
        "",
        "",
        [{ prompt: "Press enter to send Push request: ", echo: true }],
        finish,
        { username: "root", authType: "none" },
      );

      vi.advanceTimersByTime(180001);
      expect(sent.some((m) => m.type === "error")).toBe(false);

      vi.advanceTimersByTime(120000);
      expect(sent.some((m) => m.type === "error")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes Warpgate prompts to the warpgate flow, not the generic path", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "Warpgate Authentication",
      "Visit https://warpgate.example.com/auth to continue. Security key: AB12",
      "",
      [{ prompt: "Press enter once done: ", echo: true }],
      finish,
      { username: "root", authType: "none" },
    );

    expect(sent).toEqual([
      {
        type: "connection_log",
        data: {
          stage: "auth",
          level: "info",
          message: "Warpgate authentication required",
        },
      },
      {
        type: "warpgate_auth_required",
        url: "https://warpgate.example.com/auth",
        securityKey: "AB12",
        instructions:
          "Visit https://warpgate.example.com/auth to continue. Security key: AB12",
      },
    ]);
  });
});
