import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { isValidPid, isValidSignal, type Signal } from "./validation.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface ProcessRow {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  stat: string;
  command: string;
  args: string;
}

const LIST_PROCESSES_CMD =
  "ps -eo pid,ppid,user:20,pcpu,pmem,rss,stat,comm,args --sort=-pcpu --no-headers 2>/dev/null | head -n 300";

/** Parse `ps -eo pid,ppid,user,pcpu,pmem,rss,stat,comm,args` output. */
export function parseProcessList(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/,
    );
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      user: m[3],
      cpu: Number(m[4]),
      mem: Number(m[5]),
      rss: Number(m[6]),
      stat: m[7],
      command: m[8],
      args: m[9],
    });
  }
  return rows;
}

export function buildKillCommand(pid: number, signal: Signal): string {
  return `kill -${signal} ${pid}`;
}

export function registerProcessRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  /**
   * @openapi
   * /host-metrics/managers/processes/{id}:
   *   get:
   *     summary: List processes (rich, sortable, filterable client-side)
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Process list. }
   */
  app.get(
    "/host-metrics/managers/processes/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "processes_list", async (client) => {
      const { stdout } = await execCommand(client, LIST_PROCESSES_CMD, 20000);
      return { processes: parseProcessList(stdout) };
    }),
  );

  /**
   * @openapi
   * /host-metrics/managers/processes/{id}/signal:
   *   post:
   *     summary: Send a signal to a process (TERM/KILL/HUP/INT)
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               pid: { type: integer }
   *               signal: { type: string }
   *     responses:
   *       200: { description: Signal result. }
   *       400: { description: Invalid pid or signal. }
   *       403: { description: Elevation required or denied. }
   */
  app.post(
    "/host-metrics/managers/processes/:id/signal",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "processes_signal",
      async (client, host, req) => {
        const { pid, signal } = req.body as {
          pid?: number;
          signal?: string;
        };
        if (!isValidPid(pid)) throw new ManagerInputError("Invalid pid");
        if (!isValidSignal(signal))
          throw new ManagerInputError("Invalid signal");
        const cmd = buildKillCommand(Number(pid), signal);
        // Try unprivileged first; elevate only if the process isn't owned.
        const result = await execElevated(client, cmd, host.sudoPassword);
        return {
          success: result.code === 0,
          output: result.stdout || result.stderr,
          usedSudo: result.usedSudo,
        };
      },
    ),
  );
}
