CREATE TABLE "user_workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" text,
	"icon" text,
	"kind" text DEFAULT 'manual' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" text,
	CONSTRAINT "user_workspaces_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
ALTER TABLE "user_workspaces" ADD CONSTRAINT "user_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;