import express from "express";
import cookieParser from "cookie-parser";
import { Client, type ConnectConfig } from "ssh2";
import { eq, and } from "drizzle-orm";
import { createCorsMiddleware } from "../utils/cors-config.js";
import { AuthManager } from "../utils/auth-manager.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { tmuxSessionTags, users } from "../database/db/schema.js";
import { logAudit, getRequestMeta } from "../utils/audit-logger.js";
import { sshLogger } from "../utils/logger.js";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";
import { resolveHostById, checkHostAccess } from "./host-resolver.js";
import { createJumpHostChain } from "./jump-host-chain.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../utils/socks5-helper.js";
import { withConnection } from "./ssh-connection-pool.js";
import { execCommand } from "./tmux-helper.js";
import {
  SEP,
  parseSessions,
  parseWindows,
  parsePanes,
  parsePsOutput,
  parseGpuOutput,
  buildPaneMetrics,
  attachPanesToWindows,
  shellEscape,
  type RawPane,
  type TmuxSessionSummary,
  type TmuxWindow,
  type PaneMetrics,
} from "./tmux-monitor-helpers.js";
import type { SSHHost, AuthenticatedRequest } from "../../types/index.js";

const PANE_ID_RE = /^%\d+$/;
// tmux session names cannot contain ":" or "."; keep to a conservative
// printable subset so the name is safe as a tmux target everywhere.
const SESSION_NAME_RE = /^[A-Za-z0-9_@%+=-]{1,64}$/;
const MAX_SEARCH_PANES = 100;
const MAX_MATCHES_PER_PANE = 50;
const SEARCH_HISTORY_LINES = 2000;
const SEARCH_CONCURRENCY = 4;

interface TmuxSessionOverview extends TmuxSessionSummary {
  windows: TmuxWindow[];
  tags: string[];
}

// ---------------------------------------------------------------------------
// SSH connection (lean variant of the per-module pattern used by server-stats
// and docker; jump hosts and SOCKS5 reuse the shared helpers)
// ---------------------------------------------------------------------------

async function buildSshConfig(host: SSHHost): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: (host.ip || "").replace(/^\[|\]$/g, ""),
    port: host.port,
    username: host.username,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 60000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      host.id,
      host.ip,
      host.port,
      null,
      host.userId || "",
      false,
    ),
    algorithms: SSH_ALGORITHMS,
  } as ConnectConfig;

  if (host.authType === "password") {
    if (!host.password) {
      throw new Error(`No password available for host ${host.ip}`);
    }
    base.password = host.password;
  } else if (host.authType === "key") {
    if (!host.key || !host.key.includes("-----BEGIN")) {
      throw new Error(`No valid SSH key available for host ${host.ip}`);
    }
    const cleanKey = host.key
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    (base as Record<string, unknown>).privateKey = Buffer.from(
      cleanKey,
      "utf8",
    );
    if (host.keyPassword) {
      (base as Record<string, unknown>).passphrase = host.keyPassword;
    }
  } else if (host.authType === "none") {
    // no credentials needed
  } else {
    // opkssh and other interactive flows are not supported by this module
    throw new Error(
      `Authentication type '${host.authType}' is not supported by the tmux monitor. Open a terminal connection instead.`,
    );
  }

  return base;
}

export function connectToHost(host: SSHHost): () => Promise<Client> {
  return async () => {
    const config = await buildSshConfig(host);
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

    let jumpClient: Client | null = null;
    if (host.jumpHosts && host.jumpHosts.length > 0 && host.userId) {
      jumpClient = await createJumpHostChain(
        host.jumpHosts,
        host.userId,
        proxyConfig,
      );
      if (!jumpClient) {
        throw new Error("Failed to establish jump host chain");
      }
    } else if (proxyConfig) {
      const proxySocket = await createSocks5Connection(
        host.ip,
        host.port,
        proxyConfig,
      );
      if (proxySocket) {
        config.sock = proxySocket;
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
      client.on("error", (err) => {
        clearTimeout(timeout);
        jumpClient?.end();
        reject(err);
      });
      client.on(
        "keyboard-interactive",
        (_name, _instructions, _lang, prompts, finish) => {
          finish(
            prompts.map((p) =>
              /password/i.test(p.prompt) ? host.password || "" : "",
            ),
          );
        },
      );

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
      } else {
        client.connect(config);
      }
    });
  };
}

