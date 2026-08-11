import { Client, type ConnectConfig } from "ssh2";
import type { SSHHost } from "../../types/index.js";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { preparePrivateKeyForSSH2 } from "../utils/ssh-key-utils.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../utils/socks5-helper.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";
import { createJumpHostChain } from "./jump-host-chain.js";
import { resolveSshConnectConfigHost } from "./ssh-dns.js";

/**
 * Non-interactive SSH connection helpers shared by fleet execution.
 *
 * Mirrors buildSshConfig/createSshFactory/getPoolKey in hosts/metrics/index.ts,
 * minus the keyboard-interactive TOTP prompt handling (metrics/terminal-only)
 * and OPKSSH/Vault cert setup (not supported as fleet auth for v1 - those flows
 * need an interactive browser step that has no place in a batch fleet run).
 */

export function getFleetPoolKey(host: SSHHost): string {
  const socks5Key = host.useSocks5
    ? `:socks5:${host.socks5Host}:${host.socks5Port}`
    : "";
  return `fleet:${host.userId}:${host.ip}:${host.port}:${host.username}${socks5Key}`;
}

export async function buildFleetSshConfig(
  host: SSHHost,
): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: host.ip?.replace(/^\[|\]$/g, "") || host.ip,
    port: host.port,
    username: host.username,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 30000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      host.id,
      host.ip,
      host.port,
      null,
      host.userId || "",
      false,
    ),
    env: {
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
    algorithms: {
      kex: [
        "curve25519-sha256",
        "curve25519-sha256@libssh.org",
        "ecdh-sha2-nistp521",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp256",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group-exchange-sha1",
        "diffie-hellman-group1-sha1",
      ],
      serverHostKey: [
        "ssh-ed25519",
        "ecdsa-sha2-nistp521",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp256",
        "rsa-sha2-512",
        "rsa-sha2-256",
        "ssh-rsa",
        "ssh-dss",
      ],
      cipher: SSH_ALGORITHMS.cipher,
      hmac: [
        "hmac-sha2-512-etm@openssh.com",
        "hmac-sha2-256-etm@openssh.com",
        "hmac-sha2-512",
        "hmac-sha2-256",
        "hmac-sha1",
        "hmac-md5",
      ],
      compress: ["none", "zlib@openssh.com", "zlib"],
    },
  } as ConnectConfig;

  const authType = host.authType;

  if (authType === "password" || authType === "credential") {
    if (!host.password) {
      throw new Error(`No password available for host ${host.ip}`);
    }
    base.password = host.password;
  } else if (authType === "key") {
    if (!host.key) {
      throw new Error(`No SSH key available for host ${host.ip}`);
    }
    (base as Record<string, unknown>).privateKey = preparePrivateKeyForSSH2(
      host.key,
      host.keyPassword,
    );
    if (host.keyPassword) {
      (base as Record<string, unknown>).passphrase = host.keyPassword;
    }
  } else if (authType === "none" || authType === "tailscale") {
    // no credentials needed
  } else {
    throw new Error(
      `Unsupported authentication type '${authType}' for fleet execution on host ${host.ip}`,
    );
  }

  return base;
}

export function createFleetSshFactory(host: SSHHost): () => Promise<Client> {
  return async () => {
    const config = await buildFleetSshConfig(host);
    const client = new Client();

    const proxyConfig: SOCKS5Config | null =
      host.useSocks5 &&
      (host.socks5Host ||
        (host.socks5ProxyChain && host.socks5ProxyChain.length > 0))
        ? {
            useSocks5: host.useSocks5,
            socks5Host: host.socks5Host,
            socks5Port: host.socks5Port,
            socks5Username: host.socks5Username,
            socks5Password: host.socks5Password,
            socks5ProxyChain: host.socks5ProxyChain,
          }
        : null;

    const hasJumpHosts =
      host.jumpHosts && host.jumpHosts.length > 0 && host.userId;

    let jumpClient: Client | null = null;
    if (hasJumpHosts) {
      jumpClient = await createJumpHostChain(host.jumpHosts!, host.userId!);
      if (!jumpClient) {
        throw new Error("Failed to establish jump host chain");
      }
    } else if (proxyConfig) {
      try {
        const proxySocket = await createSocks5Connection(
          host.ip,
          host.port,
          proxyConfig,
        );
        if (proxySocket) {
          config.sock = proxySocket;
        }
      } catch (proxyError) {
        throw new Error(
          "Proxy connection failed: " +
            (proxyError instanceof Error
              ? proxyError.message
              : "Unknown error"),
          { cause: proxyError },
        );
      }
    }

    return new Promise<Client>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        jumpClient?.end();
        reject(new Error("SSH connection timeout"));
      }, 30000);

      client.on("ready", () => {
        clearTimeout(timeout);
        resolve(client);
      });

      client.on("close", () => {
        jumpClient?.end();
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        jumpClient?.end();
        reject(err);
      });

      if (jumpClient) {
        jumpClient.forwardOut(
          "127.0.0.1",
          0,
          host.ip,
          host.port,
          (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              jumpClient!.end();
              reject(
                new Error(
                  "Failed to forward through jump host: " + err.message,
                ),
              );
              return;
            }
            config.sock = stream;
            client.connect(config);
          },
        );
      } else if (config.sock) {
        client.connect(config);
      } else {
        resolveSshConnectConfigHost(config)
          .then(() => {
            client.connect(config);
          })
          .catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
      }
    });
  };
}
