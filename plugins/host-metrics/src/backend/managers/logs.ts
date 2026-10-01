import {
  execCommand,
  execElevated,
  shellSingleQuote,
} from "@termix/plugin-sdk/host-commands";
import { isAllowedPath, isValidSystemdUnit } from "./validation.js";
import type { Router } from "express";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";

/** Directories from which arbitrary log files may be tailed. */
export const LOG_PATH_ALLOWLIST = ["/var/log"];

const COMMON_LOGS = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/auth.log",
  "/var/log/secure",
  "/var/log/kern.log",
  "/var/log/dpkg.log",
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
];

const LIST_LOGS_CMD = `ls -1 ${LOG_PATH_ALLOWLIST.map(shellSingleQuote).join(" ")} 2>/dev/null`;

export function clampLines(n: unknown): number {
  const v = typeof n === "string" ? Number(n) : n;
  if (typeof v !== "number" || !Number.isFinite(v)) return 200;
  return Math.min(2000, Math.max(1, Math.round(v)));
}

export function buildTailCommand(path: string, lines: number): string {
  // Keep stderr intact so execElevated can detect a permission error and
  // escalate; suppressing it (2>/dev/null) would hide the denial and return an
  // empty log with no chance to retry under sudo.
  return `tail -n ${lines} ${shellSingleQuote(path)}`;
}

export function buildJournalCommand(unit: string, lines: number): string {
  return `journalctl -u ${shellSingleQuote(unit)} -n ${lines} --no-pager`;
}

export function registerLogRoutes(app: Router, deps: ManagerRoutesDeps): void {
  const { validateHostId } = deps;
  /**
   * @openapi
   * /plugin-api/host-metrics/managers/logs/{id}/files:
   *   get:
   *     summary: List readable log files under /var/log
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Common logs and the files found. }
   *       400: { description: Invalid input. }
   *       403: { description: No access to the host, or elevation denied. }
   *       500: { description: The command failed on the host. }
   */
  app.get(
    "/host-metrics/managers/logs/:id/files",
    validateHostId,
    managerHandler(deps, "connect", "logs_list", async (client) => {
      const { stdout } = await execCommand(client, LIST_LOGS_CMD, 10000);
      const found = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((name) => `/var/log/${name}`);
      return { common: COMMON_LOGS, files: found };
    }),
  );

  /**
   * @openapi
   * /plugin-api/host-metrics/managers/logs/{id}:
   *   get:
   *     summary: Tail a log file or a systemd unit's journal
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: path
   *         schema: { type: string }
   *         description: A log file under an allowed directory.
   *       - in: query
   *         name: unit
   *         schema: { type: string }
   *         description: A systemd unit. Used instead of path when given.
   *       - in: query
   *         name: lines
   *         schema: { type: integer }
   *     responses:
   *       200: { description: The last lines of the log. }
   *       400: { description: Invalid input. }
   *       403: { description: No access to the host, or elevation denied. }
   *       500: { description: The command failed on the host. }
   */
  app.get(
    "/host-metrics/managers/logs/:id",
    validateHostId,
    managerHandler(deps, "connect", "logs_tail", async (client, host, req) => {
      const path = req.query.path as string | undefined;
      const unit = req.query.unit as string | undefined;
      const lines = clampLines(req.query.lines);

      let cmd: string;
      if (unit) {
        if (!isValidSystemdUnit(unit))
          throw new ManagerInputError("Invalid unit");
        cmd = buildJournalCommand(unit, lines);
      } else if (path) {
        if (!isAllowedPath(path, LOG_PATH_ALLOWLIST)) {
          throw new ManagerInputError("Path not allowed");
        }
        cmd = buildTailCommand(path, lines);
      } else {
        throw new ManagerInputError("Provide a path or unit");
      }

      // Try unprivileged; many logs need root (auth.log, etc.).
      const result = await execElevated(client, cmd, host.sudoPassword);
      return { content: result.stdout, lines };
    }),
  );
}
