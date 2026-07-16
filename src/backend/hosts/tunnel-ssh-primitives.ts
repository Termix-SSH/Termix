import { Client, type ClientChannel } from "ssh2";
import type { Duplex } from "stream";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { tunnelLogger } from "../utils/logger.js";

export function getManagedTunnelAlgorithms() {
  return {
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
  };
}

export function applyAuthOptions(
  connOptions: Record<string, unknown>,
  credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    keyType?: string;
    authMethod?: string;
  },
): void {
  if (credentials.authMethod === "key" && credentials.sshKey) {
    const cleanKey = credentials.sshKey
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    connOptions.privateKey = Buffer.from(cleanKey, "utf8");
    if (credentials.keyPassword) {
      connOptions.passphrase = credentials.keyPassword;
    }
    if (credentials.keyType && credentials.keyType !== "auto") {
      connOptions.privateKeyType = credentials.keyType;
    }
  } else {
    connOptions.password = credentials.password;
  }
}

export function connectClient(
  connOptions: Record<string, unknown>,
  tunnelName: string,
  role: "source" | "endpoint",
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    client.once("ready", () => {
      settled = true;
      resolve(client);
    });
    client.once("error", (error) => {
      if (!settled) {
        reject(error);
        return;
      }
      tunnelLogger.error("Managed tunnel SSH client error", error, {
        operation: "managed_tunnel_client_error",
        tunnelName,
        role,
      });
    });
    client.connect(connOptions);
  });
}

export function forwardOut(
  client: Client,
  targetHost: string,
  targetPort: number,
  tunnelName?: string,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
      if (err) {
        if (tunnelName) {
          tunnelLogger.error("Managed tunnel forwardOut failed", err, {
            operation: "managed_tunnel_forward_out_failed",
            tunnelName,
            targetHost,
            targetPort,
          });
        }
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

export function bindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.forwardIn(bindHost, bindPort, (err, actualPort) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(actualPort || bindPort);
    });
  });
}

export function unbindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
): void {
  try {
    client.unforwardIn(bindHost, bindPort, (err) => {
      if (err) {
        tunnelLogger.warn("Failed to unbind managed tunnel listener", {
          operation: "managed_tunnel_unforward_failed",
          bindHost,
          bindPort,
          error: err.message,
        });
      }
    });
  } catch {
    // The connection may already be gone.
  }
}

export function pipeTunnelStreams(
  inbound: Duplex,
  outboundPromise: Promise<Duplex>,
  tunnelName: string,
): void {
  outboundPromise
    .then((outbound) => {
      inbound.pipe(outbound).pipe(inbound);
      inbound.on("error", () => outbound.destroy());
      outbound.on("error", () => inbound.destroy());
    })
    .catch((error) => {
      tunnelLogger.error(
        "Failed to open managed tunnel outbound stream",
        error,
        {
          operation: "managed_tunnel_outbound_failed",
          tunnelName,
        },
      );
      inbound.destroy();
    });
}
