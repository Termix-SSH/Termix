ALTER TABLE "collab_rooms" ADD COLUMN "guest_link_token" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collab_rooms_guest_token" ON "collab_rooms" USING btree ("guest_link_token");