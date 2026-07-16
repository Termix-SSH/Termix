import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { isValidUsername, isValidGroupName } from "./validation.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface SystemUser {
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

export interface SystemGroup {
  name: string;
  gid: number;
  members: string[];
}

// Human users only (uid >= 1000, excluding nobody at 65534).
const READ_USERS_CMD = "getent passwd 2>/dev/null";
const READ_GROUPS_CMD = "getent group 2>/dev/null";
const READ_SUDOERS_CMD = "getent group sudo wheel 2>/dev/null";

export function parsePasswd(output: string): SystemUser[] {
  const users: SystemUser[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 7) continue;
    const uid = Number(parts[2]);
    if (!Number.isFinite(uid)) continue;
    if (uid < 1000 || uid === 65534) continue;
    users.push({
      name: parts[0],
      uid,
      gid: Number(parts[3]),
      home: parts[5],
      shell: parts[6],
    });
  }
  return users;
}

export function parseGroups(output: string): SystemGroup[] {
  const groups: SystemGroup[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 4) continue;
    groups.push({
      name: parts[0],
      gid: Number(parts[2]),
      members: parts[3].split(",").filter(Boolean),
    });
  }
  return groups;
}

export function parseSudoers(output: string): string[] {
  const members = new Set<string>();
  for (const line of output.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 4) continue;
    parts[3]
      .split(",")
      .filter(Boolean)
      .forEach((m) => members.add(m));
  }
  return [...members];
}

export type UserAction = "create" | "delete" | "addToGroup" | "removeFromGroup";

export function registerUserRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/users/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "users_list", async (client) => {
      const [passwd, groups, sudoers] = await Promise.all([
        execCommand(client, READ_USERS_CMD, 15000),
        execCommand(client, READ_GROUPS_CMD, 15000),
        execCommand(client, READ_SUDOERS_CMD, 15000),
      ]);
      return {
        users: parsePasswd(passwd.stdout),
        groups: parseGroups(groups.stdout),
        sudoers: parseSudoers(sudoers.stdout),
      };
    }),
  );

  app.post(
    "/host-metrics/managers/users/:id/action",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "users_action",
      async (client, host, req) => {
        const { action, username, group } = req.body as {
          action?: UserAction;
          username?: string;
          group?: string;
        };
        if (!isValidUsername(username))
          throw new ManagerInputError("Invalid username");

        // Never modify/delete the user we're connected as, or root.
        const who = (await execCommand(client, "id -un", 8000)).stdout.trim();
        if (username === who || username === "root") {
          throw new ManagerInputError(
            "Refusing to modify the connected user or root",
          );
        }

        let cmd: string;
        switch (action) {
          case "create":
            cmd = `useradd -m ${username}`;
            break;
          case "delete":
            cmd = `userdel -r ${username}`;
            break;
          case "addToGroup":
          case "removeFromGroup":
            if (!isValidGroupName(group))
              throw new ManagerInputError("Invalid group");
            cmd =
              action === "addToGroup"
                ? `usermod -aG ${group} ${username}`
                : `gpasswd -d ${username} ${group}`;
            break;
          default:
            throw new ManagerInputError("Invalid action");
        }

        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
        });
        return {
          success: result.code === 0,
          output: result.stdout || result.stderr,
        };
      },
    ),
  );
}
