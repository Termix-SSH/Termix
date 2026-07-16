import { eq } from "drizzle-orm";
import { hosts, sshCredentials } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type UserDataExportHostRecord = typeof hosts.$inferSelect;
export type UserDataExportCredentialRecord = typeof sshCredentials.$inferSelect;

export class UserDataExportRepository {
  constructor(private readonly context: DatabaseContext) {}

  async listHostsByUserId(userId: string): Promise<UserDataExportHostRecord[]> {
    return this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId));
  }

  async listCredentialsByUserId(
    userId: string,
  ): Promise<UserDataExportCredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId));
  }
}
