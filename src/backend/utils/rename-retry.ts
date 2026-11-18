import fs from "fs";

const LOCK_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Renames a file, trying again for a moment when Windows still has the
 * target open (a process that just exited, an antivirus scan).
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: { attempts?: number; delayMs?: number } = {},
  rename: (a: string, b: string) => Promise<void> = fs.promises.rename,
): Promise<void> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 100;
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (attempt >= attempts || !code || !LOCK_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
