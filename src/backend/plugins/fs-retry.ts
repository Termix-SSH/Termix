import fs from "node:fs";

// Windows refuses a rename while anything holds a file open, and antivirus
// or the search indexer often does for a moment right after files are
// written. These are worth waiting out.
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
const DELAYS_MS = [50, 100, 200, 400, 800, 1600];

function isTransient(error: unknown): boolean {
  return TRANSIENT.has((error as NodeJS.ErrnoException)?.code ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renames, retrying while the error looks like a passing lock. A directory
 * that still cannot be renamed is copied and the source removed instead.
 */
export async function moveWithRetry(
  from: string,
  to: string,
  delays: readonly number[] = DELAYS_MS,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (error) {
      if (!isTransient(error)) throw error;
      lastError = error;
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
  }

  const stat = await fs.promises.stat(from).catch(() => null);
  if (!stat) throw lastError;
  await fs.promises.cp(from, to, { recursive: true, force: true });
  await fs.promises
    .rm(from, { recursive: true, force: true, maxRetries: 5 })
    .catch(() => {});
}
