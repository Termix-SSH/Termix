CREATE TABLE "admin_holds" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"summary" text NOT NULL,
	"requested_by" varchar(255),
	"requested_by_name" text NOT NULL,
	"requested_at" text NOT NULL,
	"runs_at" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "admin_holds" ADD CONSTRAINT "admin_holds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_holds_status_runs" ON "admin_holds" USING btree ("status","runs_at");