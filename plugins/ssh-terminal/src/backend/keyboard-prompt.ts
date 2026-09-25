/**
 * Keyboard-interactive answering over the terminal WebSocket.
 *
 * Core's classifier (ctx.ssh.classifyKeyboardInteractive) decides what a
 * round is; this keeps the terminal's message protocol (totp_required,
 * totp_retry, password_required, "<handler>_auth_required" for a browser
 * sign-in round) and its timeouts exactly as the client expects.
 */

import type { WebSocket } from "ws";
import type {
  PluginBrowserSignInRound,
  PluginKeyboardInteractivePrompt,
  PluginSsh,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import type { TerminalLogger } from "./helpers.js";

type KeyboardInteractivePrompt = PluginKeyboardInteractivePrompt;

const PASSWORD_PATTERN = /password/i;

/** The answer at one index, the stored password for password prompts, else empty. */
export function responsesWithAnswer(
  prompts: KeyboardInteractivePrompt[],
  answerIndex: number,
  answer: string,
  password: string | null | undefined,
): string[] {
  return prompts.map((p, index) => {
    if (index === answerIndex) return answer;
    if (PASSWORD_PATTERN.test(p.prompt) && password) return password;
    return "";
  });
}

interface ResolvedCredentials {
  username: string;
  password?: string;
  authType?: string;
}

interface HostFlags {
  [key: string]: unknown;
}

interface AuthContext {
  ssh: Pick<PluginSsh, "classifyKeyboardInteractive">;
  log: TerminalLogger;
  userId: string;
  ws: WebSocket;
  hostId: number;
  isKeyboardInteractive: boolean;
  keyboardInteractiveResponded: boolean;
  keyboardInteractiveFinish: ((responses: string[]) => void) | null;
  totpPromptSent: boolean;
  /** The handler whose browser round is waiting for "<id>_auth_continue". */
  browserSignInId: string | null;
  totpTimeout: NodeJS.Timeout | null;
  browserSignInTimeout: NodeJS.Timeout | null;
  totpAttempts: number;
}

const TOTP_TIMEOUT_MS = 180000;
const PUSH_TIMEOUT_MS = 300000;
const BROWSER_SIGN_IN_TIMEOUT_MS = 300000;

export class SSHAuthManager {
  public context: AuthContext;

  constructor(context: AuthContext) {
    this.context = context;
  }

  handleKeyboardInteractive(
    name: string,
    instructions: string,
    _instructionsLang: string,
    prompts: KeyboardInteractivePrompt[],
    finish: (responses: string[]) => void,
    resolvedCredentials: ResolvedCredentials,
    hostConfig?: HostFlags,
  ): void {
    this.context.isKeyboardInteractive = true;

    const host = {
      ...(hostConfig ?? {}),
      id: this.context.hostId,
      ip: "",
      port: 22,
      username: resolvedCredentials.username,
      password: resolvedCredentials.password,
      authType: resolvedCredentials.authType,
    } as PluginSshHost;

    const decision = this.context.ssh.classifyKeyboardInteractive(
      { name, instructions, prompts },
      host,
    );

    switch (decision.kind) {
      case "auto":
        finish(decision.responses);
        return;
      case "browser":
        this.handleBrowserSignIn(decision, finish);
        return;
      case "totp":
        this.handleTotp(
          prompts,
          decision.promptIndex,
          finish,
          host.password as string | undefined,
        );
        return;
      case "input":
        this.handleInput(
          prompts,
          decision.promptIndex,
          decision.isPush,
          finish,
          host.password as string | undefined,
        );
        return;
    }
  }

  /**
   * A round finished in a browser. The message is named after the handler
   * that claimed it (Termix-Mobile listens for these names), and the client
   * answers with "<id>_auth_continue".
   */
  private handleBrowserSignIn(
    round: PluginBrowserSignInRound,
    finish: (responses: string[]) => void,
  ): void {
    this.context.keyboardInteractiveFinish = () => {
      finish([""]);
    };
    this.context.browserSignInId = round.id;
    this.sendLog("auth", "info", `${round.label} sign-in required`);
    this.context.ws.send(
      JSON.stringify({
        type: `${round.id}_auth_required`,
        kind: "browser",
        label: round.label,
        url: round.url,
        securityKey: round.code,
        instructions: round.instructions,
      }),
    );

    this.context.browserSignInTimeout = setTimeout(() => {
      if (this.context.keyboardInteractiveFinish) {
        this.context.keyboardInteractiveFinish = null;
        this.context.browserSignInId = null;
        this.context.log.warn("Browser sign-in timeout", {
          operation: "browser_sign_in_timeout",
          handler: round.id,
          hostId: this.context.hostId,
        });
        this.context.ws.send(
          JSON.stringify({
            type: "error",
            message: `${round.label} sign-in timed out. Please reconnect.`,
          }),
        );
      }
    }, BROWSER_SIGN_IN_TIMEOUT_MS);
  }

  private handleTotp(
    prompts: KeyboardInteractivePrompt[],
    promptIndex: number,
    finish: (responses: string[]) => void,
    password: string | undefined,
  ): void {
    if (this.context.totpPromptSent) {
      this.context.log.warn("TOTP prompt asked again - invalid code", {
        operation: "ssh_keyboard_interactive_totp_retry",
        hostId: this.context.hostId,
      });
      this.context.log.warn("TOTP verification failed for SSH session", {
        operation: "terminal_totp_failed",
        userId: this.context.userId,
        hostId: this.context.hostId,
      });
      this.sendLog("auth", "warning", "Invalid TOTP code");
      this.context.ws.send(JSON.stringify({ type: "totp_retry" }));
      return;
    }

    this.context.totpPromptSent = true;
    this.context.keyboardInteractiveResponded = true;
    this.context.keyboardInteractiveFinish = (answers: string[]) => {
      finish(
        responsesWithAnswer(
          prompts,
          promptIndex,
          (answers[0] || "").trim(),
          password,
        ),
      );
    };

    this.armTimeout(TOTP_TIMEOUT_MS, "totp");
    this.sendLog("auth", "info", "TOTP verification required");
    this.context.log.info("TOTP verification prompt sent to client", {
      operation: "terminal_totp_prompt",
      userId: this.context.userId,
      hostId: this.context.hostId,
    });
    this.context.ws.send(
      JSON.stringify({
        type: "totp_required",
        prompt: prompts[promptIndex].prompt,
      }),
    );
  }

  private handleInput(
    prompts: KeyboardInteractivePrompt[],
    promptIndex: number,
    isPush: boolean,
    finish: (responses: string[]) => void,
    password: string | undefined,
  ): void {
    if (this.context.keyboardInteractiveResponded) return;
    this.context.keyboardInteractiveResponded = true;

    this.context.keyboardInteractiveFinish = (answers: string[]) => {
      finish(
        responsesWithAnswer(
          prompts,
          promptIndex,
          (answers[0] || "").trim(),
          password,
        ),
      );
    };

    this.armTimeout(isPush ? PUSH_TIMEOUT_MS : TOTP_TIMEOUT_MS, "password");
    this.sendLog("auth", "info", "Password authentication required");
    this.context.ws.send(
      JSON.stringify({
        type: "password_required",
        prompt: prompts[promptIndex].prompt,
        echo: prompts[promptIndex].echo,
      }),
    );
  }

  private armTimeout(ms: number, kind: "totp" | "password"): void {
    if (this.context.totpTimeout) clearTimeout(this.context.totpTimeout);
    this.context.totpTimeout = setTimeout(() => {
      if (!this.context.keyboardInteractiveFinish) return;
      this.context.keyboardInteractiveFinish = null;
      if (kind === "totp") {
        this.context.totpPromptSent = false;
      } else {
        this.context.keyboardInteractiveResponded = false;
      }
      this.context.log.warn(
        `${kind === "totp" ? "TOTP" : "Password"} prompt timeout`,
        {
          operation: `${kind}_timeout`,
          hostId: this.context.hostId,
        },
      );
      this.context.ws.send(
        JSON.stringify({
          type: "error",
          message:
            kind === "totp"
              ? "TOTP verification timeout. Please reconnect."
              : "Password verification timeout. Please reconnect.",
        }),
      );
    }, ms);
  }

  sendLog(
    stage: string,
    level: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.context.ws.send(
      JSON.stringify({
        type: "connection_log",
        data: { stage, level, message, details },
      }),
    );
  }

  cleanup(): void {
    if (this.context.totpTimeout) {
      clearTimeout(this.context.totpTimeout);
      this.context.totpTimeout = null;
    }
    if (this.context.browserSignInTimeout) {
      clearTimeout(this.context.browserSignInTimeout);
      this.context.browserSignInTimeout = null;
    }
    this.context.keyboardInteractiveFinish = null;
    this.context.totpPromptSent = false;
    this.context.browserSignInId = null;
    this.context.keyboardInteractiveResponded = false;
  }
}
