import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import { statsLogger } from "../../utils/logger.js";

export interface LoginRecord {
  user: string;
  ip: string;
  time: string;
  status: "success" | "failed";
}

export interface LoginStats {
  recentLogins: LoginRecord[];
  failedLogins: LoginRecord[];
  totalLogins: number;
  uniqueIPs: number;
}

export async function collectLoginStats(client: Client): Promise<LoginStats> {
  const recentLogins: LoginRecord[] = [];
  const failedLogins: LoginRecord[] = [];
  const ipSet = new Set<string>();

  try {
    const lastOut = await execCommand(
      client,
      "last -n 20 -F -w | grep -v 'reboot' | grep -v 'wtmp' | head -20",
    );

    const lastLines = lastOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lastLines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 10) {
        const user = parts[0];
        const tty = parts[1];
        const ip =
          parts[2] === ":" || parts[2].startsWith(":") ? "local" : parts[2];

        const timeStart = parts.indexOf(
          parts.find((p) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(p)) || "",
        );
        if (timeStart > 0 && parts.length > timeStart + 4) {
          const timeStr = parts.slice(timeStart, timeStart + 5).join(" ");

          if (user && user !== "wtmp" && tty !== "system") {
            let parsedTime: string;
            try {
              const date = new Date(timeStr);
              parsedTime = isNaN(date.getTime())
                ? new Date().toISOString()
                : date.toISOString();
            } catch (e) {
              parsedTime = new Date().toISOString();
            }

            recentLogins.push({
              user,
              ip,
              time: parsedTime,
              status: "success",
            });
            if (ip !== "local") {
              ipSet.add(ip);
            }
          }
        }
      }
    }
  } catch (e) {}

  try {
    const failedOut = await execCommand(
      client,
      "grep 'Failed password' /var/log/auth.log 2>/dev/null | tail -10 || grep 'authentication failure' /var/log/secure 2>/dev/null | tail -10 || echo ''",
    );

    const failedLines = failedOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of failedLines) {
      let user = "unknown";
      let ip = "unknown";
      let timeStr = "";

      const userMatch = line.match(/for (?:invalid user )?(\S+)/);
      if (userMatch) {
        user = userMatch[1];
      }

      const ipMatch = line.match(/from (\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) {
        ip = ipMatch[1];
      }

      const dateMatch = line.match(/^(\w+\s+\d+\s+\d+:\d+:\d+)/);
      if (dateMatch) {
        const currentYear = new Date().getFullYear();
        timeStr = `${currentYear} ${dateMatch[1]}`;
      }

      if (user && ip) {
        let parsedTime: string;
        try {
          const date = timeStr ? new Date(timeStr) : new Date();
          parsedTime = isNaN(date.getTime())
            ? new Date().toISOString()
            : date.toISOString();
        } catch (e) {
          parsedTime = new Date().toISOString();
        }

        failedLogins.push({
          user,
          ip,
          time: parsedTime,
          status: "failed",
        });
        if (ip !== "unknown") {
          ipSet.add(ip);
        }
      }
    }
  } catch (e) {}

  return {
    recentLogins: recentLogins.slice(0, 10),
    failedLogins: failedLogins.slice(0, 10),
    totalLogins: recentLogins.length,
    uniqueIPs: ipSet.size,
  };
}
