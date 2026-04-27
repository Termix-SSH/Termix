import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import { OPKSSHBinaryManager } from "../utils/opkssh-binary-manager.js";
import { sshLogger } from "../utils/logger.js";
import { getDb } from "../database/db/index.js";
import { opksshTokens } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { UserCrypto } from "../utils/user-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { promises as fs } from "fs";
import path from "path";
import axios from "axios";
import yaml from "js-yaml";

const AUTH_TIMEOUT = 60 * 1000;

export const OPKSSH_CALLBACK_PATH = "/host/opkssh-callback";

interface OPKSSHAuthSession {
  requestId: string;
  userId: string;
  hostId: number;
  hostname: string;
  process: ChildProcess;
  localPort: number;
  callbackPort: number;
  remoteRedirectUri: string;
  providers: Array<{ alias: string; issuer: string }>;
  status:
    | "starting"
    | "waiting_for_auth"
    | "authenticating"
    | "completed"
    | "error";
  ws: WebSocket;
  stdoutBuffer: string;
  privateKeyBuffer: string;
  sshCertBuffer: string;
  identity: {
    email?: string;
    sub?: string;
    issuer?: string;
    audience?: string;
  };
  createdAt: Date;
  approvalTimeout: NodeJS.Timeout;
  cleanup: () => Promise<void>;
}

const activeAuthSessions = new Map<string, OPKSSHAuthSession>();
const oauthStateToRequestId = new Map<string, string>();
const cleanupInProgress = new Set<string>();

function getOPKConfigPath(): string {
  const dataDir =
    process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
  return path.join(dataDir, ".opk", "config.yml");
}

async function ensureOPKConfigDir(): Promise<void> {
  const configPath = getOPKConfigPath();
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });
}

async function createTemplateConfig(): Promise<void> {
  const configPath = getOPKConfigPath();
  const template = `
# OPKSSH Configuration
# OPKSSH Documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md
# Termix Documentation: https://docs.termix.site/opkssh
`;

  try {
    await ensureOPKConfigDir();
    await fs.writeFile(configPath, template, "utf8");
    sshLogger.info(`Created template OPKSSH config at ${configPath}`);
  } catch (error) {
    sshLogger.warn("Failed to create template OPKSSH config", error);
  }
}

interface ProviderRedirectInfo {
  alias: string;
  issuer: string;
  redirectUris: string[];
}

async function checkOPKConfigExists(): Promise<{
  exists: boolean;
  error?: string;
  configPath?: string;
  providers?: ProviderRedirectInfo[];
}> {
  const configPath = getOPKConfigPath();
  const isDocker =
    !!process.env.DATA_DIR && process.env.DATA_DIR.startsWith("/app");
  const dockerHint = isDocker
    ? "\n\nDocker: Ensure /app/data is mounted as a volume with write permissions for node:node user."
    : "";

  try {
    const content = await fs.readFile(configPath, "utf8");

    if (!content.includes("providers:")) {
      return {
        exists: false,
        configPath,
        error: `OPKSSH configuration is missing 'providers' section. Please edit the config file at:\n${configPath}\n\n.`,
      };
    }

    const lines = content.split("\n");

    const hasUncommentedProvider = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("- alias:") ||
        (trimmed.startsWith("issuer:") && !line.trimStart().startsWith("#"))
      );
    });

    if (!hasUncommentedProvider) {
      return {
        exists: false,
        configPath,
        error: `OPKSSH configuration has no active providers. Please edit the config file at:\n${configPath}\n\nUncomment and configure at least one OIDC provider.\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md${dockerHint}`,
      };
    }

    let providers: ProviderRedirectInfo[] = [];
    try {
      const parsed = yaml.load(content) as {
        providers?: Array<{
          alias?: string;
          issuer?: string;
          redirect_uris?: string[];
        }>;
      };
      if (parsed?.providers && Array.isArray(parsed.providers)) {
        providers = parsed.providers
          .filter(
            (
              p,
            ): p is {
              alias: string;
              issuer: string;
              redirect_uris?: string[];
            } => typeof p.alias === "string" && typeof p.issuer === "string",
          )
          .map((p) => ({
            alias: p.alias,
            issuer: p.issuer.replace(/^https?:\/\//, ""),
            redirectUris: Array.isArray(p.redirect_uris)
              ? p.redirect_uris.filter(
                  (u): u is string => typeof u === "string",
                )
              : [],
          }));
      }
    } catch (e) {
      sshLogger.warn("Failed to parse OPKSSH config for providers", {
        operation: "opkssh_config_parse_providers_error",
        error: e,
      });
    }

    return { exists: true, configPath, providers };
  } catch {
    await createTemplateConfig();
    return {
      exists: false,
      configPath,
      error: `OPKSSH configuration not found. A template config file has been created at:\n${configPath}\n\nPlease edit this file and configure your OIDC provider (Google, GitHub, Microsoft, etc.).\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md${dockerHint}`,
    };
  }
}

