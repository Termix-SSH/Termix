/**
 * Core's side of HTTPS: where the certificate lives, replacing it, and
 * serving a new one without a restart. Getting a certificate (ACME) is a
 * plugin's job; it reaches this through ctx.system.
 */

import { promises as fs } from "fs";
import https from "https";
import path from "path";
import { systemLogger } from "../utils/logger.js";
import {
  readCertificateInfo,
  validateCertificatePair,
  type TlsCertificateInfo,
} from "./certificate.js";
import { persistSSLEnv, reloadNginxWithSSL } from "./nginx-reload.js";

export interface TlsConfig {
  enabled: boolean;
  port: number;
  certPath: string;
  keyPath: string;
  domain: string;
  /** In Docker nginx serves HTTPS and the backend only speaks HTTP. */
  terminatedByNginx: boolean;
}

export interface TlsRenewer {
  pluginId: string;
  pluginName: string;
}

export interface TlsStatus {
  enabled: boolean;
  certificate: TlsCertificateInfo | null;
  renewal: TlsRenewer | null;
}

export interface TlsReloadResult {
  applied: boolean;
  message: string;
}

export function getTlsConfig(env: NodeJS.ProcessEnv = process.env): TlsConfig {
  const sslDir = path.join(env.DATA_DIR || "./db/data", "ssl");
  return {
    enabled: env.ENABLE_SSL === "true",
    port: parseInt(env.SSL_PORT || "8443"),
    certPath: env.SSL_CERT_PATH || path.join(sslDir, "termix.crt"),
    keyPath: env.SSL_KEY_PATH || path.join(sslDir, "termix.key"),
    domain: env.SSL_DOMAIN || "localhost",
    terminatedByNginx: env.TERMIX_SSL_TERMINATED_BY_NGINX === "true",
  };
}

type HttpsFactory = (options: https.ServerOptions) => https.Server;

let directServer: https.Server | null = null;
let directFactory: HttpsFactory | null = null;

/**
 * Called once by the backend with how to build its direct HTTPS server. Starts
 * it now when HTTPS is on and nginx is not the one serving it.
 */
export async function configureDirectHttps(
  factory: HttpsFactory,
): Promise<https.Server | null> {
  directFactory = factory;
  const config = getTlsConfig();
  if (!config.enabled || config.terminatedByNginx) return null;
  return startDirectServer(config);
}

async function readPair(
  config: TlsConfig,
): Promise<{ cert: Buffer; key: Buffer }> {
  const [cert, key] = await Promise.all([
    fs.readFile(config.certPath),
    fs.readFile(config.keyPath),
  ]);
  return { cert, key };
}

async function startDirectServer(
  config: TlsConfig,
): Promise<https.Server | null> {
  if (!directFactory) return null;
  try {
    directServer = directFactory(await readPair(config));
    return directServer;
  } catch (error) {
    systemLogger.error(
      "Failed to start HTTPS server with configured SSL certificate",
      error,
      {
        operation: "https_server_start_failed",
        cert_path: config.certPath,
        key_path: config.keyPath,
      },
    );
    return null;
  }
}

/** Only for tests: forget the server and factory. */
export function resetTlsServiceForTests(): void {
  directServer = null;
  directFactory = null;
  renewers.clear();
}

const renewers = new Map<string, { renewer: TlsRenewer; count: number }>();

/** Records that a plugin renews the certificate. Returns the undo. */
export function registerTlsRenewer(renewer: TlsRenewer): () => void {
  const entry = renewers.get(renewer.pluginId) ?? { renewer, count: 0 };
  entry.count++;
  renewers.set(renewer.pluginId, entry);
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const current = renewers.get(renewer.pluginId);
    if (!current) return;
    current.count--;
    if (current.count <= 0) renewers.delete(renewer.pluginId);
  };
}

export function currentTlsRenewer(): TlsRenewer | null {
  const first = renewers.values().next();
  return first.done ? null : first.value.renewer;
}

export async function getTlsStatus(): Promise<TlsStatus> {
  const config = getTlsConfig();
  let certificate: TlsCertificateInfo | null = null;
  try {
    certificate = readCertificateInfo(
      await fs.readFile(config.certPath, "utf8"),
    );
  } catch {
    certificate = null;
  }
  return {
    enabled: config.enabled,
    certificate,
    renewal: currentTlsRenewer(),
  };
}

/**
 * Validates the pair, then swaps both files in with a rename so nginx or the
 * HTTPS server never reads half a certificate. Does not reload.
 */
export async function writeTlsCertificate(
  certificatePem: string,
  privateKeyPem: string,
): Promise<TlsCertificateInfo> {
  const info = validateCertificatePair(certificatePem, privateKeyPem);
  const config = getTlsConfig();

  await fs.mkdir(path.dirname(config.certPath), { recursive: true });
  await fs.mkdir(path.dirname(config.keyPath), { recursive: true });

  const certTmp = `${config.certPath}.tmp`;
  const keyTmp = `${config.keyPath}.tmp`;
  try {
    await fs.writeFile(certTmp, certificatePem, { mode: 0o644 });
    await fs.writeFile(keyTmp, privateKeyPem, { mode: 0o600 });
    await fs.rename(keyTmp, config.keyPath);
    await fs.rename(certTmp, config.certPath);
    await fs.chmod(config.keyPath, 0o600).catch(() => undefined);
    await fs.chmod(config.certPath, 0o644).catch(() => undefined);
  } finally {
    await fs.rm(certTmp, { force: true });
    await fs.rm(keyTmp, { force: true });
  }

  systemLogger.info("TLS certificate replaced", {
    operation: "tls_certificate_written",
    subject: info.subject,
    not_after: info.notAfter,
  });
  return info;
}

/** Serves the certificate on disk now, through nginx or the direct server. */
export async function reloadTls(): Promise<TlsReloadResult> {
  const config = getTlsConfig();

  if (config.terminatedByNginx) {
    return reloadNginxWithSSL();
  }

  try {
    const pair = await readPair(config);
    if (directServer) {
      directServer.setSecureContext(pair);
      return { applied: true, message: "The new certificate is being served." };
    }

    process.env.ENABLE_SSL = "true";
    const server = await startDirectServer(getTlsConfig());
    if (!server) {
      return {
        applied: false,
        message:
          "Certificate installed, but HTTPS could not be started. Restart Termix with ENABLE_SSL=true to apply it.",
      };
    }
    persistSSLEnv(String(config.port), config.certPath, config.keyPath);
    return {
      applied: true,
      message: `HTTPS is now active on port ${config.port}.`,
    };
  } catch (error) {
    systemLogger.error("Failed to reload the TLS certificate", error, {
      operation: "tls_reload_failed",
    });
    return {
      applied: false,
      message:
        "Certificate installed, but it could not be loaded. Restart Termix to apply it.",
    };
  }
}
