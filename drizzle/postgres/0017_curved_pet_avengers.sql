CREATE TABLE "secret_sources" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" text DEFAULT 'onepassword-connect' NOT NULL,
	"base_url" text NOT NULL,
	"token" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_sources" ADD CONSTRAINT "secret_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_secret_sources_user" ON "secret_sources" USING btree ("user_id");