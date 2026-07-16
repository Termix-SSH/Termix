import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import {
  isValidSystemdUnit,
  isValidServiceAction,
  type ServiceAction,
} from "./validation.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface SystemdService {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

const LIST_SERVICES_CMD =
  "systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null";

/** Parse `systemctl list-units --plain` output into structured rows. */
export function parseServiceList(output: string): SystemdService[] {
  const services: SystemdService[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Columns: UNIT LOAD ACTIVE SUB DESCRIPTION (description may contain spaces)
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [unit, load, active, sub, ...rest] = parts;
    if (!unit.endsWith(".service")) continue;
    services.push({
      unit,
      load,
      active,
      sub,
      description: rest.join(" "),
    });
  }
  return services;
}

export function buildServiceActionCommand(
  unit: string,
  action: ServiceAction,
): string {
  return `systemctl ${action} ${unit}`;
}

export function registerServiceRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  /**
   * @openapi
   * /host-metrics/managers/services/{id}:
   *   get:
   *     summary: List systemd services
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: List of services. }
   */
  app.get(
    "/host-metrics/managers/services/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "services_list", async (client) => {
      const { stdout } = await execCommand(client, LIST_SERVICES_CMD, 20000);
      return { services: parseServiceList(stdout) };
    }),
  );

  /**
   * @openapi
   * /host-metrics/managers/services/{id}/action:
   *   post:
   *     summary: Start/stop/restart/enable/disable a systemd service
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
   *               unit: { type: string }
   *               action: { type: string }
   *     responses:
   *       200: { description: Action result. }
   *       400: { description: Invalid unit or action. }
   *       403: { description: Elevation required or denied. }
   */
  app.post(
    "/host-metrics/managers/services/:id/action",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "services_action",
      async (client, host, req) => {
        const { unit, action } = req.body as {
          unit?: string;
          action?: string;
        };
        if (!isValidSystemdUnit(unit)) {
          throw new ManagerInputError("Invalid unit name");
        }
        if (!isValidServiceAction(action)) {
          throw new ManagerInputError("Invalid action");
        }
        const result = await execElevated(
          client,
          buildServiceActionCommand(unit, action),
          host.sudoPassword,
          { forceSudo: true, timeoutMs: 30000 },
        );
        return {
          success: result.code === 0,
          output: result.stdout || result.stderr,
        };
      },
    ),
  );
}