// OPKSSH's `redirect_uris` field lists candidate LOCAL ports for the callback listener
// that OPKSSH binds on the host running the binary. The openpubkey library enforces these
// must be localhost, a non-localhost entry causes ECONNRESET on /select/ at runtime.
// The publicly registered OAuth redirect URI is what Termix passes via --remote-redirect-uri
// (derived from request origin); users do NOT put that URL in this config field.
function validateRedirectUrisAreLocalhost(
  providers: ProviderRedirectInfo[],
): { ok: true } | { ok: false; message: string } {
  const isLocalHost = (host: string): boolean => {
    const bare = host.replace(/^\[|\]$/g, "");
    return (
      bare === "localhost" ||
      bare === "127.0.0.1" ||
      bare === "::1" ||
      bare === "0:0:0:0:0:0:0:1" ||
      bare.startsWith("localhost:") ||
      bare.startsWith("127.0.0.1:")
    );
  };

  const issues: string[] = [];
  for (const p of providers) {
    const uris = p.redirectUris || [];
    if (uris.length === 0) continue;
    const nonLocal = uris.filter((u) => {
      try {
        return !isLocalHost(new URL(u).hostname);
      } catch {
        return true;
      }
    });
    if (nonLocal.length > 0) {
      issues.push(
        `Provider '${p.alias}': non-localhost entries in redirect_uris: ${nonLocal.join(", ")}`,
      );
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      message:
        `OPKSSH configuration error: 'redirect_uris' must only contain localhost URLs.\n\n` +
        `${issues.join("\n")}\n\n` +
        `This field is OPKSSH's local callback listener, it must be localhost (or omitted to use ` +
        `the defaults http://localhost:3000/login-callback, :10001, :11110). ` +
        `The public Termix callback URL is supplied automatically by Termix via --remote-redirect-uri; ` +
        `you do not put it here. Register the PUBLIC Termix URL with your OAuth provider instead ` +
        `(e.g. https://your-domain${OPKSSH_CALLBACK_PATH}).\n\n` +
        `Fix: remove the non-localhost entries above, or delete the whole 'redirect_uris' block to use defaults.\n\n` +
        `Docs: https://docs.termix.site/opkssh`,
    };
  }

  return { ok: true };
}

