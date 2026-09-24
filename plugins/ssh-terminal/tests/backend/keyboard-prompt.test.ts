import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PluginKeyboardInteractiveDecision,
  PluginKeyboardInteractivePrompt,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import { SSHAuthManager } from "../../src/backend/keyboard-prompt.js";

/**
 * Stands in for core's classifier (ctx.ssh.classifyKeyboardInteractive),
 * which core's own tests cover. These tests are about what the terminal does
 * with each decision: the socket messages, the answers and the timeouts.
 */
const PASSWORD = /password/i;
const FORTI = /type\s+['"]?push['"]?/i;
const PUSH =
  /choose.*push.*totp|press enter.*(push|send)|push notification|authentication by phone/i;
const TOTP =
  /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i;

function classify(
  round: {
    name: string;
    instructions: string;
    prompts: PluginKeyboardInteractivePrompt[];
  },
  host: PluginSshHost,
): PluginKeyboardInteractiveDecision {
  if (/warpgate/i.test(round.name)) {
    return {
      kind: "warpgate",
      url: round.instructions.match(/https?:\/\/\S+/)?.[0] ?? null,
      securityKey: round.instructions.match(/Security key: (\S+)/)?.[1] ?? "",
      instructions: round.instructions,
    };
  }
  const texts = round.prompts.map((p) => p.prompt);
  const isPush =
    !texts.some((t) => FORTI.test(t)) && texts.some((t) => PUSH.test(t));
  if (!isPush) {
    const totp = round.prompts.findIndex((p) => TOTP.test(p.prompt));
    if (totp !== -1) return { kind: "totp", promptIndex: totp };
  }
  const stored = !!host.password && host.authType !== "none";
  const first = round.prompts.findIndex(
    (p) => !(PASSWORD.test(p.prompt) && stored),
  );
  if (first === -1) {
    return {
      kind: "auto",
      responses: round.prompts.map((p) =>
        PASSWORD.test(p.prompt) ? String(host.password) : "",
      ),
    };
  }
  return { kind: "input", promptIndex: first, isPush: PUSH.test(texts[first]) };
}

const log = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createManager() {
  const sent: Record<string, unknown>[] = [];
  const ws = { send: (data: string) => sent.push(JSON.parse(data)) } as any;
  const manager = new SSHAuthManager({
    ssh: { classifyKeyboardInteractive: classify },
    log,
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

  it("routes a FortiToken prompt to the totp flow instead of the push-confirm flow", () => {
    const { manager, sent } = createManager();
    const finish = vi.fn();

    manager.handleKeyboardInteractive(
      "",
      "",
      "",
      [
        {
          prompt:
            "Enter your Token or type 'push' to receive a push notification: ",
          echo: true,
        },
      ],
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
      {
        type: "totp_required",
        prompt:
          "Enter your Token or type 'push' to receive a push notification: ",
      },
    ]);

    manager.context.keyboardInteractiveFinish?.(["push"]);

    expect(finish).toHaveBeenCalledWith(["push"]);
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
