CREATE TABLE "user_external_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"email" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_second_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"factor_id" varchar(255) NOT NULL,
	"enrolled_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_external_identities" ADD CONSTRAINT "user_external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_second_factors" ADD CONSTRAINT "user_second_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_external_identities_provider_subject" ON "user_external_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "idx_user_external_identities_user" ON "user_external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_second_factors_user_factor" ON "user_second_factors" USING btree ("user_id","plugin_id","factor_id");