export async function startOPKSSHAuth(
  userId: string,
  hostId: number,
  hostname: string,
  ws: WebSocket,
  requestOrigin: string,
): Promise<string> {
  try {
    await ensureOPKConfigDir();
    const configDir = path.dirname(getOPKConfigPath());
    await fs.access(configDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    sshLogger.error("OPKSSH directory not accessible", error);
    const isDocker =
      !!process.env.DATA_DIR && process.env.DATA_DIR.startsWith("/app");
    const dockerHint = isDocker
      ? "\n\nDocker: Ensure /app/data is mounted as a volume with write permissions for node:node user."
      : "";
    ws.send(
      JSON.stringify({
        type: "opkssh_error",
        error: `OPKSSH directory initialization failed: ${error.message}${dockerHint}`,
      }),
    );
    return "";
  }

  const configCheck = await checkOPKConfigExists();
  if (!configCheck.exists) {
    ws.send(
      JSON.stringify({
        type: "opkssh_config_error",
        requestId: "",
        error: configCheck.error,
        instructions: configCheck.error,
      }),
    );
    return "";
  }

  const redirectValidation = validateRedirectUrisAreLocalhost(
    configCheck.providers || [],
  );
  if (redirectValidation.ok === false) {
    sshLogger.warn("OPKSSH config redirect_uris validation failed", {
      operation: "opkssh_config_redirect_uris_not_localhost",
      configPath: configCheck.configPath,
    });
    ws.send(
      JSON.stringify({
        type: "opkssh_config_error",
        requestId: "",
        error: redirectValidation.message,
        instructions: redirectValidation.message,
      }),
    );
    return "";
  }

  const requestId = randomUUID();
  const remoteRedirectUri = `${requestOrigin}${OPKSSH_CALLBACK_PATH}`;

  sshLogger.info("Starting OPKSSH auth session", {
    operation: "opkssh_start_auth_remote_redirect_uri",
    requestId,
    userId,
    hostId,
    requestOrigin,
    remoteRedirectUri,
    providerAliases: (configCheck.providers || []).map((p) => p.alias),
  });

  const session: Partial<OPKSSHAuthSession> = {
    requestId,
    userId,
    hostId,
    hostname,
    localPort: 0,
    callbackPort: 0,
    remoteRedirectUri,
    providers: configCheck.providers || [],
    status: "starting",
    ws,
    stdoutBuffer: "",
    privateKeyBuffer: "",
    sshCertBuffer: "",
    identity: {},
    createdAt: new Date(),
  };

  try {
    const binaryPath = OPKSSHBinaryManager.getBinaryPath();
    const configPath = getOPKConfigPath();

    const args = [
      "login",
      "--print-key",
      "--disable-browser-open",
      `--config-path=${configPath}`,
      `--remote-redirect-uri=${remoteRedirectUri}`,
    ];

    const opksshProcess = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
      },
    });
    session.process = opksshProcess;

    const cleanup = async () => {
      await cleanupAuthSession(requestId);
    };
    session.cleanup = cleanup;

    const timeout = setTimeout(async () => {
      sshLogger.warn(`OPKSSH auth timeout for session ${requestId}`);
      ws.send(
        JSON.stringify({
          type: "opkssh_timeout",
          requestId,
        }),
      );
      await cleanup();
    }, AUTH_TIMEOUT);

    session.approvalTimeout = timeout;

    ws.on("close", () => {
      cleanup();
    });

    activeAuthSessions.set(requestId, session as OPKSSHAuthSession);

    opksshProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      handleOPKSSHOutput(requestId, output);
    });

    opksshProcess.stderr?.on("data", async (data) => {
      const stderr = data.toString();

      if (
        stderr.includes("Opening browser to") ||
        stderr.includes("Open your browser to:")
      ) {
        handleOPKSSHOutput(requestId, stderr);
      }

      if (stderr.includes("listening on")) {
        handleOPKSSHOutput(requestId, stderr);
      }

      const lowerStderr = stderr.toLowerCase();

      // OPKSSH's openpubkey library rejects non-localhost `redirect_uris` at runtime
      // with the distinctive message "redirectURI must be localhost". Surface that
      // directly with actionable guidance.
      if (lowerStderr.includes("redirecturi must be localhost")) {
        sshLogger.warn("OPKSSH rejected non-localhost entry in redirect_uris", {
          operation: "opkssh_stderr_redirect_uris_not_localhost",
          requestId,
          remoteRedirectUri,
          stderrSnippet: stderr.slice(0, 500),
        });
        ws.send(
          JSON.stringify({
            type: "opkssh_config_error",
            requestId,
            error:
              `OPKSSH rejected the local callback URI: every entry in 'redirect_uris' must be localhost.\n\n` +
              `OPKSSH output:\n${stderr.trim()}\n\n` +
              `The 'redirect_uris' config field is OPKSSH's LOCAL listener — it is not the public Termix callback. ` +
              `Remove any non-localhost entries from redirect_uris (or delete the whole block to use OPKSSH's ` +
              `defaults of :3000, :10001, :11110). Register the public Termix callback URL with your OAuth ` +
              `provider instead, Termix passes it to OPKSSH automatically via --remote-redirect-uri.`,
            instructions: "See documentation: https://docs.termix.site/opkssh",
          }),
        );
        await cleanup();
        return;
      }

      // Generic redirect-uri/mismatch errors (OAuth provider side, OPKSSH config side, etc.)
      const genericRedirectIndicators = [
        "redirect_uri",
        "redirect uri",
        "invalid redirect",
        "no matching redirect",
        "allowed redirect",
        "mismatching redirection",
      ];
      const hasGenericRedirectError = genericRedirectIndicators.some((s) =>
        lowerStderr.includes(s),
      );

      if (hasGenericRedirectError) {
        sshLogger.warn("OPKSSH stderr reported redirect_uri error", {
          operation: "opkssh_stderr_redirect_uri_error",
          requestId,
          remoteRedirectUri,
          stderrSnippet: stderr.slice(0, 500),
        });
        ws.send(
          JSON.stringify({
            type: "opkssh_config_error",
            requestId,
            error:
              `OPKSSH or the OAuth provider rejected the redirect URI.\n\n` +
              `Computed Termix callback URI (sent to provider): ${remoteRedirectUri}\n\n` +
              `OPKSSH output:\n${stderr.trim()}\n\n` +
              `Register '${remoteRedirectUri}' as an authorized redirect URI with your OAuth provider ` +
              `(e.g. in Google Cloud Console → OAuth client). ` +
              `Also confirm any 'redirect_uris' in your OPKSSH config contain ONLY localhost URLs.`,
            instructions: "See documentation: https://docs.termix.site/opkssh",
          }),
        );
        await cleanup();
        return;
      }

      if (
        stderr.includes("provider not found") ||
        stderr.includes("config error") ||
        stderr.includes("invalid config") ||
        stderr.includes("config not found")
      ) {
        ws.send(
          JSON.stringify({
            type: "opkssh_config_error",
            requestId,
            error:
              "OPKSSH configuration error. Please verify your config file contains valid OIDC provider settings.",
            instructions:
              "See documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md",
          }),
        );
        cleanup();
      }

      if (
        stderr.includes("level=error") ||
        stderr.includes("Error:") ||
        stderr.includes("failed")
      ) {
        const isXdgOpenError = stderr.includes('exec: "xdg-open"');
        if (!isXdgOpenError) {
          if (
            stderr.includes("bind: address already in use") ||
            stderr.includes("error logging in") ||
            stderr.includes("failed to start")
          ) {
            await cleanup();
          }
        }
      }
    });

    opksshProcess.on("error", (error) => {
      ws.send(
        JSON.stringify({
          type: "opkssh_error",
          requestId,
          error: `OPKSSH process error: ${error.message}`,
        }),
      );
      cleanup();
    });

    opksshProcess.on("exit", (code) => {
      if (code !== 0 && session.status !== "completed") {
        ws.send(
          JSON.stringify({
            type: "opkssh_error",
            requestId,
            error: `OPKSSH process exited with code ${code}`,
          }),
        );
      }
      cleanup();
    });

    return requestId;
  } catch (error) {
    sshLogger.error(`Failed to start OPKSSH auth session`, error);
    ws.send(
      JSON.stringify({
        type: "opkssh_error",
        requestId,
        error: `Failed to start OPKSSH authentication: ${error instanceof Error ? error.message : "Unknown error"}`,
      }),
    );
    return "";
  }
}