function getPoolKey(host: SSHHost): string {
  const socks5Key = host.useSocks5
    ? `:socks5:${host.socks5Host}:${host.socks5Port}`
    : "";
  return `tmux-monitor:${host.userId}:${host.ip}:${host.port}:${host.username}${socks5Key}`;
}

async function withHostConnection<T>(
  host: SSHHost,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return withConnection(getPoolKey(host), connectToHost(host), fn);
}

// ---------------------------------------------------------------------------
// tmux queries
// ---------------------------------------------------------------------------

async function tmuxAvailable(conn: Client): Promise<boolean> {
  try {
    await execCommand(conn, "command -v tmux");
    return true;
  } catch {
    return false;
  }
}

async function runTmuxList(conn: Client, command: string): Promise<string> {
  try {
    return await execCommand(conn, command);
  } catch {
    return ""; // tmux server not running -- no sessions
  }
}

function listSessionsCmd(): string {
  return `tmux list-sessions -F "#{session_name}${SEP}#{session_created}${SEP}#{session_activity}${SEP}#{session_attached}" 2>/dev/null`;
}

function listWindowsCmd(): string {
  return `tmux list-windows -a -F "#{session_name}${SEP}#{window_index}${SEP}#{window_active}${SEP}#{window_name}" 2>/dev/null`;
}

function listPanesCmd(): string {
  return `tmux list-panes -a -F "#{session_name}${SEP}#{window_index}${SEP}#{pane_id}${SEP}#{pane_index}${SEP}#{pane_pid}${SEP}#{pane_active}${SEP}#{pane_width}${SEP}#{pane_height}${SEP}#{pane_current_command}${SEP}#{pane_current_path}${SEP}#{pane_title}" 2>/dev/null`;
}

async function listPanesRaw(conn: Client): Promise<RawPane[]> {
  return parsePanes(await runTmuxList(conn, listPanesCmd()));
}

async function fetchSessionTags(
  userId: string,
  hostId: number,
): Promise<Map<string, string[]>> {
  const rows = await getDb()
    .select()
    .from(tmuxSessionTags)
    .where(
      and(
        eq(tmuxSessionTags.userId, userId),
        eq(tmuxSessionTags.hostId, hostId),
      ),
    );
  const bySession = new Map<string, string[]>();
  for (const row of rows) {
    if (!bySession.has(row.sessionName)) bySession.set(row.sessionName, []);
    bySession.get(row.sessionName)!.push(row.tag);
  }
  return bySession;
}

