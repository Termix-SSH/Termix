import type { Express } from "express";
import type { Client } from "ssh2";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { execCommand } from "../widgets/common-utils.js";
import { getDb, DatabaseSaveTrigger } from "../../database/db/index.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { shellSingleQuote } from "./exec-elevated.js";
import { isValidPort } from "./validation.js";
import type { ManagerRoutesDeps } from "./types.js";
import { AlertEngine } from "../alert-engine.js";

export interface HealthCheck {
  id: string;
  name: string;
  type: "tcp" | "http";
  target: string;
  port?: number;
  path?: string;
}

export interface HealthResult {
  checkId: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}

const TARGET_RE = /^[A-Za-z0-9.\-_:]+$/;
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/;

export function isValidHealthCheck(c: unknown): c is HealthCheck {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.name !== "string") return false;
  if (o.type !== "tcp" && o.type !== "http") return false;
  if (typeof o.target !== "string" || !TARGET_RE.test(o.target)) return false;
  if (o.type === "tcp" && !isValidPort(o.port)) return false;
  if (
    o.path !== undefined &&
    (typeof o.path !== "string" || !PATH_RE.test(o.path))
  )
    return false;
  return true;
}

/** Build a command that runs the check from the host and prints "ok latency". */
export function buildHealthCheckCommand(check: HealthCheck): string {
  if (check.type === "tcp") {
    const host = shellSingleQuote(check.target);
    const port = check.port;
    // Prefer bash /dev/tcp; time it with date in ms.
    return `start=$(date +%s%3N); if timeout 3 bash -c '</dev/tcp/'${host}'/'${port} 2>/dev/null; then echo "ok $(( $(date +%s%3N) - start ))"; else echo "fail $(( $(date +%s%3N) - start ))"; fi`;
  }
  // http
  const scheme = check.target.includes("://") ? "" : "http://";
  const url = shellSingleQuote(`${scheme}${check.target}${check.path ?? ""}`);
  return `curl -s -o /dev/null -m 5 -w '%{http_code} %{time_total}' ${url} || echo '000 0'`;
}

export function parseHealthResult(
  check: HealthCheck,
  output: string,
): HealthResult {
  const line = output.trim().split("\n").pop() ?? "";
  if (check.type === "tcp") {
    const [status, ms] = line.split(/\s+/);
    return {
      checkId: check.id,
      ok: status === "ok",
      latencyMs: Number(ms) || null,
      detail: status === "ok" ? "open" : "closed/timeout",
    };
  }
  const m = line.match(/^(\d{3})\s+([\d.]+)/);
  if (!m)
    return { checkId: check.id, ok: false, latencyMs: null, detail: line };
  const code = Number(m[1]);
  return {
    checkId: check.id,
    ok: code >= 200 && code < 400,
    latencyMs: Math.round(Number(m[2]) * 1000),
    detail: `HTTP ${code}`,
  };
}

async function runChecks(
  client: Client,
  checks: HealthCheck[],
): Promise<HealthResult[]> {
  return Promise.all(
    checks.map(async (check) => {
      try {
        const { stdout } = await execCommand(
          client,
          buildHealthCheckCommand(check),
          8000,
        );
        return parseHealthResult(check, stdout);
      } catch {
        return {
          checkId: check.id,
          ok: false,
          latencyMs: null,
          detail: "error",
        };
      }
    }),
  );
}

const HISTORY_KEEP = 500;