function handleOPKSSHOutput(requestId: string, output: string): void {
  const session = activeAuthSessions.get(requestId);
  if (!session) {
    return;
  }

  session.stdoutBuffer += output;

  const chooserUrlMatch = session.stdoutBuffer.match(
    /(?:Opening browser to|Open your browser to:)\s*http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/chooser/,
  );
  if (chooserUrlMatch && session.status === "starting") {
    const actualPort = parseInt(chooserUrlMatch[1], 10);
    const localChooserUrl = `http://127.0.0.1:${actualPort}/chooser`;

    session.localPort = actualPort;

    const baseUrl = session.remoteRedirectUri
      .replace(/\/host\/opkssh-callback$/, "")
      // In direct dev mode the WS server (30002) is separate from the HTTP API (30001)
      .replace(/:30002\b/, ":30001");
    const proxiedChooserUrl = `${baseUrl}/host/opkssh-chooser/${requestId}`;

    session.status = "waiting_for_auth";
    session.ws.send(
      JSON.stringify({
        type: "opkssh_status",
        requestId,
        stage: "chooser",
        url: proxiedChooserUrl,
        providers: session.providers,
        localUrl: localChooserUrl,
        message: "Please authenticate in your browser",
      }),
    );
  }

  const callbackPortMatch = session.stdoutBuffer.match(
    /listening on http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//,
  );
  if (callbackPortMatch && !session.callbackPort) {
    session.callbackPort = parseInt(callbackPortMatch[1], 10);
  }

  if (output.includes("BEGIN OPENSSH PRIVATE KEY")) {
    session.status = "authenticating";
    session.ws.send(
      JSON.stringify({
        type: "opkssh_status",
        requestId,
        stage: "authenticating",
        message: "Processing authentication...",
      }),
    );
  }

  const privateKeyMatch = session.stdoutBuffer.match(
    /(-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----)/,
  );
  if (privateKeyMatch) {
    session.privateKeyBuffer = privateKeyMatch[1].trim();
  }

  const certMatch = session.stdoutBuffer.match(
    /(ecdsa-sha2-nistp256-cert-v01@openssh\.com\s+[A-Za-z0-9+/=]+|ssh-rsa-cert-v01@openssh\.com\s+[A-Za-z0-9+/=]+|ssh-ed25519-cert-v01@openssh\.com\s+[A-Za-z0-9+/=]+)/,
  );
  if (certMatch) {
    session.sshCertBuffer = certMatch[1].trim();
  }

  const identityMatch = session.stdoutBuffer.match(
    /Email, sub, issuer, audience:\s*\n?\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/,
  );
  if (identityMatch) {
    session.identity = {
      email: identityMatch[1],
      sub: identityMatch[2],
      issuer: identityMatch[3],
      audience: identityMatch[4],
    };
  }

  if (session.privateKeyBuffer && session.sshCertBuffer) {
    if (!session.privateKeyBuffer.includes("BEGIN OPENSSH PRIVATE KEY")) {
      sshLogger.error(`Invalid private key extracted [${requestId}]`, {
        bufferPrefix: session.privateKeyBuffer.substring(0, 50),
      });
      session.ws.send(
        JSON.stringify({
          type: "opkssh_error",
          requestId,
          error: "Failed to extract valid private key from OPKSSH output",
        }),
      );
      return;
    }

    if (!session.sshCertBuffer.match(/-cert-v01@openssh\.com/)) {
      sshLogger.error(`Invalid SSH certificate extracted [${requestId}]`, {
        bufferPrefix: session.sshCertBuffer.substring(0, 50),
      });
      session.ws.send(
        JSON.stringify({
          type: "opkssh_error",
          requestId,
          error: "Failed to extract valid SSH certificate from OPKSSH output",
        }),
      );
      return;
    }

    storeOPKSSHToken(session);
  }
}

