import { and, eq, inArray } from "drizzle-orm";
import type { AuthOverrideProtocol } from "../../../types/auth-protocols.js";
import { sharedFolderAuthOverrides } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { deleteReturning, upsert } from "./returning.js";

/** "A / B / C" and the folders above it, closest first. */
export function folderAndParents(folder: string | null | undefined): string[] {
  const parts = (folder ?? "")
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    out.push(parts.slice(0, i).join(" / "));
  }
  return out;
}

export class SharedFolderAuthOverrideRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findCredentialId(
    userId: string,
    folder: string,
    protocol: AuthOverrideProtocol,
  ): Promise<number | null> {
    const rows = await this.context.drizzle
      .select({ credentialId: sharedFolderAuthOverrides.credentialId })
      .from(sharedFolderAuthOverrides)
      .where(
        and(
          eq(sharedFolderAuthOverrides.userId, userId),
          eq(sharedFolderAuthOverrides.folder, folder),
          eq(sharedFolderAuthOverrides.protocol, protocol),
        ),
      )
      .limit(1);
    return rows[0]?.credentialId ?? null;
  }

  /**
   * The login set on the host's folder or the closest folder above it, for
   * one protocol. Null when none is set.
   */
  async findClosest(
    userId: string,
    hostFolder: string | null | undefined,
    protocol: AuthOverrideProtocol,
  ): Promise<{ folder: string; credentialId: number } | null> {
    const folders = folderAndParents(hostFolder);
    if (folders.length === 0) return null;
    const rows = await this.context.drizzle
      .select({
        folder: sharedFolderAuthOverrides.folder,
        credentialId: sharedFolderAuthOverrides.credentialId,
      })
      .from(sharedFolderAuthOverrides)
      .where(
        and(
          eq(sharedFolderAuthOverrides.userId, userId),
          eq(sharedFolderAuthOverrides.protocol, protocol),
          inArray(sharedFolderAuthOverrides.folder, folders),
        ),
      );
    for (const folder of folders) {
      const row = rows.find((candidate) => candidate.folder === folder);
      if (row) return row;
    }
    return null;
  }

  async setCredential(
    userId: string,
    folder: string,
    protocol: AuthOverrideProtocol,
    credentialId: number,
  ): Promise<void> {
    await upsert(
      this.context,
      sharedFolderAuthOverrides,
      { userId, folder, protocol, credentialId },
      {
        target: [
          sharedFolderAuthOverrides.userId,
          sharedFolderAuthOverrides.folder,
          sharedFolderAuthOverrides.protocol,
        ],
        set: { credentialId, updatedAt: new Date().toISOString() },
      },
    );
    await this.onWrite?.();
  }

  async clearCredential(
    userId: string,
    folder: string,
    protocol: AuthOverrideProtocol,
  ): Promise<boolean> {
    const rows = await deleteReturning(
      this.context,
      sharedFolderAuthOverrides,
      and(
        eq(sharedFolderAuthOverrides.userId, userId),
        eq(sharedFolderAuthOverrides.folder, folder),
        eq(sharedFolderAuthOverrides.protocol, protocol),
      ),
    );
    if (rows.length > 0) await this.onWrite?.();
    return rows.length > 0;
  }
}
