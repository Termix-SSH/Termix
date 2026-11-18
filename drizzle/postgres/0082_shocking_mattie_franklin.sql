CREATE TABLE "user_invites" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"note" text,
	"role_ids" text,
	"make_admin" boolean DEFAULT false NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" text;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_invites_token_hash" ON "user_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");