async function storeOPKSSHToken(session: OPKSSHAuthSession): Promise<void> {
  try {
    const db = getDb();
    const userCrypto = UserCrypto.getInstance();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const userDataKey = userCrypto.getUserDataKey(session.userId);
    if (!userDataKey) {
      throw new Error("User data key not found");
    }

    const tokenId = `opkssh-${session.userId}-${session.hostId}`;

    const encryptedCert = FieldCrypto.encryptField(
      session.sshCertBuffer,
      userDataKey,
      tokenId,
      "ssh_cert",
    );
    const encryptedKey = FieldCrypto.encryptField(
      session.privateKeyBuffer,
      userDataKey,
      tokenId,
      "private_key",
    );

    await db
      .insert(opksshTokens)
      .values({
        userId: session.userId,
        hostId: session.hostId,
        sshCert: encryptedCert,
        privateKey: encryptedKey,
        email: session.identity.email,
        sub: session.identity.sub,
        issuer: session.identity.issuer,
        audience: session.identity.audience,
        expiresAt: expiresAt.toISOString(),
      })
      .onConflictDoUpdate({
        target: [opksshTokens.userId, opksshTokens.hostId],
        set: {
          sshCert: encryptedCert,
          privateKey: encryptedKey,
          email: session.identity.email,
          sub: session.identity.sub,
          issuer: session.identity.issuer,
          audience: session.identity.audience,
          expiresAt: expiresAt.toISOString(),
          createdAt: new Date().toISOString(),
        },
      });

    session.status = "completed";
    session.ws.send(
      JSON.stringify({
        type: "opkssh_completed",
        requestId: session.requestId,
        expiresAt: expiresAt.toISOString(),
      }),
    );

    await session.cleanup();
  } catch (error) {
    sshLogger.error(
      `Failed to store OPKSSH token for session ${session.requestId}`,
      error,
    );
    session.ws.send(
      JSON.stringify({
        type: "opkssh_error",
        requestId: session.requestId,
        error: "Failed to store authentication token",
      }),
    );
    await session.cleanup();
  }
}

export async function getOPKSSHToken(
  userId: string,
  hostId: number,
): Promise<{ sshCert: string; privateKey: string } | null> {
  try {
    const db = getDb();
    const token = await db
      .select()
      .from(opksshTokens)
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      )
      .limit(1);

    if (!token || token.length === 0) {
      return null;
    }

    const tokenData = token[0];
    const expiresAt = new Date(tokenData.expiresAt);

    if (expiresAt < new Date()) {
      await db
        .delete(opksshTokens)
        .where(
          and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
        );
      return null;
    }

    const userCrypto = UserCrypto.getInstance();
    const userDataKey = userCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error("User data key not found");
    }

    const tokenId = `opkssh-${userId}-${hostId}`;
    const decryptedCert = FieldCrypto.decryptField(
      tokenData.sshCert,
      userDataKey,
      tokenId,
      "ssh_cert",
    );
    const decryptedKey = FieldCrypto.decryptField(
      tokenData.privateKey,
      userDataKey,
      tokenId,
      "private_key",
    );

    await db
      .update(opksshTokens)
      .set({ lastUsed: new Date().toISOString() })
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      );

    return {
      sshCert: decryptedCert,
      privateKey: decryptedKey,
    };
  } catch (error) {
    sshLogger.error(`Failed to retrieve OPKSSH token`, error);
    return null;
  }
}

