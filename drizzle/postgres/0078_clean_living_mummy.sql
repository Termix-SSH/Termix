CREATE TABLE "operation_approvals" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"run_id" varchar(255) NOT NULL,
	"requested_by" text,
	"reason" text,
	"allow_self" boolean DEFAULT false NOT NULL,
	"status" varchar(255) NOT NULL,
	"decided_by" text,
	"comment" text,
	"created_at" text NOT NULL,
	"expires_at" varchar(255) NOT NULL,
	"decided_at" text
);
--> statement-breakpoint
CREATE TABLE "operation_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"host_id" integer,
	"severity" text,
	"payload" text,
	"run_id" text,
	"created_at" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_runs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"action_version" integer DEFAULT 1 NOT NULL,
	"plugin_id" text NOT NULL,
	"plugin_version" text NOT NULL,
	"user_id" varchar(255),
	"username" text NOT NULL,
	"origin" text NOT NULL,
	"host_id" integer,
	"host_name" text,
	"batch_id" varchar(255),
	"dry_run" boolean DEFAULT false NOT NULL,
	"risk" text NOT NULL,
	"status" varchar(255) NOT NULL,
	"summary" text,
	"changed" boolean,
	"input" text,
	"sealed_input" text,
	"output" text,
	"undo_input" text,
	"error" text,
	"error_code" text,
	"undo_of" text,
	"idempotency_key" text,
	"created_at" varchar(255) NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scopes" text;--> statement-breakpoint
ALTER TABLE "operation_approvals" ADD CONSTRAINT "operation_approvals_run_id_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_runs" ADD CONSTRAINT "operation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_operation_approvals_status" ON "operation_approvals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_operation_approvals_run" ON "operation_approvals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_operation_events_created" ON "operation_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_operation_events_host_created" ON "operation_events" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_operation_runs_created" ON "operation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_operation_runs_user_created" ON "operation_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_operation_runs_host_created" ON "operation_runs" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_operation_runs_status" ON "operation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_operation_runs_batch" ON "operation_runs" USING btree ("batch_id");