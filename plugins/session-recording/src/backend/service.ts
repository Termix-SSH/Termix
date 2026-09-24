import fs from "node:fs/promises";
import path from "node:path";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SessionRecordingRepository } from "./repository.js";

/**
 * recordings.writer v1, the service ssh-terminal calls to record sessions.
 *
 * One call per already-batched chunk (ssh-terminal coalesces on a 300ms
 * trailing edge, issue #1049): mkdir and writeFile on the first append,
 * appendFile after that, never per chunk.
 */
export interface RecordingSink {
  append: (chunk: string) => Promise<void>;
  persist: (summary: {
    endedAt: number;
    durationSeconds: number;
    terminatedByOwner: boolean;
    terminationReason: string | null;
  }) => Promise<void>;
  discard: () => void;
}

export interface RecordingsWriterV1 {
  /** Null when recording is off for this user or host. */
  open: (meta: {
    sessionId: string;
    hostId: number;
    userId: string;
    protocol: "ssh";
    format: "asciicast";
    startedAt: number;
  }) => Promise<RecordingSink | null>;
  /**
   * Inserts a row for a recording a caller already wrote to disk itself
   * (remote desktop's guacd recordings), rather than streaming through
   * open()/append(). The caller already decided to record; this only writes
   * the row.
   */
  createFinished: (input: {
    hostId: number;
    userId: string;
    startedAt: string;
    endedAt: string;
    duration: number | null;
    recordingPath: string;
    protocol: string;
    format: string;
  }) => Promise<{ id: number }>;
}

export function createRecordingsWriter(
  ctx: PluginContext,
  repository: SessionRecordingRepository,
): RecordingsWriterV1 {
  return {
    async open(meta) {
      const enabled = await ctx.settings.getHost<boolean>(
        meta.hostId,
        "enableSessionRecording",
      );
      if (enabled === false) return null;

      const dataDir = await ctx.files.dataDir();
      const dir = path.join(dataDir, "session_logs", meta.userId);
      const filePath = path.join(dir, `${meta.sessionId}.cast`);
      let wroteFirst = false;
      let discarded = false;

      const username = await repository.usernameFor(meta.userId);
      const row = await repository.create({
        hostId: meta.hostId,
        userId: meta.userId,
        username,
        startedAt: new Date(meta.startedAt).toISOString(),
        recordingPath: filePath,
        protocol: meta.protocol,
        format: meta.format,
      });

      return {
        async append(chunk: string) {
          if (discarded) return;
          if (!wroteFirst) {
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, chunk);
            wroteFirst = true;
          } else {
            await fs.appendFile(filePath, chunk);
          }
        },

        async persist(summary) {
          if (discarded) return;
          await repository.updateEnded(row.id, {
            endedAt: new Date(summary.endedAt).toISOString(),
            duration: summary.durationSeconds,
            terminatedByOwner: summary.terminatedByOwner,
            terminationReason: summary.terminationReason,
          });
        },

        discard() {
          discarded = true;
          void repository.deleteById(row.id).catch(() => {});
        },
      };
    },

    async createFinished(input) {
      const username = await repository.usernameFor(input.userId);
      const row = await repository.create({ ...input, username });
      return { id: row.id };
    },
  };
}