export async function deleteOPKSSHToken(
  userId: string,
  hostId: number,
): Promise<void> {
  const db = getDb();
  await db
    .delete(opksshTokens)
    .where(
      and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
    );
}

export async function invalidateOPKSSHToken(
  userId: string,
  hostId: number,
  reason: string,
): Promise<void> {
  try {
    const db = getDb();
    await db
      .delete(opksshTokens)
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      );
  } catch (error) {
    sshLogger.error(`Failed to invalidate OPKSSH token`, {
      userId,
      hostId,
      reason,
      error,
    });
  }
}

export async function handleOAuthCallback(
  requestId: string,
  queryString: string,
): Promise<{ success: boolean; message?: string }> {
  const session = activeAuthSessions.get(requestId);

  if (!session) {
    return { success: false, message: "Invalid authentication session" };
  }

  try {
    const callbackUrl = `http://127.0.0.1:${session.localPort}/login-callback?${queryString}`;
    await axios.get(callbackUrl, {
      timeout: 10000,
      validateStatus: () => true,
    });
    return { success: true };
  } catch {
    session.ws.send(
      JSON.stringify({
        type: "opkssh_error",
        requestId,
        error: "Failed to complete authentication",
      }),
    );
    await session.cleanup();
    return { success: false, message: "Authentication failed" };
  }
}

async function cleanupAuthSession(requestId: string): Promise<void> {
  if (cleanupInProgress.has(requestId)) {
    return;
  }

  cleanupInProgress.add(requestId);

  try {
    const session = activeAuthSessions.get(requestId);
    if (!session) {
      cleanupInProgress.delete(requestId);
      return;
    }

    if (session.approvalTimeout) {
      clearTimeout(session.approvalTimeout);
    }

    if (session.process) {
      try {
        session.process.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const killTimeout = setTimeout(() => {
            if (session.process && !session.process.killed) {
              session.process.kill("SIGKILL");
            }
            resolve();
          }, 3000);

          session.process.once("exit", () => {
            clearTimeout(killTimeout);
            resolve();
          });
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (killError) {
        sshLogger.warn(
          `Failed to kill OPKSSH process for session ${requestId}`,
          killError,
        );
      }
    }

    // Clean up any OAuth state mappings for this session
    for (const [state, reqId] of oauthStateToRequestId.entries()) {
      if (reqId === requestId) {
        oauthStateToRequestId.delete(state);
      }
    }

    activeAuthSessions.delete(requestId);
  } finally {
    cleanupInProgress.delete(requestId);
  }
}

export function cancelAuthSession(requestId: string): void {
  const session = activeAuthSessions.get(requestId);
  if (session) {
    session.cleanup();
  }
}

export function getActiveAuthSession(
  requestId: string,
): OPKSSHAuthSession | undefined {
  return activeAuthSessions.get(requestId);
}

export function getActiveSessionsForUser(userId: string): OPKSSHAuthSession[] {
  const sessions: OPKSSHAuthSession[] = [];
  for (const session of activeAuthSessions.values()) {
    if (session.userId === userId) {
      sessions.push(session);
    }
  }
  return sessions;
}

export function getActiveSessionsAll(): OPKSSHAuthSession[] {
  return Array.from(activeAuthSessions.values());
}

export function registerOAuthState(state: string, requestId: string): void {
  oauthStateToRequestId.set(state, requestId);
}

export function getRequestIdByOAuthState(state: string): string | undefined {
  return oauthStateToRequestId.get(state);
}

export function clearOAuthState(state: string): void {
  oauthStateToRequestId.delete(state);
}

export async function getUserIdFromRequest(req: {
  cookies?: Record<string, string>;
  headers: Record<string, string | undefined>;
}): Promise<string | null> {
  try {
    const { AuthManager } = await import("../utils/auth-manager.js");
    const authManager = AuthManager.getInstance();

    const token =
      req.cookies?.jwt || req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return null;
    }

    const decoded = await authManager.verifyJWTToken(token);
    return decoded?.userId || null;
  } catch {
    return null;
  }
}
