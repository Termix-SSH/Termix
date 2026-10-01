import express, { type Router } from "express";
import type { Client } from "ssh2";
import type {
  PluginContext,
  PluginHostSummary,
} from "@termix/plugin-sdk/backend";
import { execCommand, tmuxCommand } from "./tmux-commands.js";
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
} from "./monitor-helpers.js";
import type { SessionTagRepository } from "./repository.js";

const PANE_ID_RE = /^%\d+$/;
// tmux session names cannot contain ":" or "."; keep to a conservative
// printable subset so the name is safe as a tmux target everywhere.
const SESSION_NAME_RE = /^[A-Za-z0-9_@%+=-]{1,64}$/;
const MAX_SEARCH_PANES = 100;
const MAX_MATCHES_PER_PANE = 50;
const SEARCH_HISTORY_LINES = 2000;
const SEARCH_CONCURRENCY = 4;
const POOL = "tmux-monitor";

interface TmuxSessionOverview extends TmuxSessionSummary {
  windows: TmuxWindow[];
  tags: string[];
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type TmuxErrorCode =
  "TMUX_NOT_INSTALLED" | "TMUX_NO_SERVER" | "HOST_UNREACHABLE" | "TMUX_ERROR";

function classifyTmuxError(err: unknown): TmuxErrorCode {
  const msg = toErrorMessage(err);
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
  ctx: PluginContext,
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
  ctx.log.error(`tmux ${context} failed for host ${hostId}`, err as Error);
  res.status(status).json({ error, code });
}

/**
 * Resolves the host for the acting user and checks the monitor is enabled for
 * it. Sends the error response and returns null when access is denied.
 */
async function requireHost(
  ctx: PluginContext,
  req: express.Request,
  res: express.Response,
): Promise<PluginHostSummary | null> {
  const hostId = parseInt(String(req.params.hostId), 10);
  if (isNaN(hostId)) {
    res.status(400).json({ error: "Invalid host ID" });
    return null;
  }

  const host = await ctx.hosts.get(hostId);
  if (!host) {
    res.status(403).json({ error: "Host not found or access denied" });
    return null;
  }

  // The monitor is opt-in per host: hiding the UI is not enough, the API
  // must refuse too.
  const enabled = await ctx.settings.getHost<boolean>(
    hostId,
    "enableTmuxMonitor",
  );
  if (!enabled) {
    res
      .status(403)
      .json({ error: "Tmux Monitor is not enabled for this host" });
    return null;
  }
  return host;
}

async function withHostConnection<T>(
  ctx: PluginContext,
  host: PluginHostSummary,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return ctx.ssh.withConnection<T, Client>(
    host.id,
    { pool: POOL, purpose: "tmux", overrides: { readyTimeout: 60000 } },
    fn,
  );
}

async function tmuxAvailable(conn: Client): Promise<boolean> {
  try {
    await execCommand(conn, tmuxCommand("-V"));
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
  return tmuxCommand(
    `list-sessions -F "#{session_name}${SEP}#{session_created}${SEP}#{session_activity}${SEP}#{session_attached}" 2>/dev/null`,
  );
}

function listWindowsCmd(): string {
  return tmuxCommand(
    `list-windows -a -F "#{session_name}${SEP}#{window_index}${SEP}#{window_active}${SEP}#{window_name}" 2>/dev/null`,
  );
}

function listPanesCmd(): string {
  return tmuxCommand(
    `list-panes -a -F "#{session_name}${SEP}#{window_index}${SEP}#{pane_id}${SEP}#{pane_index}${SEP}#{pane_pid}${SEP}#{pane_active}${SEP}#{pane_width}${SEP}#{pane_height}${SEP}#{pane_current_command}${SEP}#{pane_current_path}${SEP}#{pane_title}" 2>/dev/null`,
  );
}

async function listPanesRaw(conn: Client): Promise<RawPane[]> {
  return parsePanes(await runTmuxList(conn, listPanesCmd()));
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

export function createTmuxMonitorRoutes(
  ctx: PluginContext,
  tags: SessionTagRepository,
): Router {
  const router = express.Router();
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/overview:
   *   get:
   *     summary: Get a host's tmux sessions, windows and panes
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The tmux overview for this host.
   *       403:
   *         description: Host not found, not accessible, or the monitor is disabled for it.
   */
  router.get("/:hostId/overview", async (req, res) => {
    const userId = ctx.currentActor();
    const host = await requireHost(ctx, req, res);
    if (!host || !userId) return;

    try {
      const result = await withHostConnection(ctx, host, async (conn) => {
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

        const sessionTags = await tags.listByUserAndHost(userId, host.id);
        const full: TmuxSessionOverview[] = sessions.map((s) => ({
          ...s,
          windows: windows.get(s.name) || [],
          tags: sessionTags.get(s.name) || [],
        }));
        return { available: true, sessions: full };
      });
      res.json(result);
    } catch (err) {
      sendTmuxError(ctx, res, err, "overview", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/focus:
   *   post:
   *     summary: Focus a pane
   *     description: Selects the pane's window and pane on the server, so every attached client switches to it.
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Focused.
   */
  router.post("/:hostId/focus", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const paneId = String((req.body as { paneId?: string })?.paneId || "");
    if (!PANE_ID_RE.test(paneId)) {
      return res.status(400).json({ error: "Invalid pane ID" });
    }

    try {
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(
            `select-window -t ${shellEscape(paneId)} \\; select-pane -t ${shellEscape(paneId)}`,
          ),
        ),
      );
      res.json({ ok: true });
    } catch (err) {
      sendTmuxError(ctx, res, err, "focus", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/sessions:
   *   post:
   *     summary: Create a detached tmux session
   *     description: Starts the tmux server if none is running.
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Session created.
   *       409:
   *         description: A session with this name already exists.
   */
  router.post("/:hostId/sessions", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const name = String((req.body as { name?: string })?.name || "").trim();
    if (!SESSION_NAME_RE.test(name)) {
      return res.status(400).json({ error: "Invalid session name" });
    }

    try {
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(`new-session -d -s ${shellEscape(name)}`),
        ),
      );
      ctx.log.info(`tmux session created: ${name} on host ${host.id}`);
      res.json({ ok: true, name });
    } catch (err) {
      if (/duplicate session/i.test(toErrorMessage(err))) {
        return res
          .status(409)
          .json({ error: "A session with this name already exists" });
      }
      sendTmuxError(ctx, res, err, "create session", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/windows:
   *   post:
   *     summary: Create a window in an existing session
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Window created.
   *       404:
   *         description: Session not found.
   */
  router.post("/:hostId/windows", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const sessionName = String(
      (req.body as { sessionName?: string })?.sessionName || "",
    ).trim();
    if (!sessionName || /[:.\n]/.test(sessionName)) {
      return res.status(400).json({ error: "Invalid session name" });
    }

    try {
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(`new-window -t ${shellEscape(`=${sessionName}`)}`),
        ),
      );
      ctx.log.info(
        `tmux window created in session ${sessionName} on host ${host.id}`,
      );
      res.json({ ok: true });
    } catch (err) {
      if (/can't find session|no such session/i.test(toErrorMessage(err))) {
        return res.status(404).json({ error: "Session not found" });
      }
      sendTmuxError(ctx, res, err, "create window", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/rename:
   *   post:
   *     summary: Rename a session
   *     description: Saved tags follow the session to its new name, for every user monitoring this host.
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Session renamed.
   *       404:
   *         description: Session not found.
   *       409:
   *         description: A session with this name already exists.
   */
  router.post("/:hostId/rename", async (req, res) => {
    const host = await requireHost(ctx, req, res);
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
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(
            `rename-session -t ${shellEscape(`=${sessionName}`)} ${shellEscape(newName)}`,
          ),
        ),
      );
      await tags.renameSessionForHost(host.id, sessionName, newName);
      ctx.log.info(
        `tmux session renamed on host ${host.id}: ${sessionName} -> ${newName}`,
      );
      await ctx.audit.record({
        action: "tmux_session_rename",
        resourceType: "host",
        resourceId: String(host.id),
        resourceName: sessionName,
        details: JSON.stringify({ newName }),
        success: true,
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
      sendTmuxError(ctx, res, err, "rename session", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/kill:
   *   post:
   *     summary: Kill a session and drop its saved tags
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Session killed.
   *       404:
   *         description: Session not found.
   */
  router.post("/:hostId/kill", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const sessionName = String(
      (req.body as { sessionName?: string })?.sessionName || "",
    ).trim();
    if (!sessionName || /[:.\n]/.test(sessionName)) {
      return res.status(400).json({ error: "Invalid session name" });
    }

    try {
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(`kill-session -t ${shellEscape(`=${sessionName}`)}`),
        ),
      );
      await tags.deleteSessionForHost(host.id, sessionName);
      ctx.log.info(`tmux session killed on host ${host.id}: ${sessionName}`);
      await ctx.audit.record({
        action: "tmux_session_kill",
        resourceType: "host",
        resourceId: String(host.id),
        resourceName: sessionName,
        success: true,
      });
      res.json({ ok: true });
    } catch (err) {
      if (/can't find session|no such session/i.test(toErrorMessage(err))) {
        return res.status(404).json({ error: "Session not found" });
      }
      sendTmuxError(ctx, res, err, "kill session", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/kill-window:
   *   post:
   *     summary: Kill a window and every pane in it
   *     description: Killing the last window of a session ends the session (tmux semantics).
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Window killed.
   *       404:
   *         description: Window not found.
   */
  router.post("/:hostId/kill-window", async (req, res) => {
    const host = await requireHost(ctx, req, res);
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
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(
            `kill-window -t ${shellEscape(`=${sessionName}:${windowIndex}`)}`,
          ),
        ),
      );
      ctx.log.info(
        `tmux window killed on host ${host.id}: ${sessionName}:${windowIndex}`,
      );
      await ctx.audit.record({
        action: "tmux_window_kill",
        resourceType: "host",
        resourceId: String(host.id),
        resourceName: sessionName,
        details: JSON.stringify({ windowIndex }),
        success: true,
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
      sendTmuxError(ctx, res, err, "kill window", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/kill-pane:
   *   post:
   *     summary: Kill a single pane
   *     description: Killing the last pane of a window closes the window, and the last window of a session ends the session (tmux semantics).
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Pane killed.
   *       404:
   *         description: Pane not found.
   */
  router.post("/:hostId/kill-pane", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const paneId = String((req.body as { paneId?: string })?.paneId || "");
    if (!PANE_ID_RE.test(paneId)) {
      return res.status(400).json({ error: "Invalid pane ID" });
    }

    try {
      await withHostConnection(ctx, host, (conn) =>
        execCommand(conn, tmuxCommand(`kill-pane -t ${shellEscape(paneId)}`)),
      );
      ctx.log.info(`tmux pane killed on host ${host.id}: ${paneId}`);
      await ctx.audit.record({
        action: "tmux_pane_kill",
        resourceType: "host",
        resourceId: String(host.id),
        resourceName: paneId,
        success: true,
      });
      res.json({ ok: true });
    } catch (err) {
      if (/can't find pane|no such pane/i.test(toErrorMessage(err))) {
        return res.status(404).json({ error: "Pane not found" });
      }
      sendTmuxError(ctx, res, err, "kill pane", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/split:
   *   post:
   *     summary: Split the window containing a pane
   *     description: "\"h\" places the new pane to the right, \"v\" below, matching tmux's own -h/-v semantics. The new pane starts in the source pane's working directory."
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Pane split.
   */
  router.post("/:hostId/split", async (req, res) => {
    const host = await requireHost(ctx, req, res);
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
      await withHostConnection(ctx, host, (conn) =>
        execCommand(
          conn,
          tmuxCommand(
            `split-window ${direction} -t ${shellEscape(paneId)} -c ${shellEscape("#{pane_current_path}")}`,
          ),
        ),
      );
      ctx.log.info(
        `tmux pane split on host ${host.id}: ${paneId} (${body.direction})`,
      );
      res.json({ ok: true });
    } catch (err) {
      sendTmuxError(ctx, res, err, "split", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/search:
   *   get:
   *     summary: Search pane output across a host's tmux sessions
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: q
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Matching lines, capped per pane and across panes.
   */
  router.get("/:hostId/search", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "Missing search query" });
    }

    try {
      const results = await withHostConnection(ctx, host, async (conn) => {
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
                  tmuxCommand(
                    `capture-pane -p -J -t ${shellEscape(pane.id)} -S -${SEARCH_HISTORY_LINES} 2>/dev/null | grep -n -i -F -- ${shellEscape(query)} | head -${MAX_MATCHES_PER_PANE}`,
                  ),
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
      sendTmuxError(ctx, res, err, "search", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/metrics:
   *   get:
   *     summary: Per-pane CPU, memory and GPU usage
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Metrics for every pane tmux reports.
   */
  router.get("/:hostId/metrics", async (req, res) => {
    const host = await requireHost(ctx, req, res);
    if (!host) return;

    try {
      const metrics = await withHostConnection(ctx, host, async (conn) => {
        const panes = await listPanesRaw(conn);
        if (panes.length === 0) return [];
        return collectPaneMetrics(conn, panes);
      });
      res.json({ panes: metrics });
    } catch (err) {
      sendTmuxError(ctx, res, err, "metrics", host.id);
    }
  });

  /**
   * @openapi
   * /plugin-api/tmux-monitor/{hostId}/tags:
   *   put:
   *     summary: Replace the acting user's tags on a session
   *     tags:
   *       - Tmux Monitor
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Tags saved.
   */
  router.put("/:hostId/tags", async (req, res) => {
    const userId = ctx.currentActor();
    const host = await requireHost(ctx, req, res);
    if (!host || !userId) return;

    const { sessionName, tags: rawTags } = req.body as {
      sessionName?: string;
      tags?: string[];
    };
    if (!sessionName || typeof sessionName !== "string") {
      return res.status(400).json({ error: "Missing session name" });
    }
    if (!Array.isArray(rawTags) || rawTags.some((t) => typeof t !== "string")) {
      return res
        .status(400)
        .json({ error: "Tags must be an array of strings" });
    }
    const cleanTags = [
      ...new Set(rawTags.map((t) => t.trim().slice(0, 64)).filter(Boolean)),
    ].slice(0, 20);

    try {
      await tags.replaceForUserHostSession(
        userId,
        host.id,
        sessionName,
        cleanTags,
      );
      res.json({ sessionName, tags: cleanTags });
    } catch (err) {
      ctx.log.error(
        `Failed to save tmux session tags for host ${host.id}`,
        err as Error,
      );
      res.status(500).json({ error: toErrorMessage(err) });
    }
  });

  return router;
}
