import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { shellSingleQuote } from "./exec-elevated.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface CronEntry {
  raw: string;
  enabled: boolean;
  schedule: string;
  command: string;
}

const READ_CRONTAB_CMD = "crontab -l 2>/dev/null";

/** Parse a crontab into entries (comments/blank lines are dropped except as toggles). */
export function parseCrontab(output: string): CronEntry[] {
  const entries: CronEntry[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    // A commented-out job: "# <schedule> <command>" (our toggle convention).
    const disabled = line.match(
      /^#\s*((?:@\w+|\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+.+)$/,
    );
    if (disabled) {
      const { schedule, command } = splitScheduleCommand(disabled[1]);
      if (command) {
        entries.push({ raw: line, enabled: false, schedule, command });
        continue;
      }
    }
    // Skip pure comments / env assignments.
    if (line.trimStart().startsWith("#")) continue;
    if (/^\s*[A-Z_]+=/.test(line)) continue;
    const { schedule, command } = splitScheduleCommand(line.trim());
    if (!command) continue;
    entries.push({ raw: line, enabled: true, schedule, command });
  }
  return entries;
}

function splitScheduleCommand(line: string): {
  schedule: string;
  command: string;
} {
  if (line.startsWith("@")) {
    const [sched, ...rest] = line.split(/\s+/);
    return { schedule: sched, command: rest.join(" ") };
  }
  const parts = line.split(/\s+/);
  if (parts.length < 6) return { schedule: "", command: "" };
  return {
    schedule: parts.slice(0, 5).join(" "),
    command: parts.slice(5).join(" "),
  };
}

const CRON_SCHEDULE_RE =
  /^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,A-Za-z-]+\s+[\d*/,A-Za-z-]+)$/;

export function isValidCronSchedule(schedule: string): boolean {
  return CRON_SCHEDULE_RE.test(schedule.trim());
}

/** Serialize entries into a full crontab body (toggled entries are commented). */
export function serializeCrontab(entries: CronEntry[]): string {
  const lines = entries.map((e) => {
    const body = `${e.schedule} ${e.command}`.trim();
    return e.enabled ? body : `# ${body}`;
  });
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/** Build a command that atomically replaces the user crontab from the given body. */
export function buildApplyCrontabCommand(body: string): string {
  // printf the exact bytes into `crontab -` (reads new crontab from stdin).
  return `printf '%s' ${shellSingleQuote(body)} | crontab -`;
}

export function registerCronRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/cron/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "cron_list", async (client) => {
      const { stdout } = await execCommand(client, READ_CRONTAB_CMD, 15000);
      return { entries: parseCrontab(stdout) };
    }),
  );

  app.post(
    "/host-metrics/managers/cron/:id",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "cron_replace",
      async (client, _host, req) => {
        const { entries } = req.body as { entries?: CronEntry[] };
        if (!Array.isArray(entries)) {
          throw new ManagerInputError("entries must be an array");
        }
        for (const e of entries) {
          if (typeof e?.command !== "string" || !e.command.trim()) {
            throw new ManagerInputError("Each entry needs a command");
          }
          if (e.command.includes("\n")) {
            throw new ManagerInputError("Commands cannot contain newlines");
          }
          if (!isValidCronSchedule(String(e.schedule))) {
            throw new ManagerInputError(`Invalid schedule: ${e.schedule}`);
          }
        }
        const body = serializeCrontab(entries);
        const { stdout, stderr, code } = await execCommand(
          client,
          buildApplyCrontabCommand(body),
          15000,
        );
        return { success: code === 0, output: stdout || stderr };
      },
    ),
  );
}