function recordHistory(
  userId: string,
  hostId: number,
  results: HealthResult[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.$client.prepare(
    "INSERT INTO host_health_history (user_id, host_id, check_id, ts, ok, latency_ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const r of results) {
    insert.run(
      userId,
      hostId,
      r.checkId,
      now,
      r.ok ? 1 : 0,
      r.latencyMs,
      r.detail,
    );
  }
  // Prune to the most recent HISTORY_KEEP rows per (host, check).
  db.$client
    .prepare(
      `DELETE FROM host_health_history
       WHERE id IN (
         SELECT id FROM host_health_history
         WHERE user_id = ? AND host_id = ?
         AND id NOT IN (
           SELECT id FROM host_health_history
           WHERE user_id = ? AND host_id = ?
           ORDER BY ts DESC LIMIT ?
         )
       )`,
    )
    .run(userId, hostId, userId, hostId, HISTORY_KEEP);
}

function loadChecks(userId: string, hostId: number): HealthCheck[] {
  const row = getDb()
    .$client.prepare(
      "SELECT checks FROM host_health_checks WHERE user_id = ? AND host_id = ?",
    )
    .get(userId, hostId) as { checks: string } | undefined;
  if (!row?.checks) return [];
  try {
    const parsed = JSON.parse(row.checks);
    return Array.isArray(parsed) ? parsed.filter(isValidHealthCheck) : [];
  } catch {
    return [];
  }
}

export function registerHealthRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/health/:id",
    validateHostId,
    managerHandler(
      runOnHost,
      "read",
      "health_get",
      async (client, host, req) => {
        const userId = (req as AuthenticatedRequest).userId;
        const checks = loadChecks(userId, host.id);
        const results = checks.length ? await runChecks(client, checks) : [];
        if (results.length) {
          recordHistory(userId, host.id, results);
          for (const r of results) {
            AlertEngine.getInstance()
              .evaluateHealthCheck(
                host.id,
                userId,
                r.checkId,
                r.ok,
                r.detail ?? undefined,
              )
              .catch(() => {});
          }
        }

        const history = getDb()
          .$client.prepare(
            "SELECT check_id as checkId, ts, ok, latency_ms as latencyMs, detail FROM host_health_history WHERE user_id = ? AND host_id = ? ORDER BY ts DESC LIMIT 200",
          )
          .all(userId, host.id);
        return { checks, results, history };
      },
    ),
  );

  app.post(
    "/host-metrics/managers/health/:id/config",
    validateHostId,
    managerHandler(
      runOnHost,
      "read",
      "health_config",
      async (_client, host, req) => {
        const userId = (req as AuthenticatedRequest).userId;
        const { checks, intervalSeconds } = req.body as {
          checks?: unknown;
          intervalSeconds?: number;
        };
        if (!Array.isArray(checks) || !checks.every(isValidHealthCheck)) {
          throw new ManagerInputError("Invalid checks");
        }
        const interval =
          typeof intervalSeconds === "number" &&
          intervalSeconds >= 30 &&
          intervalSeconds <= 86400
            ? Math.round(intervalSeconds)
            : 300;
        const db = getDb();
        const now = new Date().toISOString();
        const existing = db.$client
          .prepare(
            "SELECT id FROM host_health_checks WHERE user_id = ? AND host_id = ?",
          )
          .get(userId, host.id) as { id: number } | undefined;
        if (existing) {
          db.$client
            .prepare(
              "UPDATE host_health_checks SET checks = ?, interval_seconds = ?, updated_at = ? WHERE id = ?",
            )
            .run(JSON.stringify(checks), interval, now, existing.id);
        } else {
          db.$client
            .prepare(
              "INSERT INTO host_health_checks (user_id, host_id, checks, interval_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(userId, host.id, JSON.stringify(checks), interval, now, now);
        }
        DatabaseSaveTrigger.triggerSave("host_health_checks_updated");
        return { success: true };
      },
    ),
  );

  app.post(
    "/host-metrics/managers/health/:id/run",
    validateHostId,
    managerHandler(
      runOnHost,
      "read",
      "health_run",
      async (client, host, req) => {
        const userId = (req as AuthenticatedRequest).userId;
        const checks = loadChecks(userId, host.id);
        const results = await runChecks(client, checks);
        if (results.length) {
          recordHistory(userId, host.id, results);
          for (const r of results) {
            AlertEngine.getInstance()
              .evaluateHealthCheck(
                host.id,
                userId,
                r.checkId,
                r.ok,
                r.detail ?? undefined,
              )
              .catch(() => {});
          }
        }
        return { results };
      },
    ),
  );
}
