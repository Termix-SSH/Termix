/**
 * termix-recover: break glass from a shell on the server. It hands a request
 * to the running server through DATA_DIR/.recovery and prints the answer.
 *
 *   termix-recover list-admins
 *   termix-recover reset-second-factor <username>
 *   termix-recover revoke-sessions <username>
 *   termix-recover revoke-sessions --all
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WAIT_MS = 30_000;

const USAGE = `Usage:
  termix-recover list-admins
  termix-recover reset-second-factor <username>
  termix-recover revoke-sessions <username>
  termix-recover revoke-sessions --all`;

export interface ParsedArgs {
  command: "list-admins" | "reset-second-factor" | "revoke-sessions";
  username?: string;
  all?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs | null {
  const [command, target] = argv;
  if (command === "list-admins" && argv.length === 1) return { command };
  if (command === "reset-second-factor" && target && argv.length === 2) {
    return { command, username: target };
  }
  if (command === "revoke-sessions" && target && argv.length === 2) {
    return target === "--all"
      ? { command, all: true }
      : { command, username: target };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(
  argv: string[],
  options: { dataDir?: string; waitMs?: number } = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed) {
    console.error(USAGE);
    return 2;
  }
  const dataDir = options.dataDir ?? (process.env.DATA_DIR || "./db/data");
  const dir = path.join(dataDir, ".recovery");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const id = crypto.randomBytes(16).toString("hex");
  const requestFile = path.join(dir, `${id}.request.json`);
  const resultFile = path.join(dir, `${id}.result.json`);
  const temp = `${requestFile}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ id, ...parsed, createdAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  // Written whole first, so the server never reads half a request.
  fs.renameSync(temp, requestFile);

  const deadline = Date.now() + (options.waitMs ?? WAIT_MS);
  while (Date.now() < deadline) {
    if (fs.existsSync(resultFile)) {
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
        ok: boolean;
        message: string;
        admins?: string[];
      };
      fs.rmSync(resultFile, { force: true });
      (result.ok ? console.log : console.error)(result.message);
      for (const admin of result.admins ?? []) console.log(`  ${admin}`);
      return result.ok ? 0 : 1;
    }
    await sleep(250);
  }
  fs.rmSync(requestFile, { force: true });
  console.error(
    "Termix did not answer. Make sure it is running, then try again. Run this as the user Termix runs as (in Docker: docker exec termix termix-recover ...).",
  );
  return 1;
}

const invoked = process.argv[1] ?? "";
if (/recovery[\\/]cli\.(js|ts)$/.test(invoked)) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
