ALTER TABLE "p_ai_providers" ADD COLUMN "sync_id" text;
CREATE UNIQUE INDEX "p_ai_providers_sync_id_unique" ON "p_ai_providers" ("sync_id");
