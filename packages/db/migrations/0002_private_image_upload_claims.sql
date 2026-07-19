CREATE TABLE "image_upload_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"asset_uid" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_upload_reservations" ADD CONSTRAINT "image_upload_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "image_upload_reservations_asset_uid" ON "image_upload_reservations" USING btree ("asset_uid");
--> statement-breakpoint
CREATE INDEX "image_upload_reservations_account_kind_expiry" ON "image_upload_reservations" USING btree ("account_id","kind","expires_at");
--> statement-breakpoint
CREATE INDEX "image_upload_reservations_expiry" ON "image_upload_reservations" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "progress_photos_image_uid" ON "progress_photos" USING btree ("image_url");
