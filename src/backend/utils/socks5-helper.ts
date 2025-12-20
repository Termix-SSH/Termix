import { SocksClient } from "socks";
import type { SocksClientOptions } from "socks";
import net from "net";
import { sshLogger } from "./logger.js";
import type { ProxyNode } from "../../types/index.js";

export interface SOCKS5Config {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: ProxyNode[];
}

/**
 * Creates a SOCKS5 connection through a single proxy or a chain of proxies
 * @param targetHost - Target SSH server hostname/IP
 * @param targetPort - Target SSH server port
 * @param socks5Config - SOCKS5 proxy configuration
 * @returns Promise with connected socket or null if SOCKS5 is not enabled
 */
export async function createSocks5Connection(
  targetHost: string,
  targetPort: number,
  socks5Config: SOCKS5Config,
): Promise<net.Socket | null> {
  // If SOCKS5 is not enabled, return null
  if (!socks5Config.useSocks5) {
    return null;
  }

  // If proxy chain is provided, use chain connection
  if (socks5Config.socks5ProxyChain && socks5Config.socks5ProxyChain.length > 0) {
    return createProxyChainConnection(targetHost, targetPort, socks5Config.socks5ProxyChain);
  }

  // If single proxy is configured, use single proxy connection
  if (socks5Config.socks5Host) {
    return createSingleProxyConnection(targetHost, targetPort, socks5Config);
  }

  // No proxy configured
  return null;
}

/**
 * Creates a connection through a single SOCKS proxy
 */
async function createSingleProxyConnection(
  targetHost: string,
  targetPort: number,
  socks5Config: SOCKS5Config,
): Promise<net.Socket> {
  const socksOptions: SocksClientOptions = {
    proxy: {
      host: socks5Config.socks5Host!,
      port: socks5Config.socks5Port || 1080,
      type: 5,
      userId: socks5Config.socks5Username,
      password: socks5Config.socks5Password,
    },
    command: "connect",
    destination: {
      host: targetHost,
      port: targetPort,
    },
  };

  sshLogger.info("Creating SOCKS5 connection", {
    operation: "socks5_connect",
    proxyHost: socks5Config.socks5Host,
    proxyPort: socks5Config.socks5Port || 1080,
    targetHost,
    targetPort,
    hasAuth: !!(socks5Config.socks5Username && socks5Config.socks5Password),
  });

  try {
    const info = await SocksClient.createConnection(socksOptions);

    sshLogger.info("SOCKS5 connection established", {
      operation: "socks5_connected",
      targetHost,
      targetPort,
    });

    return info.socket;
  } catch (error) {
    sshLogger.error("SOCKS5 connection failed", error, {
      operation: "socks5_connect_failed",
      proxyHost: socks5Config.socks5Host,
      proxyPort: socks5Config.socks5Port || 1080,
      targetHost,
      targetPort,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Creates a connection through a chain of SOCKS proxies
 * Each proxy in the chain connects through the previous one
 */
async function createProxyChainConnection(
  targetHost: string,
  targetPort: number,
  proxyChain: ProxyNode[],
): Promise<net.Socket> {
  if (proxyChain.length === 0) {
    throw new Error("Proxy chain is empty");
  }

  const chainPath = proxyChain.map((p) => `${p.host}:${p.port}`).join(" → ");
  sshLogger.info(`Creating SOCKS proxy chain: ${chainPath} → ${targetHost}:${targetPort}`, {
    operation: "socks5_chain_connect",
    chainLength: proxyChain.length,
    targetHost,
    targetPort,
    proxies: proxyChain.map((p) => `${p.host}:${p.port}`),
  });

  try {
    const info = await SocksClient.createConnectionChain({
      proxies: proxyChain.map((p) => ({
        host: p.host,
        port: p.port,
        type: p.type,
        userId: p.username,
        password: p.password,
        timeout: 10000, // 10-second timeout for each hop
      })),
      command: "connect",
      destination: {
        host: targetHost,
        port: targetPort,
      },
    });

    sshLogger.info(`✓ Proxy chain established: ${chainPath} → ${targetHost}:${targetPort}`, {
      operation: "socks5_chain_connected",
      chainLength: proxyChain.length,
      targetHost,
      targetPort,
      fullPath: `${chainPath} → ${targetHost}:${targetPort}`,
    });

    return info.socket;
  } catch (error) {
    sshLogger.error("SOCKS proxy chain connection failed", error, {
      operation: "socks5_chain_connect_failed",
      chainLength: proxyChain.length,
      targetHost,
      targetPort,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
