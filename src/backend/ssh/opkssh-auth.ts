import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import { IncomingMessage } from "http";
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

const AUTH_TIMEOUT = 60 * 1000;

interface OPKSSHAuthSession {
  requestId: string;
  userId: string;
  hostId: number;
  hostname: string;
  process: ChildProcess;
  localPort: number;
  callbackPort: number;
  remoteRedirectUri: string;
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
const cleanupInProgress = new Set<string>();

export function getRequestOrigin(req: IncomingMessage): string {
  const protoHeader =
    req.headers["x-forwarded-proto"] ||
    ((req.socket as any).encrypted ? "https" : "http");
  const proto =
    typeof protoHeader === "string"
      ? protoHeader.split(",")[0].trim()
      : String(protoHeader);

  const portHeader = req.headers["x-forwarded-port"];
  const port =
    typeof portHeader === "string"
      ? portHeader.split(",")[0].trim()
      : undefined;

  const hostHeaderRaw =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const hostHeader =
    typeof hostHeaderRaw === "string"
      ? hostHeaderRaw.split(",")[0].trim()
      : String(hostHeaderRaw);

  if (port) {
    const hostWithoutPort = hostHeader.split(":")[0];
    const isDefaultPort =
      (proto === "http" && port === "80") ||
      (proto === "https" && port === "443");
    return isDefaultPort
      ? `${proto}://${hostWithoutPort}`
      : `${proto}://${hostWithoutPort}:${port}`;
  }

  return `${proto}://${hostHeader}`;
}

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

async function checkOPKConfigExists(): Promise<{
  exists: boolean;
  error?: string;
  configPath?: string;
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

    if (!content.includes("redirect_uris:")) {
      return {
        exists: false,
        configPath,
        error: `OPKSSH configuration is missing 'redirect_uris' field.`,
      };
    }

    return { exists: true, configPath };
  } catch {
    await createTemplateConfig();
    return {
      exists: false,
      configPath,
      error: `OPKSSH configuration not found. A template config file has been created at:\n${configPath}\n\nPlease edit this file and configure your OIDC provider (Google, GitHub, Microsoft, etc.).\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md${dockerHint}`,
    };
  }
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

  const requestId = randomUUID();
  const remoteRedirectUri = `${requestOrigin}/ssh/opkssh-callback`;

  const session: Partial<OPKSSHAuthSession> = {
    requestId,
    userId,
    hostId,
    hostname,
    localPort: 0,
    callbackPort: 0,
    remoteRedirectUri,
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
    const configDir = path.dirname(configPath);

    const args = [
      "login",
      "--print-key",
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

      if (stderr.includes("Opening browser to")) {
        handleOPKSSHOutput(requestId, stderr);
      }

      if (stderr.includes("listening on")) {
        handleOPKSSHOutput(requestId, stderr);
      }

      if (stderr.includes("provider not found") || stderr.includes("config")) {
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
    /Opening browser to http:\/\/localhost:(\d+)\/chooser/,
  );
  if (chooserUrlMatch && session.status === "starting") {
    const actualPort = parseInt(chooserUrlMatch[1], 10);
    const localChooserUrl = `http://localhost:${actualPort}/chooser`;

    session.localPort = actualPort;

    const baseUrl = session.remoteRedirectUri.replace(
      /\/ssh\/opkssh-callback$/,
      "",
    );
    const proxiedChooserUrl = `${baseUrl}/ssh/opkssh-chooser/${requestId}`;

    session.status = "waiting_for_auth";
    session.ws.send(
      JSON.stringify({
        type: "opkssh_status",
        requestId,
        stage: "chooser",
        url: proxiedChooserUrl,
        localUrl: localChooserUrl,
        message: "Please authenticate in your browser",
      }),
    );
  }

  const callbackPortMatch = session.stdoutBuffer.match(
    /listening on http:\/\/127\.0\.0\.1:(\d+)\//,
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

    try {
      await axios.post(
        "http://localhost:30006/activity/log",
        {
          type: "opkssh_authentication",
          hostId: session.hostId,
          hostName: session.hostname,
          status: "approved",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.INTERNAL_AUTH_TOKEN}`,
          },
        },
      );
    } catch (activityError) {
      sshLogger.warn("Failed to log OPKSSH activity", activityError);
    }

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
    const callbackUrl = `http://localhost:${session.localPort}/login-callback?${queryString}`;
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

export async function getUserIdFromRequest(req: any): Promise<string | null> {
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
  } catch (error) {
    return null;
  }
}
