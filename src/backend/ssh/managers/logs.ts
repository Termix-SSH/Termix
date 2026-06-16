import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { shellSingleQuote } from "./exec-elevated.js";
import { isAllowedPath, isValidSystemdUnit } from "./validation.js";
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

export function registerLogRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/logs/:id/files",
    validateHostId,
    managerHandler(runOnHost, "read", "logs_list", async (client) => {
      const { stdout } = await execCommand(client, LIST_LOGS_CMD, 10000);
      const found = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((name) => `/var/log/${name}`);
      return { common: COMMON_LOGS, files: found };
    }),
  );

  app.get(
    "/host-metrics/managers/logs/:id",
    validateHostId,
    managerHandler(
      runOnHost,
      "read",
      "logs_tail",
      async (client, host, req) => {
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
      },
    ),
  );
}
