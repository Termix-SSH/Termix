/**
 * Keyboard-interactive answering over the terminal WebSocket.
 *
 * The classifier decides what a round is; this keeps the terminal's message
 * protocol (totp_required, totp_retry, password_required,
 * warpgate_auth_required) and its timeouts exactly as the client expects.
 */

import type { WebSocket } from "ws";
import { sshLogger, authLogger } from "../../utils/logger.js";
import { ensureCoreSshAuthProviders } from "./core-providers.js";
import {
  classifyKeyboardInteractive,
  responsesWithAnswer,
} from "./keyboard-interactive.js";
import type { KeyboardInteractivePrompt, SshConnectHost } from "./types.js";

interface ResolvedCredentials {
  username: string;
  password?: string;
  authType?: string;
}

interface HostFlags {
  useWarpgate?: boolean;
  [key: string]: unknown;
}

interface AuthContext {
  userId: string;
  ws: WebSocket;
  hostId: number;
  isKeyboardInteractive: boolean;
  keyboardInteractiveResponded: boolean;
  keyboardInteractiveFinish: ((responses: string[]) => void) | null;
  totpPromptSent: boolean;
  warpgateAuthPromptSent: boolean;
  totpTimeout: NodeJS.Timeout | null;
  warpgateAuthTimeout: NodeJS.Timeout | null;
  totpAttempts: number;
}

const TOTP_TIMEOUT_MS = 180000;
const PUSH_TIMEOUT_MS = 300000;
const WARPGATE_TIMEOUT_MS = 300000;

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
    ensureCoreSshAuthProviders();
    this.context.isKeyboardInteractive = true;

    const host = {
      ...(hostConfig ?? {}),
      id: this.context.hostId,
      ip: "",
      port: 22,
      username: resolvedCredentials.username,
      password: resolvedCredentials.password,
      authType: resolvedCredentials.authType,
    } as SshConnectHost;

    const decision = classifyKeyboardInteractive(
      { name, instructions, prompts },
      host,
    );

    switch (decision.kind) {
      case "auto":
        finish(decision.responses);
        return;
      case "warpgate":
        this.handleWarpgate(decision, finish);
        return;
      case "totp":
        this.handleTotp(prompts, decision.promptIndex, finish, host.password);
        return;
      case "input":
        this.handleInput(
          prompts,
          decision.promptIndex,
          decision.isPush,
          finish,
          host.password,
        );
        return;
    }
  }

  private handleWarpgate(
    decision: { url: string | null; securityKey: string; instructions: string },
    finish: (responses: string[]) => void,
  ): void {
    this.context.keyboardInteractiveFinish = () => {
      finish([""]);
    };
    this.context.warpgateAuthPromptSent = true;
    this.sendLog("auth", "info", "Warpgate authentication required");
    this.context.ws.send(
      JSON.stringify({
        type: "warpgate_auth_required",
        url: decision.url,
        securityKey: decision.securityKey,
        instructions: decision.instructions,
      }),
    );

    this.context.warpgateAuthTimeout = setTimeout(() => {
      if (this.context.keyboardInteractiveFinish) {
        this.context.keyboardInteractiveFinish = null;
        this.context.warpgateAuthPromptSent = false;
        sshLogger.warn("Warpgate authentication timeout", {
          operation: "warpgate_timeout",
          hostId: this.context.hostId,
        });
        this.context.ws.send(
          JSON.stringify({
            type: "error",
            message: "Warpgate authentication timeout. Please reconnect.",
          }),
        );
      }
    }, WARPGATE_TIMEOUT_MS);
  }

  private handleTotp(
    prompts: KeyboardInteractivePrompt[],
    promptIndex: number,
    finish: (responses: string[]) => void,
    password: string | undefined,
  ): void {
    if (this.context.totpPromptSent) {
      sshLogger.warn("TOTP prompt asked again - invalid code", {
        operation: "ssh_keyboard_interactive_totp_retry",
        hostId: this.context.hostId,
      });
      authLogger.warn("TOTP verification failed for SSH session", {
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
    authLogger.info("TOTP verification prompt sent to client", {
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
      sshLogger.warn(
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
    if (this.context.warpgateAuthTimeout) {
      clearTimeout(this.context.warpgateAuthTimeout);
      this.context.warpgateAuthTimeout = null;
    }
    this.context.keyboardInteractiveFinish = null;
    this.context.totpPromptSent = false;
    this.context.warpgateAuthPromptSent = false;
    this.context.keyboardInteractiveResponded = false;
  }
}
