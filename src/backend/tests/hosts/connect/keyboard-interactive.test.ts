/**
 * The keyboard-interactive classifier with handlers that answer later (a
 * plugin process) next to ones that answer at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerKeyboardInteractiveInterceptor,
  resetSshAuthRegistryForTests,
} from "../../../hosts/connect/auth-provider-registry.js";
import {
  classifyKeyboardInteractive,
  classifyKeyboardInteractiveNow,
  createPromptKeyboardInteractiveHandler,
} from "../../../hosts/connect/keyboard-interactive.js";
import type { SshConnectHost } from "../../../hosts/connect/types.js";

const host = {
  id: 1,
  ip: "10.0.0.1",
  port: 22,
  username: "me",
  password: "pw",
  authType: "password",
} as unknown as SshConnectHost;

const browserRound = {
  name: "Warpgate authentication",
  instructions: "open https://wg/x",
  prompts: [{ prompt: "Press enter", echo: true }],
};

afterEach(() => {
  resetSshAuthRegistryForTests();
  vi.useRealTimers();
});

describe("classifyKeyboardInteractive", () => {
  it("answers at once when no handler is remote", () => {
    const decision = classifyKeyboardInteractive(
      { name: "", instructions: "", prompts: [{ prompt: "Password:" }] },
      host,
    );
    expect(decision).toEqual({ kind: "auto", responses: ["pw"] });
  });

  it("waits for a remote handler's answer", async () => {
    registerKeyboardInteractiveInterceptor({
      id: "wg",
      pluginId: "warpgate",
      remote: true,
      detect: async () => ({
        kind: "browser",
        id: "wg",
        label: "Warpgate",
        url: "https://wg/x",
        code: "abcd",
        instructions: "",
      }),
    });
    const result = classifyKeyboardInteractive(browserRound, host);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toMatchObject({
      kind: "browser",
      url: "https://wg/x",
    });
  });

  it("falls through when a remote handler says no or is too slow", async () => {
    vi.useFakeTimers();
    registerKeyboardInteractiveInterceptor({
      id: "slow",
      pluginId: "p",
      remote: true,
      detect: () => new Promise(() => {}),
    });
    const pending = classifyKeyboardInteractive(
      {
        name: "",
        instructions: "",
        prompts: [{ prompt: "Verification code:" }],
      },
      host,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ kind: "totp", promptIndex: 0 });
  });

  it("awaits a remote auto answer for passwords", async () => {
    registerKeyboardInteractiveInterceptor({
      id: "wg",
      pluginId: "warpgate",
      remote: true,
      detect: async () => null,
      autoAnswerPasswords: async () => true,
    });
    const passwordless = { ...host, password: null } as SshConnectHost;
    expect(
      await classifyKeyboardInteractive(
        { name: "", instructions: "", prompts: [{ prompt: "Password:" }] },
        passwordless,
      ),
    ).toEqual({ kind: "auto", responses: [""] });
  });

  it("leaves remote handlers out of the answer given at once", () => {
    const detect = vi.fn(async () => null);
    registerKeyboardInteractiveInterceptor({
      id: "wg",
      pluginId: "warpgate",
      remote: true,
      detect,
    });
    expect(classifyKeyboardInteractiveNow(browserRound, host)).toMatchObject({
      kind: "input",
    });
    expect(detect).not.toHaveBeenCalled();
  });
});

describe("prompt handler", () => {
  it("asks the channel with a remote handler's browser round", async () => {
    registerKeyboardInteractiveInterceptor({
      id: "wg",
      pluginId: "warpgate",
      remote: true,
      detect: async () => ({
        kind: "browser",
        id: "wg",
        label: "Warpgate",
        url: "https://wg/x",
        code: "abcd",
        instructions: "",
      }),
    });
    const ask = vi.fn(async () => null);
    const listener = createPromptKeyboardInteractiveHandler(host, { ask });
    const responses = await new Promise<string[]>((resolve) =>
      listener("n", "i", "", browserRound.prompts, resolve),
    );
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "browser", url: "https://wg/x" }),
    );
    expect(responses).toEqual([""]);
  });
});
