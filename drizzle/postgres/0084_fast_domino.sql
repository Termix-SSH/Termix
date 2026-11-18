CREATE TABLE "frame_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"client" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"data" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frame_registrations" ADD CONSTRAINT "frame_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_frame_registrations_user_client_plugin" ON "frame_registrations" USING btree ("user_id","client","plugin_id");