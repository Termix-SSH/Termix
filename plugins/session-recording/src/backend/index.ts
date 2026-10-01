import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { sessionRecordings } from "./tables.js";
import { createSessionRecordingRepository } from "./repository.js";
import { createRecordingsWriter, type RecordingsWriterV1 } from "./service.js";
import { registerSessionRecordingRoutes } from "./routes.js";
import { startRetentionSweep } from "./retention.js";

export type { RecordingsWriterV1, RecordingSink } from "./service.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(sessionRecordings);
  const repository = createSessionRecordingRepository(ctx.db, table, ctx.hosts);

  ctx.http
    .router<Router>()
    .use(
      registerSessionRecordingRoutes(ctx, repository, () =>
        ctx.files.dataDir(),
      ),
    );

  ctx.services.provide<RecordingsWriterV1>(
    "recordings.writer",
    createRecordingsWriter(ctx, repository),
  );

  // A recording is evidence about the host as much as the person, so it
  // outlives the account: the row's userId is cleared rather than cascading.
  ctx.events.on("user.deleted", (payload) => {
    const { userId } = payload as { userId: string };
    void repository.anonymizeByUserId(userId);
  });

  startRetentionSweep(ctx, repository, () => ctx.files.dataDir());

  ctx.log.info(
    "Session Recording routes mounted at /plugin-api/session-recording",
  );
}

export async function deactivate() {}
