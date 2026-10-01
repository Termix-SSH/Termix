import { Client as SSHClient } from "ssh2";
import { fileLogger } from "../utils/logger.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { getErrorMessage } from "../utils/error-message.js";
import { getJumpHostSocks5Config } from "./jump-host-proxy.js";
import { buildConnectConfig } from "./connect/build-connect-config.js";
import {
  createAutoKeyboardInteractiveHandler,
  createPromptKeyboardInteractiveHandler,
} from "./connect/keyboard-interactive.js";
import type { SshConnectHost, SshPromptChannel } from "./connect/types.js";
import { resolveHostById } from "./host-resolver.js";

type JumpHostConfig = {
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
  useSocks5?: boolean | null;
  socks5Host?: string | null;
  socks5Port?: number | null;
  socks5Username?: string | null;
  socks5Password?: string | null;
  socks5ProxyChain?: string | import("../../types/index.js").ProxyNode[] | null;
  [key: string]: unknown;
};

async function resolveJumpHost(
  hostId: number,
  userId: string,
): Promise<JumpHostConfig | null> {
  try {
    return (await resolveHostById(
      hostId,
      userId,
    )) as unknown as JumpHostConfig | null;
  } catch (error) {
    fileLogger.error("Failed to resolve jump host", error, {
      operation: "resolve_jump_host",
      hostId,
      userId,
    });
    return null;
  }
}

class JumpHostChainError extends Error {
  constructor(
    message: string,
    readonly hopIndex: number,
    readonly totalHops: number,
  ) {
    super(message);
    this.name = "JumpHostChainError";
  }
}

export async function createJumpHostChain(
  jumpHosts: Array<{ hostId: number }>,
  userId: string,
  prompt?: SshPromptChannel,
): Promise<SSHClient | null> {
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: SSHClient | null = null;
  const clients: SSHClient[] = [];
  let closed = false;
  const closeChain = () => {
    if (closed) return;
    closed = true;
    for (const client of clients) client.end();
  };

  try {
    const jumpHostConfigs: Array<Awaited<ReturnType<typeof resolveJumpHost>>> =
      [];
    for (let i = 0; i < jumpHosts.length; i++) {
      const config = await resolveJumpHost(jumpHosts[i].hostId, userId);
      jumpHostConfigs.push(config);
    }

    const totalHops = jumpHostConfigs.length;

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      if (!jumpHostConfigs[i]) {
        fileLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
          hopIndex: i,
          totalHops,
        });
        closeChain();
        throw new JumpHostChainError(
          `Jump host ${i + 1} of ${totalHops} was not found`,
          i,
          totalHops,
        );
      }
    }

    const firstHopSocks5Config = getJumpHostSocks5Config(jumpHostConfigs[0]);
    let proxySocket: import("net").Socket | null = null;
    if (firstHopSocks5Config?.useSocks5) {
      const firstHop = jumpHostConfigs[0]!;
      proxySocket = await createSocks5Connection(
        firstHop.ip,
        firstHop.port || 22,
        firstHopSocks5Config,
      );
    }

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      if (closed) throw new Error("Jump host chain closed");
      const jumpHostConfig = jumpHostConfigs[i]!;

      const jumpClient = new SSHClient();
      clients.push(jumpClient);
      jumpClient.once("close", closeChain);

      let lastError: Error | null = null;

      // eslint-disable-next-line no-async-promise-executor
      const connected = await new Promise<boolean>(async (resolve) => {
        const readyTimeoutMs = 60000;
        const timeout = setTimeout(() => {
          lastError = new Error(
            `Timed out waiting for jump host ${i + 1}/${totalHops} to authenticate`,
          );
          resolve(false);
          // ssh2 has no explicit cancel; ending the client stops it from
          // firing "ready"/"error" after we've already resolved.
          jumpClient.end();
        }, readyTimeoutMs + 5000);

        jumpClient.once("close", () => {
          clearTimeout(timeout);
          lastError = new Error("Jump host connection closed");
          resolve(false);
        });
        jumpClient.on("ready", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        jumpClient.on("error", (err) => {
          clearTimeout(timeout);
          lastError = err;
          fileLogger.error(
            `Jump host ${i + 1}/${totalHops} connection failed`,
            err,
            {
              operation: "jump_host_connect",
              hostId: jumpHostConfig.id,
              ip: jumpHostConfig.ip,
              hopIndex: i,
              totalHops,
              previousHop:
                i > 0
                  ? jumpHostConfigs[i - 1]?.ip
                  : proxySocket
                    ? "proxy"
                    : "direct",
              usedProxySocket: i === 0 && !!proxySocket,
            },
          );
          resolve(false);
        });

        // Each hop goes through the same pipeline as the target, so hops get
        // every auth type, not just password, key and agent.
        const built = await buildConnectConfig(
          jumpHostConfig as unknown as SshConnectHost,
          {
            userId,
            purpose: "jump-host",
            profile: "jump",
            client: jumpClient,
            interactive: !!prompt,
            hostKeySocket: prompt?.hostKeySocket ?? null,
          },
        );
        if (closed) {
          clearTimeout(timeout);
          resolve(false);
          return;
        }
        if (built.outcome.status !== "ready") {
          clearTimeout(timeout);
          lastError = new Error(
            `Jump host ${i + 1}/${totalHops}: ${built.outcome.message}`,
          );
          resolve(false);
          return;
        }
        const connectConfig = built.config;
        connectConfig.readyTimeout = readyTimeoutMs;

        jumpClient.on(
          "keyboard-interactive",
          prompt
            ? createPromptKeyboardInteractiveHandler(
                jumpHostConfig as unknown as SshConnectHost,
                {
                  ...prompt,
                  ask: (request) =>
                    prompt.ask(
                      request.kind === "browser"
                        ? {
                            ...request,
                            instructions: `Jump host ${i + 1}/${totalHops} (${jumpHostConfig.ip}): ${request.instructions}`,
                          }
                        : {
                            ...request,
                            prompt: `Jump host ${i + 1}/${totalHops} (${jumpHostConfig.ip}): ${request.prompt}`,
                          },
                    ),
                },
              )
            : createAutoKeyboardInteractiveHandler(
                jumpHostConfig as unknown as SshConnectHost,
              ),
        );

        if (currentClient) {
          currentClient.forwardOut(
            "127.0.0.1",
            0,
            jumpHostConfig.ip,
            jumpHostConfig.port || 22,
            (err, stream) => {
              if (err) {
                clearTimeout(timeout);
                lastError = err;
                resolve(false);
                return;
              }
              connectConfig.sock = stream;
              jumpClient.connect(connectConfig);
            },
          );
        } else if (proxySocket) {
          connectConfig.sock = proxySocket;
          jumpClient.connect(connectConfig);
        } else {
          jumpClient.connect(connectConfig);
        }
      });

      if (!connected) {
        closeChain();
        throw new JumpHostChainError(
          getErrorMessage(
            lastError,
            `Jump host ${i + 1} of ${totalHops} failed to connect`,
          ),
          i,
          totalHops,
        );
      }

      currentClient = jumpClient;
    }

    return currentClient;
  } catch (error) {
    if (error instanceof JumpHostChainError) throw error;
    fileLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    closeChain();
    return null;
  }
}
