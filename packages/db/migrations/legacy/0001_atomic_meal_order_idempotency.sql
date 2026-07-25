ALTER TABLE "meal_orders" ADD COLUMN "client_request_id" text;
--> statement-breakpoint
ALTER TABLE "meal_orders" ADD COLUMN "request_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "meal_partners" ADD COLUMN "accepting_orders" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "meal_orders_account_client_request"
  ON "meal_orders" USING btree ("account_id", "client_request_id")
  WHERE "source" = 'one_time' AND "client_request_id" IS NOT NULL;
