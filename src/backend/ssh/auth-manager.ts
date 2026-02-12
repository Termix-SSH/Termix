import { Client } from "ssh2";
import type { WebSocket } from "ws";
import { sshLogger, authLogger } from "../utils/logger.js";
import { getDb } from "../database/db/index.js";
import { sshCredentials, sshData } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { UserCrypto } from "../utils/user-crypto.js";

interface ResolvedCredentials {
  username: string;
  password?: string;
  key?: Buffer;
  keyPassword?: string;
  authType?: string;
}

interface HostConfig {
  id: number;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  userId?: string;
  forceKeyboardInteractive?: boolean;
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

const userCrypto = UserCrypto.getInstance();
const MAX_TOTP_ATTEMPTS = 3;

export class SSHAuthManager {
  public context: AuthContext;

  constructor(context: AuthContext) {
    this.context = context;
  }

  async resolveCredentials(
    hostConfig: HostConfig,
  ): Promise<ResolvedCredentials> {
    let resolvedCredentials: ResolvedCredentials = {
      username: hostConfig.username,
      authType: hostConfig.authType || "none",
    };

    if (hostConfig.credentialId) {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, hostConfig.credentialId),
              eq(sshCredentials.userId, this.context.userId),
            ),
          ),
        "ssh_credentials",
        this.context.userId,
      );

      if (credentials.length > 0) {
        const cred = credentials[0];
        resolvedCredentials = {
          username: (cred.username as string) || hostConfig.username,
          password: (cred.password as string) || undefined,
          key: cred.privateKey
            ? Buffer.from(cred.privateKey as string)
            : undefined,
          keyPassword: (cred.passphrase as string) || undefined,
          authType: (cred.authType as string) || "none",
        };
      }
    } else {
      if (hostConfig.password) {
        resolvedCredentials.password = hostConfig.password;
        resolvedCredentials.authType = "password";
      }

      if (hostConfig.key) {
        resolvedCredentials.key = Buffer.from(hostConfig.key, "utf8");
        resolvedCredentials.authType = "key";

        if (hostConfig.keyPassword) {
          resolvedCredentials.keyPassword = hostConfig.keyPassword;
        }
      }
    }

    return resolvedCredentials;
  }

  handleKeyboardInteractive(
    name: string,
    instructions: string,
    instructionsLang: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
    resolvedCredentials: ResolvedCredentials,
  ): void {
    this.context.isKeyboardInteractive = true;
    const promptTexts = prompts.map((p) => p.prompt);

    const warpgatePattern = /warpgate\s+authentication/i;
    const isWarpgate =
      warpgatePattern.test(name) ||
      warpgatePattern.test(instructions) ||
      promptTexts.some((p) => warpgatePattern.test(p));

    if (isWarpgate) {
      this.handleWarpgateAuth(name, instructions, promptTexts, finish);
      return;
    }

    const totpPromptIndex = prompts.findIndex((p) =>
      /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
        p.prompt,
      ),
    );

    if (totpPromptIndex !== -1) {
      this.handleTotpAuth(
        prompts,
        totpPromptIndex,
        finish,
        resolvedCredentials,
      );
      return;
    }

    this.handlePasswordAuth(prompts, finish, resolvedCredentials);
  }

  private handleWarpgateAuth(
    name: string,
    instructions: string,
    promptTexts: string[],
    finish: (responses: string[]) => void,
  ): void {
    const fullText = `${name}\n${instructions}\n${promptTexts.join("\n")}`;

    const urlMatch = fullText.match(/https?:\/\/[^\s\n]+/i);
    const keyMatch = fullText.match(
      /security key[:\s]+([a-z0-9](?:\s+[a-z0-9]){3}|[a-z0-9]{4})/i,
    );

    if (urlMatch) {
      this.context.keyboardInteractiveFinish = (responses: string[]) => {
        finish([""]);
      };

      this.context.warpgateAuthPromptSent = true;

      this.sendLog("auth", "info", "Warpgate authentication required");

      this.context.ws.send(
        JSON.stringify({
          type: "warpgate_auth_required",
          url: urlMatch[0],
          securityKey: keyMatch ? keyMatch[1] : "N/A",
          instructions: instructions,
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
      }, 300000);
    }
  }

  private handleTotpAuth(
    prompts: Array<{ prompt: string; echo: boolean }>,
    totpPromptIndex: number,
    finish: (responses: string[]) => void,
    resolvedCredentials: ResolvedCredentials,
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

      this.context.ws.send(
        JSON.stringify({
          type: "totp_retry",
        }),
      );
      return;
    }

    this.context.totpPromptSent = true;
    this.context.keyboardInteractiveResponded = true;

    this.context.keyboardInteractiveFinish = (totpResponses: string[]) => {
      const totpCode = (totpResponses[0] || "").trim();

      const responses = prompts.map((p, index) => {
        if (index === totpPromptIndex) {
          return totpCode;
        }
        if (/password/i.test(p.prompt) && resolvedCredentials.password) {
          return resolvedCredentials.password;
        }
        return "";
      });

      finish(responses);
    };

    if (this.context.totpTimeout) {
      clearTimeout(this.context.totpTimeout);
    }

    this.context.totpTimeout = setTimeout(() => {
      if (this.context.keyboardInteractiveFinish) {
        this.context.keyboardInteractiveFinish = null;
        this.context.totpPromptSent = false;
        sshLogger.warn("TOTP prompt timeout", {
          operation: "totp_timeout",
          hostId: this.context.hostId,
        });
        this.context.ws.send(
          JSON.stringify({
            type: "error",
            message: "TOTP verification timeout. Please reconnect.",
          }),
        );
      }
    }, 180000);

    this.sendLog("auth", "info", "TOTP verification required");
    authLogger.info("TOTP verification prompt sent to client", {
      operation: "terminal_totp_prompt",
      userId: this.context.userId,
      hostId: this.context.hostId,
    });

    this.context.ws.send(
      JSON.stringify({
        type: "totp_required",
        prompt: prompts[totpPromptIndex].prompt,
      }),
    );
  }

  private handlePasswordAuth(
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
    resolvedCredentials: ResolvedCredentials,
  ): void {
    const hasStoredPassword =
      resolvedCredentials.password && resolvedCredentials.authType !== "none";

    const passwordPromptIndex = prompts.findIndex((p) =>
      /password/i.test(p.prompt),
    );

    if (!hasStoredPassword && passwordPromptIndex !== -1) {
      if (this.context.keyboardInteractiveResponded) {
        return;
      }
      this.context.keyboardInteractiveResponded = true;

      this.context.keyboardInteractiveFinish = (userResponses: string[]) => {
        const userInput = (userResponses[0] || "").trim();

        const responses = prompts.map((p, index) => {
          if (index === passwordPromptIndex) {
            return userInput;
          }
          return "";
        });

        finish(responses);
      };

      if (this.context.totpTimeout) {
        clearTimeout(this.context.totpTimeout);
      }

      this.context.totpTimeout = setTimeout(() => {
        if (this.context.keyboardInteractiveFinish) {
          this.context.keyboardInteractiveFinish = null;
          this.context.keyboardInteractiveResponded = false;
          sshLogger.warn("Password prompt timeout", {
            operation: "password_timeout",
            hostId: this.context.hostId,
          });
          this.context.ws.send(
            JSON.stringify({
              type: "error",
              message: "Password verification timeout. Please reconnect.",
            }),
          );
        }
      }, 180000);

      this.sendLog("auth", "info", "Password authentication required");

      this.context.ws.send(
        JSON.stringify({
          type: "password_required",
          prompt: prompts[passwordPromptIndex].prompt,
        }),
      );
      return;
    }

    const responses = prompts.map((p) => {
      if (/password/i.test(p.prompt) && resolvedCredentials.password) {
        return resolvedCredentials.password;
      }
      return "";
    });

    finish(responses);
  }

  sendLog(
    stage: string,
    level: string,
    message: string,
    details?: Record<string, any>,
  ): void {
    this.context.ws.send(
      JSON.stringify({
        type: "connection_log",
        data: {
          stage,
          level,
          message,
          details,
        },
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
