CREATE TABLE "apple_auth_nonces" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_enquiries" (
	"id" text PRIMARY KEY NOT NULL,
	"gym_id" text NOT NULL,
	"account_id" text NOT NULL,
	"pass_id" text,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_food_logs" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"meal" text NOT NULL,
	"food_id" text NOT NULL,
	"food_name" text NOT NULL,
	"grams" double precision NOT NULL,
	"kcal" double precision NOT NULL,
	"protein" double precision NOT NULL,
	"carbs" double precision NOT NULL,
	"fat" double precision NOT NULL,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_food_logs_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "member_foods" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"source" text DEFAULT 'custom' NOT NULL,
	"barcode" text,
	"kcal_per_100" double precision NOT NULL,
	"protein_per_100" double precision NOT NULL,
	"carbs_per_100" double precision NOT NULL,
	"fat_per_100" double precision NOT NULL,
	"serving_grams" double precision,
	"serving_label" text,
	"fiber_per_100" double precision,
	"sugar_per_100" double precision,
	"sodium_per_100" double precision,
	"nutri_score" text,
	"nova_group" integer,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_foods_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "member_measurements" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"waist_cm" double precision,
	"chest_cm" double precision,
	"arm_cm" double precision,
	"hip_cm" double precision,
	"thigh_cm" double precision,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_measurements_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "member_step_logs" (
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_step_logs_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "member_water_logs" (
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"ml" integer DEFAULT 0 NOT NULL,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_water_logs_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "member_weight_logs" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"kg" double precision NOT NULL,
	"client_changed_at" timestamp with time zone NOT NULL,
	"mutation_id" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_weight_logs_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"esewa_id" text,
	"esewa_name" text,
	"khalti_id" text,
	"khalti_name" text,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"qr_image_url" text,
	"instructions" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "coach_assignments" DROP CONSTRAINT "coach_assignments_assigned_by_accounts_id_fk";
--> statement-breakpoint
DROP INDEX "meal_partners_account";--> statement-breakpoint
DROP INDEX "meals_partner";--> statement-breakpoint
DROP INDEX "coach_reviews_coach";--> statement-breakpoint
DROP INDEX "gym_favorites_account";--> statement-breakpoint
DROP INDEX "admin_permission_overrides_account";--> statement-breakpoint
DROP INDEX "water_logs_user_date";--> statement-breakpoint
DROP INDEX "buddy_sessions_host";--> statement-breakpoint
DROP INDEX "weight_logs_user_date";--> statement-breakpoint
DROP INDEX "buddy_activity_account_created";--> statement-breakpoint
DROP INDEX "buddy_links_addressee";--> statement-breakpoint
DROP INDEX "buddy_links_requester_addressee";--> statement-breakpoint
DROP INDEX "sessions_account";--> statement-breakpoint
DROP INDEX "sessions_expires";--> statement-breakpoint
DROP INDEX "coach_messages_account_kind_created";--> statement-breakpoint
DROP INDEX "buddy_session_participants_session_account";--> statement-breakpoint
DROP INDEX "referrals_referrer_email";--> statement-breakpoint
DROP INDEX "trial_usage_account_tier";--> statement-breakpoint
DROP INDEX "device_push_tokens_account";--> statement-breakpoint
DROP INDEX "device_push_tokens_token";--> statement-breakpoint
DROP INDEX "audit_log_action_created";--> statement-breakpoint
DROP INDEX "audit_log_actor_created";--> statement-breakpoint
DROP INDEX "audit_log_created";--> statement-breakpoint
DROP INDEX "audit_log_target";--> statement-breakpoint
DROP INDEX "coach_assignments_coach_status";--> statement-breakpoint
DROP INDEX "coach_assignments_coach_user";--> statement-breakpoint
DROP INDEX "coach_assignments_user";--> statement-breakpoint
DROP INDEX "plan_videos_exercise";--> statement-breakpoint
DROP INDEX "plan_videos_tier_status_position";--> statement-breakpoint
DROP INDEX "check_ins_account_created";--> statement-breakpoint
DROP INDEX "check_ins_account_date";--> statement-breakpoint
DROP INDEX "progression_suggestions_account_exercise_source";--> statement-breakpoint
DROP INDEX "progression_suggestions_account_status";--> statement-breakpoint
DROP INDEX "synced_workouts_account_date";--> statement-breakpoint
DROP INDEX "synced_workouts_ranked_date";--> statement-breakpoint
DROP INDEX "synced_sets_account_exercise_logged";--> statement-breakpoint
DROP INDEX "synced_sets_workout";--> statement-breakpoint
DROP INDEX "awarded_badges_account_badge";--> statement-breakpoint
DROP INDEX "awarded_badges_status";--> statement-breakpoint
DROP INDEX "xp_events_account_kind_source";--> statement-breakpoint
DROP INDEX "buddy_quest_awards_month_pair";--> statement-breakpoint
DROP INDEX "coach_challenges_coach_month";--> statement-breakpoint
DROP INDEX "challenge_members_challenge_account";--> statement-breakpoint
DROP INDEX "coach_picks_coach_month";--> statement-breakpoint
DROP INDEX "rest_shield_uses_account_week";--> statement-breakpoint
DROP INDEX "coach_milestones_account_achieved";--> statement-breakpoint
DROP INDEX "coach_milestones_coach";--> statement-breakpoint
DROP INDEX "coach_requests_coach_status";--> statement-breakpoint
DROP INDEX "coach_requests_user_created";--> statement-breakpoint
DROP INDEX "coach_applications_account_created";--> statement-breakpoint
DROP INDEX "coach_applications_one_pending";--> statement-breakpoint
DROP INDEX "coach_applications_status";--> statement-breakpoint
DROP INDEX "coach_assigned_workouts_client_status";--> statement-breakpoint
DROP INDEX "coach_assigned_workouts_coach_client";--> statement-breakpoint
DROP INDEX "coach_diet_plans_client_status";--> statement-breakpoint
DROP INDEX "coach_diet_plans_coach_client";--> statement-breakpoint
DROP INDEX "coach_tier_requests_coach_status";--> statement-breakpoint
DROP INDEX "coach_tier_requests_one_pending";--> statement-breakpoint
DROP INDEX "discount_grants_account_status";--> statement-breakpoint
DROP INDEX "discount_grants_one_active";--> statement-breakpoint
DROP INDEX "payment_requests_one_pending_account";--> statement-breakpoint
DROP INDEX "payment_requests_one_pending_grant";--> statement-breakpoint
DROP INDEX "payment_requests_receipt";--> statement-breakpoint
DROP INDEX "payment_requests_status_created";--> statement-breakpoint
DROP INDEX "buddy_messages_link_created";--> statement-breakpoint
DROP INDEX "promo_codes_owner_coach";--> statement-breakpoint
DROP INDEX "progress_photos_account_taken";--> statement-breakpoint
DROP INDEX "progress_photos_image_uid";--> statement-breakpoint
DROP INDEX "tier_prices_region_tier";--> statement-breakpoint
DROP INDEX "wallet_ledger_coach_created";--> statement-breakpoint
DROP INDEX "wallet_ledger_source";--> statement-breakpoint
DROP INDEX "accounts_tier_expires";--> statement-breakpoint
DROP INDEX "promo_redemptions_code_account";--> statement-breakpoint
DROP INDEX "coach_payout_requests_coach_status";--> statement-breakpoint
DROP INDEX "coach_payout_requests_one_pending";--> statement-breakpoint
DROP INDEX "coach_payout_requests_status_requested";--> statement-breakpoint
DROP INDEX "password_reset_tokens_account";--> statement-breakpoint
DROP INDEX "password_reset_tokens_hash";--> statement-breakpoint
DROP INDEX "support_thread_states_assigned";--> statement-breakpoint
DROP INDEX "support_thread_states_status_updated";--> statement-breakpoint
DROP INDEX "meal_availability_meal_day_window";--> statement-breakpoint
DROP INDEX "gyms_city";--> statement-breakpoint
DROP INDEX "gyms_status";--> statement-breakpoint
DROP INDEX "meal_order_items_order";--> statement-breakpoint
DROP INDEX "meal_partners_active";--> statement-breakpoint
DROP INDEX "saved_addresses_account";--> statement-breakpoint
DROP INDEX "meal_payment_requests_account";--> statement-breakpoint
DROP INDEX "meal_payment_requests_status";--> statement-breakpoint
DROP INDEX "meal_sub_skips_sub_date";--> statement-breakpoint
DROP INDEX "meals_partner_active";--> statement-breakpoint
DROP INDEX "meal_orders_account";--> statement-breakpoint
DROP INDEX "meal_orders_account_client_request";--> statement-breakpoint
DROP INDEX "meal_orders_partner_date";--> statement-breakpoint
DROP INDEX "meal_orders_partner_status";--> statement-breakpoint
DROP INDEX "meal_orders_sub_slot";--> statement-breakpoint
DROP INDEX "meal_subscriptions_account";--> statement-breakpoint
DROP INDEX "meal_subscriptions_partner_status";--> statement-breakpoint
DROP INDEX "meal_order_events_order";--> statement-breakpoint
DROP INDEX "gym_photos_gym";--> statement-breakpoint
DROP INDEX "meal_billing_cycles_account";--> statement-breakpoint
DROP INDEX "meal_billing_cycles_status";--> statement-breakpoint
DROP INDEX "meal_billing_cycles_sub_week";--> statement-breakpoint
DROP INDEX "image_upload_reservations_account_kind_expiry";--> statement-breakpoint
DROP INDEX "image_upload_reservations_asset_uid";--> statement-breakpoint
DROP INDEX "image_upload_reservations_expiry";--> statement-breakpoint
DROP INDEX "coach_message_templates_coach";--> statement-breakpoint
DROP INDEX "coach_client_notes_coach_user";--> statement-breakpoint
DROP INDEX "gym_reviews_gym_account";--> statement-breakpoint
DROP INDEX "gym_reviews_gym_status";--> statement-breakpoint
DROP INDEX "meal_disputes_account";--> statement-breakpoint
DROP INDEX "meal_disputes_one_live";--> statement-breakpoint
DROP INDEX "meal_disputes_status_created";--> statement-breakpoint
DROP INDEX "meal_order_ratings_order";--> statement-breakpoint
DROP INDEX "meal_order_ratings_partner";--> statement-breakpoint
DROP INDEX "notifications_account_created";--> statement-breakpoint
DROP INDEX "notifications_dedupe";--> statement-breakpoint
DROP INDEX "notifications_unsent";--> statement-breakpoint
DROP INDEX "partner_payout_requests_one_pending";--> statement-breakpoint
DROP INDEX "partner_payout_requests_partner_status";--> statement-breakpoint
DROP INDEX "partner_payout_requests_status_requested";--> statement-breakpoint
DROP INDEX "partner_wallet_ledger_partner_created";--> statement-breakpoint
DROP INDEX "partner_wallet_ledger_source";--> statement-breakpoint
DROP INDEX "coach_reviews_coach_member";--> statement-breakpoint
DROP INDEX "gym_reports_status_created";--> statement-breakpoint
ALTER TABLE "coach_assignments" ALTER COLUMN "assigned_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "summary" SET DEFAULT '{"sessions":0,"volumeKg":0,"prCount":0}'::jsonb;--> statement-breakpoint
ALTER TABLE "gyms" ALTER COLUMN "amenities" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "meal_partners" ALTER COLUMN "service_areas" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "meals" ALTER COLUMN "goal_tags" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "meal_subscriptions" ALTER COLUMN "days_of_week" SET DEFAULT '{}'::integer[];--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "apple_sub" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "equipment" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "crowd_data" jsonb;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "pass_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "coach_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_enquiries" ADD CONSTRAINT "gym_enquiries_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_enquiries" ADD CONSTRAINT "gym_enquiries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_enquiries" ADD CONSTRAINT "gym_enquiries_handled_by_accounts_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_food_logs" ADD CONSTRAINT "member_food_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_foods" ADD CONSTRAINT "member_foods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_measurements" ADD CONSTRAINT "member_measurements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_step_logs" ADD CONSTRAINT "member_step_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_water_logs" ADD CONSTRAINT "member_water_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_weight_logs" ADD CONSTRAINT "member_weight_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apple_auth_nonces_expires" ON "apple_auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "gym_enquiries_gym" ON "gym_enquiries" USING btree ("gym_id");--> statement-breakpoint
CREATE INDEX "gym_enquiries_status_created" ON "gym_enquiries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_food_logs_account_mutation" ON "member_food_logs" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_food_logs_account_updated" ON "member_food_logs" USING btree ("account_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "member_food_logs_account_date" ON "member_food_logs" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "member_foods_account_mutation" ON "member_foods" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_foods_account_updated" ON "member_foods" USING btree ("account_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_measurements_account_mutation" ON "member_measurements" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_measurements_account_updated" ON "member_measurements" USING btree ("account_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_step_logs_account_mutation" ON "member_step_logs" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_step_logs_account_updated" ON "member_step_logs" USING btree ("account_id","updated_at","date");--> statement-breakpoint
CREATE UNIQUE INDEX "member_water_logs_account_mutation" ON "member_water_logs" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_water_logs_account_updated" ON "member_water_logs" USING btree ("account_id","updated_at","date");--> statement-breakpoint
CREATE UNIQUE INDEX "member_weight_logs_account_mutation" ON "member_weight_logs" USING btree ("account_id","mutation_id");--> statement-breakpoint
CREATE INDEX "member_weight_logs_account_updated" ON "member_weight_logs" USING btree ("account_id","updated_at","date");--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_assigned_by_accounts_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_delivery_config" ADD CONSTRAINT "meal_delivery_config_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_lower" ON "profiles" USING btree (lower("email")) WHERE "profiles"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_requests_one_pending" ON "coach_requests" USING btree ("user_id") WHERE "coach_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "saved_addresses_one_default" ON "saved_addresses" USING btree ("account_id") WHERE "saved_addresses"."is_default" = true;--> statement-breakpoint
CREATE INDEX "meal_payment_requests_order" ON "meal_payment_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "meal_payment_requests_cycle" ON "meal_payment_requests" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_payment_requests_one_live_order" ON "meal_payment_requests" USING btree ("order_id") WHERE "meal_payment_requests"."status" = 'pending' and "meal_payment_requests"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_payment_requests_one_live_cycle" ON "meal_payment_requests" USING btree ("cycle_id") WHERE "meal_payment_requests"."status" = 'pending' and "meal_payment_requests"."cycle_id" is not null;--> statement-breakpoint
CREATE INDEX "meal_orders_delivery_date" ON "meal_orders" USING btree ("delivery_date");--> statement-breakpoint
CREATE INDEX "meal_orders_placed" ON "meal_orders" USING btree ("placed_at","id");--> statement-breakpoint
CREATE INDEX "meal_orders_subscription" ON "meal_orders" USING btree ("subscription_id") WHERE "meal_orders"."subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "water_logs_user_date" ON "water_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "buddy_sessions_host" ON "buddy_sessions" USING btree ("host_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_logs_user_date" ON "weight_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "buddy_activity_account_created" ON "buddy_activity" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "buddy_links_addressee" ON "buddy_links" USING btree ("addressee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_links_requester_addressee" ON "buddy_links" USING btree ("requester_id","addressee_id");--> statement-breakpoint
CREATE INDEX "sessions_account" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "coach_messages_account_kind_created" ON "coach_messages" USING btree ("account_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_session_participants_session_account" ON "buddy_session_participants" USING btree ("session_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referrer_email" ON "referrals" USING btree ("referrer_id","invitee_email");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_usage_account_tier" ON "trial_usage" USING btree ("account_id","tier");--> statement-breakpoint
CREATE INDEX "device_push_tokens_account" ON "device_push_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_push_tokens_token" ON "device_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "audit_log_action_created" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "coach_assignments_coach_status" ON "coach_assignments" USING btree ("coach_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_assignments_coach_user" ON "coach_assignments" USING btree ("coach_id","user_id");--> statement-breakpoint
CREATE INDEX "coach_assignments_user" ON "coach_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plan_videos_exercise" ON "plan_videos" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "plan_videos_tier_status_position" ON "plan_videos" USING btree ("tier_required","status","position");--> statement-breakpoint
CREATE INDEX "check_ins_account_created" ON "check_ins" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_account_date" ON "check_ins" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_suggestions_account_exercise_source" ON "progression_suggestions" USING btree ("account_id","exercise_id","source_workout_id");--> statement-breakpoint
CREATE INDEX "progression_suggestions_account_status" ON "progression_suggestions" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "synced_workouts_account_date" ON "synced_workouts" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "synced_workouts_ranked_date" ON "synced_workouts" USING btree ("ranked","date");--> statement-breakpoint
CREATE INDEX "synced_sets_account_exercise_logged" ON "synced_sets" USING btree ("account_id","exercise_id","logged_at");--> statement-breakpoint
CREATE INDEX "synced_sets_workout" ON "synced_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "awarded_badges_account_badge" ON "awarded_badges" USING btree ("account_id","badge_id");--> statement-breakpoint
CREATE INDEX "awarded_badges_status" ON "awarded_badges" USING btree ("status","earned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_account_kind_source" ON "xp_events" USING btree ("account_id","kind","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_quest_awards_month_pair" ON "buddy_quest_awards" USING btree ("month_key","account_a","account_b");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_challenges_coach_month" ON "coach_challenges" USING btree ("coach_id","month_key");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_members_challenge_account" ON "challenge_members" USING btree ("challenge_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_picks_coach_month" ON "coach_picks" USING btree ("coach_id","month_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rest_shield_uses_account_week" ON "rest_shield_uses" USING btree ("account_id","week_start");--> statement-breakpoint
CREATE INDEX "coach_milestones_account_achieved" ON "coach_milestones" USING btree ("account_id","achieved_at");--> statement-breakpoint
CREATE INDEX "coach_milestones_coach" ON "coach_milestones" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "coach_requests_coach_status" ON "coach_requests" USING btree ("coach_id","status");--> statement-breakpoint
CREATE INDEX "coach_requests_user_created" ON "coach_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_applications_account_created" ON "coach_applications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_applications_one_pending" ON "coach_applications" USING btree ("account_id") WHERE "coach_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "coach_applications_status" ON "coach_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "coach_assigned_workouts_client_status" ON "coach_assigned_workouts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "coach_assigned_workouts_coach_client" ON "coach_assigned_workouts" USING btree ("coach_id","client_id");--> statement-breakpoint
CREATE INDEX "coach_diet_plans_client_status" ON "coach_diet_plans" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "coach_diet_plans_coach_client" ON "coach_diet_plans" USING btree ("coach_id","client_id");--> statement-breakpoint
CREATE INDEX "coach_tier_requests_coach_status" ON "coach_tier_requests" USING btree ("coach_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_tier_requests_one_pending" ON "coach_tier_requests" USING btree ("coach_id") WHERE "coach_tier_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "discount_grants_account_status" ON "discount_grants" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_grants_one_active" ON "discount_grants" USING btree ("account_id") WHERE "discount_grants"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_pending_account" ON "payment_requests" USING btree ("account_id") WHERE "payment_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_pending_grant" ON "payment_requests" USING btree ("discount_grant_id") WHERE "payment_requests"."status" = 'pending' and "payment_requests"."discount_grant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_receipt" ON "payment_requests" USING btree ("receipt_url");--> statement-breakpoint
CREATE INDEX "payment_requests_status_created" ON "payment_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "buddy_messages_link_created" ON "buddy_messages" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "promo_codes_owner_coach" ON "promo_codes" USING btree ("owner_coach_id");--> statement-breakpoint
CREATE INDEX "progress_photos_account_taken" ON "progress_photos" USING btree ("account_id","taken_on");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_photos_image_uid" ON "progress_photos" USING btree ("image_url");--> statement-breakpoint
CREATE UNIQUE INDEX "tier_prices_region_tier" ON "tier_prices" USING btree ("region","tier");--> statement-breakpoint
CREATE INDEX "wallet_ledger_coach_created" ON "wallet_ledger" USING btree ("coach_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_source" ON "wallet_ledger" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "accounts_tier_expires" ON "accounts" USING btree ("tier_expires_at") WHERE "accounts"."tier_expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_code_account" ON "promo_redemptions" USING btree ("code_id","account_id");--> statement-breakpoint
CREATE INDEX "coach_payout_requests_coach_status" ON "coach_payout_requests" USING btree ("coach_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_payout_requests_one_pending" ON "coach_payout_requests" USING btree ("coach_id") WHERE "coach_payout_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "coach_payout_requests_status_requested" ON "coach_payout_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_account" ON "password_reset_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "support_thread_states_assigned" ON "support_thread_states" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "support_thread_states_status_updated" ON "support_thread_states" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_availability_meal_day_window" ON "meal_availability" USING btree ("meal_id","day_of_week","window");--> statement-breakpoint
CREATE INDEX "gyms_city" ON "gyms" USING btree ("city");--> statement-breakpoint
CREATE INDEX "gyms_status" ON "gyms" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meal_order_items_order" ON "meal_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "meal_partners_active" ON "meal_partners" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "saved_addresses_account" ON "saved_addresses" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meal_payment_requests_account" ON "meal_payment_requests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meal_payment_requests_status" ON "meal_payment_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_sub_skips_sub_date" ON "meal_sub_skips" USING btree ("subscription_id","delivery_date");--> statement-breakpoint
CREATE INDEX "meals_partner_active" ON "meals" USING btree ("partner_id","is_active");--> statement-breakpoint
CREATE INDEX "meal_orders_account" ON "meal_orders" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_orders_account_client_request" ON "meal_orders" USING btree ("account_id","client_request_id") WHERE "meal_orders"."source" = 'one_time' AND "meal_orders"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "meal_orders_partner_date" ON "meal_orders" USING btree ("partner_id","delivery_date");--> statement-breakpoint
CREATE INDEX "meal_orders_partner_status" ON "meal_orders" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_orders_sub_slot" ON "meal_orders" USING btree ("subscription_id","delivery_date","window") WHERE "meal_orders"."source" = 'subscription';--> statement-breakpoint
CREATE INDEX "meal_subscriptions_account" ON "meal_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meal_subscriptions_partner_status" ON "meal_subscriptions" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "meal_order_events_order" ON "meal_order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "gym_photos_gym" ON "gym_photos" USING btree ("gym_id");--> statement-breakpoint
CREATE INDEX "meal_billing_cycles_account" ON "meal_billing_cycles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meal_billing_cycles_status" ON "meal_billing_cycles" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_billing_cycles_sub_week" ON "meal_billing_cycles" USING btree ("subscription_id","week_start");--> statement-breakpoint
CREATE INDEX "image_upload_reservations_account_kind_expiry" ON "image_upload_reservations" USING btree ("account_id","kind","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "image_upload_reservations_asset_uid" ON "image_upload_reservations" USING btree ("asset_uid");--> statement-breakpoint
CREATE INDEX "image_upload_reservations_expiry" ON "image_upload_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "coach_message_templates_coach" ON "coach_message_templates" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_client_notes_coach_user" ON "coach_client_notes" USING btree ("coach_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_reviews_gym_account" ON "gym_reviews" USING btree ("gym_id","account_id");--> statement-breakpoint
CREATE INDEX "gym_reviews_gym_status" ON "gym_reviews" USING btree ("gym_id","status");--> statement-breakpoint
CREATE INDEX "meal_disputes_account" ON "meal_disputes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_disputes_one_live" ON "meal_disputes" USING btree ("order_id") WHERE "meal_disputes"."status" in ('open','reviewing');--> statement-breakpoint
CREATE INDEX "meal_disputes_status_created" ON "meal_disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_order_ratings_order" ON "meal_order_ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "meal_order_ratings_partner" ON "meal_order_ratings" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "notifications_account_created" ON "notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_unsent" ON "notifications" USING btree ("sent_at") WHERE "notifications"."sent_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_requests_one_pending" ON "partner_payout_requests" USING btree ("partner_id") WHERE "partner_payout_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "partner_payout_requests_partner_status" ON "partner_payout_requests" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_payout_requests_status_requested" ON "partner_payout_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "partner_wallet_ledger_partner_created" ON "partner_wallet_ledger" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_wallet_ledger_source" ON "partner_wallet_ledger" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_reviews_coach_member" ON "coach_reviews" USING btree ("coach_id","member_id");--> statement-breakpoint
CREATE INDEX "gym_reports_status_created" ON "gym_reports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_apple_sub_unique" UNIQUE("apple_sub");