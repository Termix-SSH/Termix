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

const MIN_PORT = 40001;
const MAX_PORT = 40999;
const AUTH_TIMEOUT = 5 * 60 * 1000;

interface OPKSSHAuthSession {
  requestId: string;
  userId: string;
  hostId: number;
  hostname: string;
  process: ChildProcess;
  localPort: number;
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
const portAllocationMap = new Map<number, string>();
const cleanupInProgress = new Set<string>();

export function getRequestOrigin(req: IncomingMessage): string {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function allocatePort(): number | null {
  for (let port = MIN_PORT; port <= MAX_PORT; port++) {
    if (!portAllocationMap.has(port)) {
      return port;
    }
  }
  return null;
}

function releasePort(port: number): void {
  portAllocationMap.delete(port);
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
# See documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md

# Configure your OpenID providers below
providers:
  # Google OAuth Example
  # - alias: google
  #   issuer: https://accounts.google.com
  #   client_id: YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
  #   scopes: "openid email profile"
  #   redirect_uris:
  #     - http://localhost:3000/login-callback
  #     - http://localhost:10001/login-callback

  # Microsoft/Azure AD Example
  # - alias: microsoft
  #   issuer: https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0
  #   client_id: YOUR_AZURE_CLIENT_ID
  #   scopes: "openid profile email offline_access"
  #   redirect_uris:
  #     - http://localhost:3000/login-callback
  #     - http://localhost:10001/login-callback

  # GitLab Example
  # - alias: gitlab
  #   issuer: https://gitlab.com
  #   client_id: YOUR_GITLAB_CLIENT_ID
  #   scopes: "openid profile email"
  #   redirect_uris:
  #     - http://localhost:3000/login-callback
  #     - http://localhost:10001/login-callback

# To get started:
# 1. Uncomment one of the provider examples above or add a new one
# 2. Replace the prefilled ID's
# 4. Save this file and restart the connection
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

  try {
    const content = await fs.readFile(configPath, "utf8");

    if (!content.includes("providers:")) {
      return {
        exists: false,
        configPath,
        error: `OPKSSH configuration is missing 'providers' section. Please edit the config file at:\n${configPath}\n\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md`,
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
        error: `OPKSSH configuration has no active providers. Please edit the config file at:\n${configPath}\n\nUncomment and configure at least one OIDC provider.\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md`,
      };
    }

    return { exists: true, configPath };
  } catch {
    await createTemplateConfig();
    return {
      exists: false,
      configPath,
      error: `OPKSSH configuration not found. A template config file has been created at:\n${configPath}\n\nPlease edit this file and configure your OIDC provider (Google, GitHub, Microsoft, etc.).\nSee documentation: https://github.com/openpubkey/opkssh/blob/main/docs/config.md`,
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

  const localPort = allocatePort();
  if (!localPort) {
    ws.send(
      JSON.stringify({
        type: "opkssh_error",
        requestId: "",
        error:
          "No available ports for OPKSSH authentication. Please try again later.",
      }),
    );
    return "";
  }

  const requestId = randomUUID();
  const remoteRedirectUri = `${requestOrigin}/opkssh-callback/${requestId}`;

  const session: Partial<OPKSSHAuthSession> = {
    requestId,
    userId,
    hostId,
    hostname,
    localPort,
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
    const redirectUri = `http://localhost:${localPort}/login-callback`;
    const configPath = getOPKConfigPath();
    const configDir = path.dirname(configPath);

    const opksshProcess = spawn(
      binaryPath,
      [
        "login",
        "--print-key",
        `--redirect-uri=${redirectUri}`,
        `--remote-redirect-uri=${remoteRedirectUri}`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPK_CONFIG_DIR: configDir,
        },
      },
    );
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

    activeAuthSessions.set(requestId, session as OPKSSHAuthSession);
    portAllocationMap.set(localPort, requestId);

    opksshProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      handleOPKSSHOutput(requestId, output);
    });

    opksshProcess.stderr?.on("data", (data) => {
      const stderr = data.toString();
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
    releasePort(localPort);
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
    /Opening browser to (http:\/\/localhost:\d+\/chooser)/,
  );
  if (chooserUrlMatch && session.status === "starting") {
    const chooserUrl = chooserUrlMatch[1];
    session.status = "waiting_for_auth";
    session.ws.send(
      JSON.stringify({
        type: "opkssh_status",
        requestId,
        stage: "chooser",
        url: chooserUrl,
        message: "Please authenticate in your browser",
      }),
    );
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
    /(ecdsa-sha2-nistp256-cert-v01@openssh\.com[^\s]+|ssh-rsa-cert-v01@openssh\.com[^\s]+|ssh-ed25519-cert-v01@openssh\.com[^\s]+)/,
  );
  if (certMatch) {
    session.sshCertBuffer = certMatch[1].trim();
  }

  const identityMatch = session.stdoutBuffer.match(
    /Email, sub, issuer, audience:\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/,
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
          }, 5000);

          session.process.once("exit", () => {
            clearTimeout(killTimeout);
            resolve();
          });
        });
      } catch (killError) {
        sshLogger.warn(
          `Failed to kill OPKSSH process for session ${requestId}`,
          killError,
        );
      }
    }

    releasePort(session.localPort);
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
