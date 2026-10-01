import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { createCurrentRepositoryContext } from "../database/repositories/factory.js";

/**
 * On a linked desktop, hosts and credentials someone shared with the account
 * are read-only copies kept in step by sync. Editing or deleting one here
 * would be undone by the next sync, so it is refused with a clear reason.
 */
export function rejectSharedCopyWrites(
  kind: "host" | "credential",
  pattern: RegExp,
) {
  const table = kind === "host" ? hosts : sshCredentials;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.ELECTRON_EMBEDDED !== "true") return next();
    if (req.method !== "PUT" && req.method !== "DELETE") return next();
    const match = req.path.match(pattern);
    if (!match) return next();
    try {
      const [row] = await createCurrentRepositoryContext()
        .drizzle.select({ sharedSource: table.sharedSource })
        .from(table)
        .where(eq(table.id, Number(match[1])))
        .limit(1);
      if (row?.sharedSource) {
        res.status(403).json({
          error: "This was shared with you and is managed on the server",
          code: "SHARED_COPY",
        });
        return;
      }
    } catch {
      // Let the route answer for itself.
    }
    next();
  };
}
