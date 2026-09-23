/**
 * How the bytes get to a host: port knocking, a Cloudflare Access tunnel, a
 * jump host chain or a SOCKS5 proxy, in that order. Sets config.sock and
 * returns the jump client so the caller can close it with the connection.
 */

import type { Client } from "ssh2";
import { getErrorMessage } from "../../utils/error-message.js";
import { logger } from "../../utils/logger.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../../utils/socks5-helper.js";
import type { ProxyNode } from "../../../types/index.js";
import { createJumpHostChain } from "../jump-host-chain.js";
import { resolveSshConnectConfigHost } from "../ssh-dns.js";
import { performPortKnocking } from "../terminal-auth-helpers.js";
import type {
  MutableConnectConfig,
  SshAuthLog,
  SshConnectHost,
} from "./types.js";

export function getHostSocks5Config(host: SshConnectHost): SOCKS5Config | null {
  const chain = Array.isArray(host.socks5ProxyChain)
    ? (host.socks5ProxyChain as ProxyNode[])
    : [];
  if (!host.useSocks5 || (!host.socks5Host && chain.length === 0)) return null;
  return {
    useSocks5: host.useSocks5,
    socks5Host: host.socks5Host ?? undefined,
    socks5Port: host.socks5Port ?? undefined,
    socks5Username: host.socks5Username ?? undefined,
    socks5Password: host.socks5Password ?? undefined,
    socks5ProxyChain: chain,
  };
}

export class SshTransportError extends Error {
  constructor(
    message: string,
    readonly stage: "cloudflare" | "jump-host" | "jump-forward" | "proxy",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SshTransportError";
  }
}

export interface OpenTransportOptions {
  /** Knock before connecting when the host has a sequence. Default true. */
  portKnock?: boolean;
  /** Use terminalConfig.cfAccessClient* when present. Default true. */
  cloudflare?: boolean;
  /** Resolve DNS up front for a direct connection. Default true. */
  resolveDns?: boolean;
  log?: SshAuthLog;
}

export interface OpenedTransport {
  jumpClient: Client | null;
  via: "direct" | "proxy" | "jump" | "cloudflare";
}

function forwardThrough(
  jumpClient: Client,
  host: SshConnectHost,
): Promise<NonNullable<MutableConnectConfig["sock"]>> {
  return new Promise((resolve, reject) => {
    jumpClient.forwardOut(
      "127.0.0.1",
      0,
      host.ip,
      host.port || 22,
      (err, stream) => {
        if (err) {
          reject(
            new SshTransportError(
              "Failed to forward through jump host: " + err.message,
              "jump-forward",
              { cause: err },
            ),
          );
          return;
        }
        resolve(stream);
      },
    );
  });
}

export async function openSshTransport(
  host: SshConnectHost,
  config: MutableConnectConfig,
  options: OpenTransportOptions = {},
): Promise<OpenedTransport> {
  const log = options.log ?? (() => {});

  if (
    options.portKnock !== false &&
    Array.isArray(host.portKnockSequence) &&
    host.portKnockSequence.length > 0
  ) {
    try {
      await performPortKnocking(host.ip, host.portKnockSequence);
    } catch {
      logger.warn("Port knocking failed, attempting connection anyway", {
        operation: "port_knock",
        hostId: host.id,
      });
    }
  }

  let via: OpenedTransport["via"] = "direct";

  const terminalConfig = (host.terminalConfig ?? {}) as Record<string, unknown>;
  if (
    options.cloudflare !== false &&
    terminalConfig.cfAccessClientId &&
    terminalConfig.cfAccessClientSecret
  ) {
    try {
      const WebSocket = (await import("ws")).default;
      const { createWebSocketDuplex, waitForWebSocketOpen } =
        await import("../cloudflare-websocket.js");
      const cfHostname = (terminalConfig.cfTunnelHostname as string) || host.ip;
      const cfWs = new WebSocket(
        `wss://${cfHostname}/cdn-cgi/access/ssh-connect`,
        {
          headers: {
            "CF-Access-Client-Id": terminalConfig.cfAccessClientId as string,
            "CF-Access-Client-Secret":
              terminalConfig.cfAccessClientSecret as string,
          },
        },
      );
      await waitForWebSocketOpen(cfWs, 30000);
      config.sock = createWebSocketDuplex(
        cfWs,
      ) as unknown as typeof config.sock;
      via = "cloudflare";
      log("info", "Connected via Cloudflare Tunnel");
    } catch (error) {
      throw new SshTransportError(
        "Cloudflare tunnel connection failed: " + getErrorMessage(error),
        "cloudflare",
        { cause: error },
      );
    }
  }

  const jumpUserId = host.userId || "";
  if (host.jumpHosts && host.jumpHosts.length > 0 && jumpUserId) {
    const jumpClient = await createJumpHostChain(host.jumpHosts, jumpUserId);
    if (!jumpClient) {
      throw new SshTransportError(
        "Failed to connect through jump hosts",
        "jump-host",
      );
    }
    try {
      config.sock = await forwardThrough(jumpClient, host);
    } catch (error) {
      jumpClient.end();
      throw error;
    }
    return { jumpClient, via: "jump" };
  }

  const proxyConfig = getHostSocks5Config(host);
  if (proxyConfig && via === "direct") {
    try {
      const proxySocket = await createSocks5Connection(
        host.ip,
        host.port || 22,
        proxyConfig,
      );
      if (proxySocket) {
        config.sock = proxySocket;
        via = "proxy";
      }
    } catch (error) {
      throw new SshTransportError(
        "Proxy connection failed: " + getErrorMessage(error),
        "proxy",
        { cause: error },
      );
    }
  }

  if (via === "direct" && options.resolveDns !== false) {
    await resolveSshConnectConfigHost(config);
  }

  return { jumpClient: null, via };
}
