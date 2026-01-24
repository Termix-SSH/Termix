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

export async function createSocks5Connection(
  targetHost: string,
  targetPort: number,
  socks5Config: SOCKS5Config,
): Promise<net.Socket | null> {
  if (!socks5Config.useSocks5) {
    return null;
  }

  if (
    socks5Config.socks5ProxyChain &&
    socks5Config.socks5ProxyChain.length > 0
  ) {
    return createProxyChainConnection(
      targetHost,
      targetPort,
      socks5Config.socks5ProxyChain,
    );
  }

  if (socks5Config.socks5Host) {
    return createSingleProxyConnection(targetHost, targetPort, socks5Config);
  }

  return null;
}

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

  try {
    const info = await SocksClient.createConnection(socksOptions);

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

async function createProxyChainConnection(
  targetHost: string,
  targetPort: number,
  proxyChain: ProxyNode[],
): Promise<net.Socket> {
  if (proxyChain.length === 0) {
    throw new Error("Proxy chain is empty");
  }

  const chainPath = proxyChain.map((p) => `${p.host}:${p.port}`).join(" → ");
  try {
    const info = await SocksClient.createConnectionChain({
      proxies: proxyChain.map((p) => ({
        host: p.host,
        port: p.port,
        type: p.type,
        userId: p.username,
        password: p.password,
        timeout: 10000,
      })),
      command: "connect",
      destination: {
        host: targetHost,
        port: targetPort,
      },
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
