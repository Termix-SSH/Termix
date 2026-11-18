/**
 * Break glass: the termix-recover tool, run by someone with a shell on the
 * server, drops a request file in DATA_DIR/.recovery and the running server
 * carries it out. Only the server's own user can write there, so a web
 * session, an API key or a plugin can never reach this.
 */

import fs from "node:fs";
import path from "node:path";
import { authLogger } from "../utils/logger.js";

export const RECOVERY_ACTOR = "server console";
const POLL_MS = 5000;
const MAX_REQUEST_BYTES = 4096;
const MAX_AGE_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{32}$/;

export type RecoveryCommand =
  "list-admins" | "reset-second-factor" | "revoke-sessions";

export interface RecoveryRequest {
  id: string;
  command: RecoveryCommand;
  username?: string;
  all?: boolean;
  createdAt: string;
}

export interface RecoveryResult {
  ok: boolean;
  message: string;
  admins?: string[];
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function recoveryDir(): string {
  return path.join(process.env.DATA_DIR || "./db/data", ".recovery");
}

function ensureDir(): string {
  const dir = recoveryDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // not supported on every filesystem
  }
  return dir;
}

/** A request file the server will act on: a plain file it owns, small. */
function readRequest(file: string): RecoveryRequest | string {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) return "not a plain file";
  if (stat.size > MAX_REQUEST_BYTES) return "too large";
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && stat.uid !== uid) return "not owned by the server user";
  if (uid !== null && (stat.mode & 0o022) !== 0) return "writable by others";
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RecoveryRequest;
  if (!ID_PATTERN.test(String(parsed.id))) return "bad id";
  if (
    !["list-admins", "reset-second-factor", "revoke-sessions"].includes(
      parsed.command,
    )
  ) {
    return "unknown command";
  }
  const age = Date.now() - Date.parse(parsed.createdAt);
  if (!Number.isFinite(age) || age > MAX_AGE_MS) return "too old";
  return parsed;
}

async function findUser(username: string | undefined) {
  if (!username) throw new Error("Give a username");
  const { createCurrentUserRepository } =
    await import("../database/repositories/factory.js");
  const user = await createCurrentUserRepository().findByUsername(username);
  if (!user) throw new Error(`No user named ${username}`);
  return user;
}

async function audit(
  action: string,
  target: { id?: string; name?: string },
  details: Record<string, unknown>,
): Promise<void> {
  const { logAudit } = await import("../utils/audit-logger.js");
  await logAudit({
    userId: null,
    username: RECOVERY_ACTOR,
    action,
    resourceType: "user",
    resourceId: target.id,
    resourceName: target.name,
    details: JSON.stringify(details),
    success: true,
  });
}

export async function runRecoveryRequest(
  request: RecoveryRequest,
): Promise<RecoveryResult> {
  const { createCurrentUserRepository } =
    await import("../database/repositories/factory.js");

  if (request.command === "list-admins") {
    const admins = (await createCurrentUserRepository().listAll())
      .filter((user) => user.isAdmin)
      .map((user) => user.username);
    return { ok: true, message: `${admins.length} admin(s)`, admins };
  }

  const { AuthManager } = await import("../utils/auth-manager.js");

  if (request.command === "reset-second-factor") {
    const user = await findUser(request.username);
    const { resetUserSecondFactors } =
      await import("../auth/second-factor-admin.js");
    const removed = await resetUserSecondFactors(user.id);
    const sessions = await AuthManager.getInstance().revokeAllUserSessions(
      user.id,
    );
    await audit(
      "recovery_reset_second_factor",
      { id: user.id, name: user.username },
      { removed: removed.length, sessions },
    );
    return {
      ok: true,
      message: `Removed ${removed.length} second factor(s) from ${user.username} and signed them out. They can sign in with their password now and set a new one up.`,
    };
  }

  if (request.all) {
    const { createCurrentSessionRepository } =
      await import("../database/repositories/factory.js");
    const count = await createCurrentSessionRepository().revokeAll();
    await audit("recovery_revoke_sessions", { name: "everyone" }, { count });
    return { ok: true, message: `Signed out ${count} session(s)` };
  }
  const user = await findUser(request.username);
  const count = await AuthManager.getInstance().revokeAllUserSessions(user.id);
  await audit(
    "recovery_revoke_sessions",
    { id: user.id, name: user.username },
    { count },
  );
  return {
    ok: true,
    message: `Signed out ${count} session(s) of ${user.username}`,
  };
}

/** Handles every waiting request once. Exposed for tests and boot. */
export async function processRecoveryRequests(): Promise<number> {
  if (running) return 0;
  running = true;
  let handled = 0;
  try {
    const dir = ensureDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".request.json")) continue;
      const file = path.join(dir, name);
      const id = name.slice(0, -".request.json".length);
      let result: RecoveryResult;
      try {
        const request = readRequest(file);
        if (typeof request === "string") {
          result = { ok: false, message: `Request refused: ${request}` };
          authLogger.warn(`Recovery request refused: ${request}`, {
            operation: "recovery_request",
          });
        } else {
          result = await runRecoveryRequest(request);
        }
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      fs.rmSync(file, { force: true });
      if (ID_PATTERN.test(id)) {
        fs.writeFileSync(
          path.join(dir, `${id}.result.json`),
          JSON.stringify(result),
          { mode: 0o600 },
        );
      }
      handled += 1;
    }
  } catch (error) {
    authLogger.warn("Recovery requests could not be read", {
      operation: "recovery_request",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
  return handled;
}

export function startRecoveryWatch(): void {
  if (timer) return;
  void processRecoveryRequests();
  timer = setInterval(() => void processRecoveryRequests(), POLL_MS);
  timer.unref?.();
}

/** Test seam. */
export function stopRecoveryWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