async function collectPaneMetrics(
  conn: Client,
  panes: RawPane[],
): Promise<PaneMetrics[]> {
  let psOutput = "";
  try {
    psOutput = await execCommand(
      conn,
      "ps -eo pid=,ppid=,pcpu=,pmem=,rss=,comm= 2>/dev/null",
    );
  } catch {
    return [];
  }

  // GPU memory per pid (best effort; nvidia-smi may not exist)
  let gpuOutput = "";
  try {
    gpuOutput = await execCommand(
      conn,
      "command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || true",
    );
  } catch {
    // no GPU on host
  }

  return buildPaneMetrics(
    panes,
    parsePsOutput(psOutput),
    parseGpuOutput(gpuOutput),
  );
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
const authManager = AuthManager.getInstance();

app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(authManager.createAuthMiddleware());

/**
 * Resolve the host for a request and verify the user can access it.
 * Sends the error response and returns null when access is denied.
 */
async function requireHost(
  req: express.Request,
  res: express.Response,
  permission: "read" | "execute" = "read",
): Promise<SSHHost | null> {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const hostId = parseInt(String(req.params.hostId), 10);
  if (isNaN(hostId)) {
    res.status(400).json({ error: "Invalid host ID" });
    return null;
  }
  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    res.status(401).json({ error: "User data is locked" });
    return null;
  }

  let host: SSHHost | null = null;
  try {
    host = await resolveHostById(hostId, userId);
  } catch (err) {
    sshLogger.error(`Failed to resolve host ${hostId} for tmux monitor`, err);
  }
  if (!host) {
    res.status(404).json({ error: "Host not found" });
    return null;
  }

  const hasAccess = await checkHostAccess(
    hostId,
    userId,
    host.userId || userId,
    permission,
  );
  if (!hasAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  // The monitor is opt-in per host (same pattern as enableDocker in
  // docker.ts): hiding the UI is not enough, the API must refuse too.
  if (!host.enableTmuxMonitor) {
    res
      .status(403)
      .json({ error: "Tmux Monitor is not enabled for this host" });
    return null;
  }
  return host;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// Destructive tmux actions terminate processes on the remote host, so they
// land in the audit log like other host-level mutations (see host.ts).
async function auditTmuxAction(
  req: express.Request,
  host: SSHHost,
  action: string,
  resourceName: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const { ipAddress, userAgent } = getRequestMeta(req);
  let username = userId;
  try {
    const actor = await getDb()
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    username = actor[0]?.username ?? userId;
  } catch {
    // fall back to the raw user id
  }
  await logAudit({
    userId,
    username,
    action,
    resourceType: "host",
    resourceId: String(host.id),
    resourceName,
    details: details ? JSON.stringify(details) : undefined,
    ipAddress,
    userAgent,
    success: true,
  });
}

// Typed error codes so the frontend can render a helpful state instead of a
// raw 500 (same pattern as SESSION_EXPIRED handling in main-axios).
type TmuxErrorCode =
  | "TMUX_NOT_INSTALLED"
  | "TMUX_NO_SERVER"
  | "HOST_UNREACHABLE"
  | "TMUX_ERROR";

function classifyTmuxError(err: unknown): TmuxErrorCode {
  const msg = err instanceof Error ? err.message : "";
  if (/command not found|exited with code 127/i.test(msg))
    return "TMUX_NOT_INSTALLED";
  if (/no server running|lost server/i.test(msg)) return "TMUX_NO_SERVER";
  if (
    /timeout|timed out|econnrefused|ehostunreach|enotfound|enetunreach|econnreset|authentication|handshake|keepalive/i.test(
      msg,
    )
  )
    return "HOST_UNREACHABLE";
  return "TMUX_ERROR";
}

function sendTmuxError(
  res: express.Response,
  err: unknown,
  context: string,
  hostId: number,
): void {
  const code = classifyTmuxError(err);
  const status = code === "TMUX_ERROR" ? 500 : 503;
  const error =
    code === "TMUX_NOT_INSTALLED"
      ? "tmux is not installed on this host"
      : code === "TMUX_NO_SERVER"
        ? "No tmux server is running on this host"
        : code === "HOST_UNREACHABLE"
          ? "Could not connect to the host"
          : toErrorMessage(err);
  sshLogger.error(`tmux ${context} failed for host ${hostId}`, err);
  res.status(status).json({ error, code });
}

app.get("/tmux_monitor/:hostId/overview", async (req, res) => {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const host = await requireHost(req, res);
  if (!host) return;

  try {
    const result = await withHostConnection(host, async (conn) => {
      if (!(await tmuxAvailable(conn))) {
        return { available: false, sessions: [] as TmuxSessionOverview[] };
      }
      const [sessionsOut, windowsOut, panesOut] = await Promise.all([
        runTmuxList(conn, listSessionsCmd()),
        runTmuxList(conn, listWindowsCmd()),
        runTmuxList(conn, listPanesCmd()),
      ]);
      const sessions = parseSessions(sessionsOut);
      const windows = parseWindows(windowsOut);
      attachPanesToWindows(windows, parsePanes(panesOut));

      const tags = await fetchSessionTags(userId, host.id);
      const full: TmuxSessionOverview[] = sessions.map((s) => ({
        ...s,
        windows: windows.get(s.name) || [],
        tags: tags.get(s.name) || [],
      }));
      return { available: true, sessions: full };
    });
    res.json(result);
  } catch (err) {
    sendTmuxError(res, err, "overview", host.id);
  }
});

// Focus a pane: select its window and pane on the server so every attached
// client (including the monitor's embedded terminal) switches to it.
app.post("/tmux_monitor/:hostId/focus", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const paneId = String((req.body as { paneId?: string })?.paneId || "");
  if (!PANE_ID_RE.test(paneId)) {
    return res.status(400).json({ error: "Invalid pane ID" });
  }

  try {
    await withHostConnection(host, (conn) =>
      // A pane id is a valid window target: tmux resolves it to the window
      // containing the pane.
      execCommand(
        conn,
        `tmux select-window -t ${shellEscape(paneId)} \\; select-pane -t ${shellEscape(paneId)}`,
      ),
    );
    res.json({ ok: true });
  } catch (err) {
    sendTmuxError(res, err, "focus", host.id);
  }
});

// Create a detached session. Starts the tmux server if none is running.
app.post("/tmux_monitor/:hostId/sessions", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const name = String((req.body as { name?: string })?.name || "").trim();
  if (!SESSION_NAME_RE.test(name)) {
    return res.status(400).json({ error: "Invalid session name" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(conn, `tmux new-session -d -s ${shellEscape(name)}`),
    );
    sshLogger.info("tmux session created", {
      operation: "tmux_session_create",
      hostId: host.id,
      sessionName: name,
    });
    res.json({ ok: true, name });
  } catch (err) {
    if (/duplicate session/i.test(toErrorMessage(err))) {
      return res
        .status(409)
        .json({ error: "A session with this name already exists" });
    }
    sendTmuxError(res, err, "create session", host.id);
  }
});

// Create a window in an existing session. The session name comes from tmux's
// own listing, so it is only checked for characters that would change the
// target's meaning (":" and "." are window/pane separators in tmux targets);
// "=" prefixes the target for an exact-name match.
app.post("/tmux_monitor/:hostId/windows", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const sessionName = String(
    (req.body as { sessionName?: string })?.sessionName || "",
  ).trim();
  if (!sessionName || /[:.\n]/.test(sessionName)) {
    return res.status(400).json({ error: "Invalid session name" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(conn, `tmux new-window -t ${shellEscape(`=${sessionName}`)}`),
    );
    sshLogger.info("tmux window created", {
      operation: "tmux_window_create",
      hostId: host.id,
      sessionName,
    });
    res.json({ ok: true });
  } catch (err) {
    if (/can't find session|no such session/i.test(toErrorMessage(err))) {
      return res.status(404).json({ error: "Session not found" });
    }
    sendTmuxError(res, err, "create window", host.id);
  }
});

// Rename a session. Saved tags follow the session to its new name (for every
// user — the session itself is shared on the host).
app.post("/tmux_monitor/:hostId/rename", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const body = req.body as { sessionName?: string; newName?: string };
  const sessionName = String(body?.sessionName || "").trim();
  const newName = String(body?.newName || "").trim();
  if (!sessionName || /[:.\n]/.test(sessionName)) {
    return res.status(400).json({ error: "Invalid session name" });
  }
  if (!SESSION_NAME_RE.test(newName)) {
    return res.status(400).json({ error: "Invalid new session name" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(
        conn,
        `tmux rename-session -t ${shellEscape(`=${sessionName}`)} ${shellEscape(newName)}`,
      ),
    );
    await getDb()
      .update(tmuxSessionTags)
      .set({ sessionName: newName })
      .where(
        and(
          eq(tmuxSessionTags.hostId, host.id),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );
    await DatabaseSaveTrigger.triggerSave("tmux_session_tags_updated");
    sshLogger.info("tmux session renamed", {
      operation: "tmux_session_rename",
      hostId: host.id,
      sessionName,
      newName,
    });
    await auditTmuxAction(req, host, "tmux_session_rename", sessionName, {
      newName,
    });
    res.json({ ok: true, name: newName });
  } catch (err) {
    if (/can't find session|no such session/i.test(toErrorMessage(err))) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (/duplicate session/i.test(toErrorMessage(err))) {
      return res
        .status(409)
        .json({ error: "A session with this name already exists" });
    }
    sendTmuxError(res, err, "rename session", host.id);
  }
});

// Kill a session and drop its saved tags.
app.post("/tmux_monitor/:hostId/kill", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const sessionName = String(
    (req.body as { sessionName?: string })?.sessionName || "",
  ).trim();
  if (!sessionName || /[:.\n]/.test(sessionName)) {
    return res.status(400).json({ error: "Invalid session name" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(
        conn,
        `tmux kill-session -t ${shellEscape(`=${sessionName}`)}`,
      ),
    );
    await getDb()
      .delete(tmuxSessionTags)
      .where(
        and(
          eq(tmuxSessionTags.hostId, host.id),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );
    await DatabaseSaveTrigger.triggerSave("tmux_session_tags_updated");
    sshLogger.info("tmux session killed", {
      operation: "tmux_session_kill",
      hostId: host.id,
      sessionName,
    });
    await auditTmuxAction(req, host, "tmux_session_kill", sessionName);
    res.json({ ok: true });
  } catch (err) {
    if (/can't find session|no such session/i.test(toErrorMessage(err))) {
      return res.status(404).json({ error: "Session not found" });
    }
    sendTmuxError(res, err, "kill session", host.id);
  }
});

// Kill a window (and every pane in it). Killing the last window of a session
// ends the session — tmux semantics.
app.post("/tmux_monitor/:hostId/kill-window", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const body = req.body as { sessionName?: string; windowIndex?: number };
  const sessionName = String(body?.sessionName || "").trim();
  const windowIndex = Number(body?.windowIndex);
  if (!sessionName || /[:.\n]/.test(sessionName)) {
    return res.status(400).json({ error: "Invalid session name" });
  }
  if (!Number.isInteger(windowIndex) || windowIndex < 0) {
    return res.status(400).json({ error: "Invalid window index" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(
        conn,
        `tmux kill-window -t ${shellEscape(`=${sessionName}:${windowIndex}`)}`,
      ),
    );
    sshLogger.info("tmux window killed", {
      operation: "tmux_window_kill",
      hostId: host.id,
      sessionName,
      windowIndex,
    });
    await auditTmuxAction(req, host, "tmux_window_kill", sessionName, {
      windowIndex,
    });
    res.json({ ok: true });
  } catch (err) {
    if (
      /can't find window|no such window|can't find session/i.test(
        toErrorMessage(err),
      )
    ) {
      return res.status(404).json({ error: "Window not found" });
    }
    sendTmuxError(res, err, "kill window", host.id);
  }
});

// Kill a single pane. Killing the last pane of a window closes the window,
// and the last window of a session ends the session — tmux semantics.
app.post("/tmux_monitor/:hostId/kill-pane", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const paneId = String((req.body as { paneId?: string })?.paneId || "");
  if (!PANE_ID_RE.test(paneId)) {
    return res.status(400).json({ error: "Invalid pane ID" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(conn, `tmux kill-pane -t ${shellEscape(paneId)}`),
    );
    sshLogger.info("tmux pane killed", {
      operation: "tmux_pane_kill",
      hostId: host.id,
      paneId,
    });
    await auditTmuxAction(req, host, "tmux_pane_kill", paneId);
    res.json({ ok: true });
  } catch (err) {
    if (/can't find pane|no such pane/i.test(toErrorMessage(err))) {
      return res.status(404).json({ error: "Pane not found" });
    }
    sendTmuxError(res, err, "kill pane", host.id);
  }
});

// Split the window containing a pane. "h" places the new pane to the right,
// "v" below — matching tmux's own -h/-v semantics. The new pane starts in the
// source pane's working directory.
app.post("/tmux_monitor/:hostId/split", async (req, res) => {
  const host = await requireHost(req, res, "execute");
  if (!host) return;

  const body = req.body as { paneId?: string; direction?: string };
  const paneId = String(body?.paneId || "");
  const direction = body?.direction === "v" ? "-v" : "-h";
  if (!PANE_ID_RE.test(paneId)) {
    return res.status(400).json({ error: "Invalid pane ID" });
  }
  if (body?.direction !== "h" && body?.direction !== "v") {
    return res.status(400).json({ error: "Invalid split direction" });
  }

  try {
    await withHostConnection(host, (conn) =>
      execCommand(
        conn,
        `tmux split-window ${direction} -t ${shellEscape(paneId)} -c ${shellEscape("#{pane_current_path}")}`,
      ),
    );
    sshLogger.info("tmux pane split", {
      operation: "tmux_pane_split",
      hostId: host.id,
      paneId,
      direction: body.direction,
    });
    res.json({ ok: true });
  } catch (err) {
    sendTmuxError(res, err, "split", host.id);
  }
});

app.get("/tmux_monitor/:hostId/search", async (req, res) => {
  const host = await requireHost(req, res);
  if (!host) return;

  const query = String(req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing search query" });
  }

  try {
    const results = await withHostConnection(host, async (conn) => {
      const allPanes = await listPanesRaw(conn);
      const panes = allPanes.slice(0, MAX_SEARCH_PANES);
      // Flips to true whenever a limit was hit, so the UI can tell the user
      // the results are partial instead of silently truncating.
      let truncated = allPanes.length > MAX_SEARCH_PANES;
      const matches: Array<{
        paneId: string;
        sessionName: string;
        windowIndex: number;
        line: number;
        text: string;
      }> = [];

      // Bounded concurrency; each search runs capture+grep remotely so only
      // matching lines travel back over the wire.
      for (let i = 0; i < panes.length; i += SEARCH_CONCURRENCY) {
        const batch = panes.slice(i, i + SEARCH_CONCURRENCY);
        await Promise.all(
          batch.map(async (pane) => {
            try {
              const output = await execCommand(
                conn,
                `tmux capture-pane -p -J -t ${shellEscape(pane.id)} -S -${SEARCH_HISTORY_LINES} 2>/dev/null | grep -n -i -F -- ${shellEscape(query)} | head -${MAX_MATCHES_PER_PANE}`,
              );
              const lines = output.split("\n").filter(Boolean);
              if (lines.length >= MAX_MATCHES_PER_PANE) truncated = true;
              for (const line of lines) {
                const sep = line.indexOf(":");
                if (sep === -1) continue;
                matches.push({
                  paneId: pane.id,
                  sessionName: pane.sessionName,
                  windowIndex: pane.windowIndex,
                  line: parseInt(line.slice(0, sep), 10) || 0,
                  text: line.slice(sep + 1).slice(0, 500),
                });
              }
            } catch {
              // grep exits non-zero when there are no matches -- not an error
            }
          }),
        );
      }
      return { matches, truncated };
    });
    res.json({
      query,
      matches: results.matches,
      truncated: results.truncated,
      searchedLines: SEARCH_HISTORY_LINES,
      maxPanes: MAX_SEARCH_PANES,
    });
  } catch (err) {
    sendTmuxError(res, err, "search", host.id);
  }
});

app.get("/tmux_monitor/:hostId/metrics", async (req, res) => {
  const host = await requireHost(req, res);
  if (!host) return;

  try {
    const metrics = await withHostConnection(host, async (conn) => {
      const panes = await listPanesRaw(conn);
      if (panes.length === 0) return [];
      return collectPaneMetrics(conn, panes);
    });
    res.json({ panes: metrics });
  } catch (err) {
    sendTmuxError(res, err, "metrics", host.id);
  }
});

app.put("/tmux_monitor/:hostId/tags", async (req, res) => {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const host = await requireHost(req, res);
  if (!host) return;

  const { sessionName, tags } = req.body as {
    sessionName?: string;
    tags?: string[];
  };
  if (!sessionName || typeof sessionName !== "string") {
    return res.status(400).json({ error: "Missing session name" });
  }
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
    return res.status(400).json({ error: "Tags must be an array of strings" });
  }
  const cleanTags = [
    ...new Set(tags.map((t) => t.trim().slice(0, 64)).filter(Boolean)),
  ].slice(0, 20);

  try {
    const db = getDb();
    await db
      .delete(tmuxSessionTags)
      .where(
        and(
          eq(tmuxSessionTags.userId, userId),
          eq(tmuxSessionTags.hostId, host.id),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );
    if (cleanTags.length > 0) {
      await db.insert(tmuxSessionTags).values(
        cleanTags.map((tag) => ({
          userId,
          hostId: host.id,
          sessionName,
          tag,
        })),
      );
    }
    await DatabaseSaveTrigger.triggerSave("tmux_session_tags_updated");
    res.json({ sessionName, tags: cleanTags });
  } catch (err) {
    sshLogger.error(
      `Failed to save tmux session tags for host ${host.id}`,
      err,
    );
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

const PORT = 30010;
app.listen(PORT, () => {});
