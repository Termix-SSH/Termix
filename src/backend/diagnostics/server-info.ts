/**
 * The server half of a diagnostics report, for admins. Everything here is
 * safe to post: env vars show values only from an allowlist, errors are
 * masked, and nothing reads user data.
 */
import fs from "fs";
import os from "os";
import { getLocalVersion } from "../utils/app-version.js";
import { getGlobalLogLevel, redactText } from "../utils/logger.js";

/** Config whose value says how the server runs and never holds a secret. */
const ENV_VALUES = new Set([
  "PORT",
  "SSL_PORT",
  "ENABLE_SSL",
  "DATABASE_DIALECT",
  "LOG_LEVEL",
  "LOG_TIMESTAMP_FORMAT",
  "TERMIX_SAFE_MODE",
  "TERMIX_SAFE_LAYOUT",
  "TERMIX_REQUIRE_SIGNED_PLUGINS",
  "TERMIX_SSL_TERMINATED_BY_NGINX",
  "TERMIX_PLUGIN_LAUNCHER",
  "TERMIX_DEV_RELOAD",
  "TRUSTED_PROXY_AUTH_ENABLED",
  "EXTERNAL_FORCE_HTTPS",
  "OIDC_FORCE_HTTPS",
  "ALLOW_PASSWORD_LOGIN",
  "ALLOW_PASSWORD_RESET",
  "ALLOW_REGISTRATION",
  "DB_FILE_ENCRYPTION",
  "ELECTRON_EMBEDDED",
  "SERVE_OPENAPI",
  "AUDIT_LOG_MAX_ENTRIES",
  "AUDIT_LOG_RETENTION_DAYS",
  "BASE_PATH",
  "VITE_BASE_PATH",
  "NODE_ENV",
  "TZ",
  "PUID",
  "PGID",
]);

/** Names worth listing when set, with the value hidden. */
const ENV_NAME =
  /^(TERMIX_|SSL_|DATABASE_|DB_|ENCRYPTION_|JWT_|OIDC_|LOG_|ALLOW_|EXTERNAL_|TRUSTED_|CORS_|WEBAUTHN_|AUDIT_|SESSION_|PLUGIN_|EMBEDDED_|INTERNAL_|HTTPS?_PROXY$|NO_PROXY$|NODE_EXTRA_CA_CERTS$|DATA_DIR$|PORT$|NODE_ENV$|TZ$|PUID$|PGID$|VERSION$|BASE_PATH$|VITE_BASE_PATH$)/;

export function describeEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env).sort()) {
    const upper = name.toUpperCase();
    if (!ENV_NAME.test(upper)) continue;
    const value = env[name] ?? "";
    out[name] = ENV_VALUES.has(upper)
      ? redactText(value).slice(0, 200)
      : "[set]";
  }
  return out;
}

function inContainer(): boolean {
  try {
    return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

async function dataDirInfo(): Promise<Record<string, unknown>> {
  const dir = process.env.DATA_DIR || "./db/data";
  const out: Record<string, unknown> = {};
  try {
    await fs.promises.access(dir, fs.constants.W_OK);
    out.writable = true;
  } catch {
    out.writable = false;
  }
  try {
    const stats = await fs.promises.statfs(dir);
    out.freeMb = Math.round((stats.bavail * stats.bsize) / 1024 / 1024);
    out.totalMb = Math.round((stats.blocks * stats.bsize) / 1024 / 1024);
  } catch {
    // statfs is missing on some platforms.
  }
  return out;
}

async function databaseInfo(): Promise<Record<string, unknown>> {
  const { resolveDatabaseDialect } = await import("../database/db/dialect.js");
  const out: Record<string, unknown> = { dialect: resolveDatabaseDialect() };
  const started = Date.now();
  try {
    const { createCurrentUserRepository } =
      await import("../database/repositories/factory.js");
    await createCurrentUserRepository().countAll();
    out.health = "ok";
  } catch (error) {
    out.health = "failed";
    out.error = redactText(
      error instanceof Error ? error.message : String(error),
    ).slice(0, 300);
  }
  out.checkMs = Date.now() - started;
  return out;
}

async function tlsInfo(): Promise<Record<string, unknown>> {
  try {
    const { getTlsConfig, getTlsStatus } =
      await import("../tls/tls-service.js");
    const config = getTlsConfig();
    const status = await getTlsStatus();
    const cert = status.certificate;
    return {
      enabled: config.enabled,
      port: config.port,
      terminatedByNginx: config.terminatedByNginx,
      certificate: cert
        ? {
            notBefore: cert.notBefore,
            notAfter: cert.notAfter,
            selfSigned: cert.selfSigned,
            names: cert.names.length,
          }
        : null,
      renewedBy: status.renewal?.pluginId ?? null,
    };
  } catch {
    return { enabled: null };
  }
}

export async function describeServer(): Promise<Record<string, unknown>> {
  const memory = process.memoryUsage();
  const { safeModeOn } = await import("../plugins/safe-mode.js");
  return {
    version: getLocalVersion(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    container: inContainer(),
    desktop: process.env.ELECTRON_EMBEDDED === "true",
    uptimeSeconds: Math.round(process.uptime()),
    serverTime: new Date().toISOString(),
    timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    cpus: os.cpus().length,
    loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
    memoryMb: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      systemTotal: Math.round(os.totalmem() / 1024 / 1024),
      systemFree: Math.round(os.freemem() / 1024 / 1024),
    },
    logLevel: getGlobalLogLevel(),
    safeMode: safeModeOn(),
    dataDir: await dataDirInfo(),
    database: await databaseInfo(),
    tls: await tlsInfo(),
    env: describeEnv(),
  };
}
