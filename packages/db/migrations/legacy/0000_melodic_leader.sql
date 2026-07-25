CREATE TABLE "account_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"display_name" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT 'starter' NOT NULL,
	"tier_started_at" timestamp with time zone,
	"tier_expires_at" timestamp with time zone,
	"tier_source" text,
	"tier_source_id" text,
	"revenuecat_event_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"public_board_hidden" boolean DEFAULT false NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "admin_permission_overrides" (
	"account_id" text NOT NULL,
	"perm" text NOT NULL,
	"allow" boolean NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_permission_overrides_account_id_perm_pk" PRIMARY KEY("account_id","perm")
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"account_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awarded_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"status" text DEFAULT 'logged' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_links" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"sender_account_id" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_quest_awards" (
	"id" text PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"account_a" text NOT NULL,
	"account_b" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_session_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"account_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"workout_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "challenge_members" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"account_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"bodyweight_kg" double precision,
	"sleep" integer NOT NULL,
	"energy" integer NOT NULL,
	"soreness" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"summary" jsonb DEFAULT '{"sessions":0,"volumeKg":0,"prCount":0}'::jsonb NOT NULL,
	"coach_reply_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"achievements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_assigned_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"title" text NOT NULL,
	"month_key" text NOT NULL,
	"target_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_diet_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"meals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"sender" text NOT NULL,
	"body" text NOT NULL,
	"sender_account_id" text,
	"read_by_coach" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_by_user" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"account_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"achieved_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"disbursement_ref" text,
	"decided_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coach_picks" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"account_id" text NOT NULL,
	"month_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"coach_tier" text DEFAULT 'silver' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"achievements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"capacity" integer DEFAULT 50 NOT NULL,
	"accepting_clients" boolean DEFAULT true NOT NULL,
	"reply_window_hours" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"coach_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_tier_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"requested_tier" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"source" text NOT NULL,
	"promo_code_id" text,
	"pct" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"muscle_group" text NOT NULL,
	"secondary_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment" text,
	"level" text,
	"category" text,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"meal" text NOT NULL,
	"food_id" text NOT NULL,
	"food_name" text NOT NULL,
	"grams" double precision NOT NULL,
	"kcal" double precision NOT NULL,
	"protein" double precision NOT NULL,
	"carbs" double precision NOT NULL,
	"fat" double precision NOT NULL,
	"logged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"source" text NOT NULL,
	"barcode" text,
	"kcal_per_100" double precision NOT NULL,
	"protein_per_100" double precision NOT NULL,
	"carbs_per_100" double precision NOT NULL,
	"fat_per_100" double precision NOT NULL,
	"serving_grams" double precision,
	"serving_label" text,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "gamification_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"xp_total" integer DEFAULT 0 NOT NULL,
	"weekly_target_days" integer DEFAULT 3 NOT NULL,
	"streak_weeks" integer DEFAULT 0 NOT NULL,
	"best_streak_weeks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"waist_cm" double precision,
	"chest_cm" double precision,
	"arm_cm" double precision,
	"hip_cm" double precision,
	"thigh_cm" double precision
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tier" text NOT NULL,
	"months" integer NOT NULL,
	"region" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"receipt_url" text NOT NULL,
	"note" text,
	"promo_code_id" text,
	"discount_grant_id" text,
	"discount_pct" integer,
	"base_amount_minor" integer,
	"tier_granted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"prior_tier" text,
	"prior_expires_at" timestamp with time zone,
	"prior_tier_source" text,
	"prior_tier_source_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"storage_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_workout_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sets" integer NOT NULL,
	"rep_range" text NOT NULL,
	"rest_sec" integer DEFAULT 120 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"exercise_id" text,
	"plan_id" text,
	"tier_required" text DEFAULT 'gold' NOT NULL,
	"provider" text DEFAULT 'cf_stream' NOT NULL,
	"provider_video_id" text NOT NULL,
	"thumbnail_url" text,
	"duration_sec" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"week" integer NOT NULL,
	"day" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier_required" text DEFAULT 'starter' NOT NULL,
	"goal_type" text NOT NULL,
	"weeks" integer NOT NULL,
	"days_per_week" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_branded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text,
	"dob" date,
	"sex" text,
	"height_cm" double precision,
	"unit_pref" text DEFAULT 'kg' NOT NULL,
	"tier" text DEFAULT 'starter' NOT NULL,
	"goal_type" text,
	"activity_level" text,
	"font_scale" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"taken_on" date NOT NULL,
	"image_url" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progression_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"exercise_name" text NOT NULL,
	"source_workout_id" text NOT NULL,
	"action" text NOT NULL,
	"target_weight_kg" double precision NOT NULL,
	"target_reps_min" integer NOT NULL,
	"target_reps_max" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"coach_id" text,
	"adjusted_weight_kg" double precision,
	"coach_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"owner_coach_id" text,
	"discount_pct" integer NOT NULL,
	"commission_pct" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"code_id" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"purchase_amount_minor" integer,
	"currency" text,
	"commission_minor" integer,
	"counted_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"invitee_email" text NOT NULL,
	"invitee_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rewarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rest_shield_uses" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"week_start" date NOT NULL,
	"month_key" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenuecat_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"type" text DEFAULT 'legacy' NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tier_applied_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_log_id" text NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"exercise_name" text NOT NULL,
	"set_no" integer NOT NULL,
	"weight_kg" double precision NOT NULL,
	"reps" integer NOT NULL,
	"rpe" double precision,
	"is_pr" boolean DEFAULT false NOT NULL,
	"logged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"best" integer DEFAULT 0 NOT NULL,
	"last_workout_date" date
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"rc_customer_id" text,
	"tier" text DEFAULT 'starter' NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_thread_states" (
	"account_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synced_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_id" text NOT NULL,
	"account_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"exercise_name" text NOT NULL,
	"set_no" integer NOT NULL,
	"weight_kg" double precision NOT NULL,
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"reps" integer NOT NULL,
	"rpe" double precision,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"is_pr" boolean DEFAULT false NOT NULL,
	"logged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synced_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"template_id" text,
	"template_name" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_sec" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ranked" boolean DEFAULT true NOT NULL,
	"flag_reason" text
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kcal" integer NOT NULL,
	"protein" integer NOT NULL,
	"carbs" integer NOT NULL,
	"fat" integer NOT NULL,
	"water_ml" integer NOT NULL,
	"active_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tier_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"tier" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tier" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "water_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"ml" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"kg" double precision NOT NULL,
	"logged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_flag_acks" (
	"workout_id" text PRIMARY KEY NOT NULL,
	"coach_id" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"plan_workout_id" text,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_sec" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_profiles" ADD CONSTRAINT "account_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_granted_by_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awarded_badges" ADD CONSTRAINT "awarded_badges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awarded_badges" ADD CONSTRAINT "awarded_badges_verified_by_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddies" ADD CONSTRAINT "buddies_user_a_profiles_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddies" ADD CONSTRAINT "buddies_user_b_profiles_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_activity" ADD CONSTRAINT "buddy_activity_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_activity" ADD CONSTRAINT "buddy_activity_target_id_accounts_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_events" ADD CONSTRAINT "buddy_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_events" ADD CONSTRAINT "buddy_events_target_id_profiles_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_links" ADD CONSTRAINT "buddy_links_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_links" ADD CONSTRAINT "buddy_links_addressee_id_accounts_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_messages" ADD CONSTRAINT "buddy_messages_link_id_buddy_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."buddy_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_messages" ADD CONSTRAINT "buddy_messages_sender_account_id_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_quest_awards" ADD CONSTRAINT "buddy_quest_awards_account_a_accounts_id_fk" FOREIGN KEY ("account_a") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_quest_awards" ADD CONSTRAINT "buddy_quest_awards_account_b_accounts_id_fk" FOREIGN KEY ("account_b") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_session_participants" ADD CONSTRAINT "buddy_session_participants_session_id_buddy_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."buddy_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_session_participants" ADD CONSTRAINT "buddy_session_participants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_sessions" ADD CONSTRAINT "buddy_sessions_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_members" ADD CONSTRAINT "challenge_members_challenge_id_coach_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."coach_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_members" ADD CONSTRAINT "challenge_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_coach_reply_message_id_coach_messages_id_fk" FOREIGN KEY ("coach_reply_message_id") REFERENCES "public"."coach_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_applications" ADD CONSTRAINT "coach_applications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_applications" ADD CONSTRAINT "coach_applications_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assigned_workouts" ADD CONSTRAINT "coach_assigned_workouts_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assigned_workouts" ADD CONSTRAINT "coach_assigned_workouts_client_id_accounts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_assigned_by_accounts_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_challenges" ADD CONSTRAINT "coach_challenges_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_diet_plans" ADD CONSTRAINT "coach_diet_plans_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_diet_plans" ADD CONSTRAINT "coach_diet_plans_client_id_accounts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_sender_account_id_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_milestones" ADD CONSTRAINT "coach_milestones_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_milestones" ADD CONSTRAINT "coach_milestones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_payout_requests" ADD CONSTRAINT "coach_payout_requests_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_payout_requests" ADD CONSTRAINT "coach_payout_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_picks" ADD CONSTRAINT "coach_picks_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_picks" ADD CONSTRAINT "coach_picks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_requests" ADD CONSTRAINT "coach_requests_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_requests" ADD CONSTRAINT "coach_requests_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_tier_requests" ADD CONSTRAINT "coach_tier_requests_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_tier_requests" ADD CONSTRAINT "coach_tier_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_grants" ADD CONSTRAINT "discount_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_grants" ADD CONSTRAINT "discount_grants_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_profiles" ADD CONSTRAINT "gamification_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_discount_grant_id_discount_grants_id_fk" FOREIGN KEY ("discount_grant_id") REFERENCES "public"."discount_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_plan_workout_id_plan_workouts_id_fk" FOREIGN KEY ("plan_workout_id") REFERENCES "public"."plan_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_videos" ADD CONSTRAINT "plan_videos_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_videos" ADD CONSTRAINT "plan_videos_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_videos" ADD CONSTRAINT "plan_videos_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_workouts" ADD CONSTRAINT "plan_workouts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_suggestions" ADD CONSTRAINT "progression_suggestions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_suggestions" ADD CONSTRAINT "progression_suggestions_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_owner_coach_id_accounts_id_fk" FOREIGN KEY ("owner_coach_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_code_id_promo_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_accounts_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_id_accounts_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_shield_uses" ADD CONSTRAINT "rest_shield_uses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenuecat_events" ADD CONSTRAINT "revenuecat_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_thread_states" ADD CONSTRAINT "support_thread_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_thread_states" ADD CONSTRAINT "support_thread_states_assigned_to_accounts_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_thread_states" ADD CONSTRAINT "support_thread_states_resolved_by_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_sets" ADD CONSTRAINT "synced_sets_workout_id_synced_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."synced_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_sets" ADD CONSTRAINT "synced_sets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_workouts" ADD CONSTRAINT "synced_workouts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_prices" ADD CONSTRAINT "tier_prices_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_usage" ADD CONSTRAINT "trial_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_logs" ADD CONSTRAINT "water_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_flag_acks" ADD CONSTRAINT "workout_flag_acks_workout_id_synced_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."synced_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_flag_acks" ADD CONSTRAINT "workout_flag_acks_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_workout_id_plan_workouts_id_fk" FOREIGN KEY ("plan_workout_id") REFERENCES "public"."plan_workouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_permission_overrides_account" ON "admin_permission_overrides" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_created" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "awarded_badges_account_badge" ON "awarded_badges" USING btree ("account_id","badge_id");--> statement-breakpoint
CREATE INDEX "awarded_badges_status" ON "awarded_badges" USING btree ("status","earned_at");--> statement-breakpoint
CREATE INDEX "buddy_activity_account_created" ON "buddy_activity" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_links_requester_addressee" ON "buddy_links" USING btree ("requester_id","addressee_id");--> statement-breakpoint
CREATE INDEX "buddy_links_addressee" ON "buddy_links" USING btree ("addressee_id");--> statement-breakpoint
CREATE INDEX "buddy_messages_link_created" ON "buddy_messages" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_quest_awards_month_pair" ON "buddy_quest_awards" USING btree ("month_key","account_a","account_b");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_session_participants_session_account" ON "buddy_session_participants" USING btree ("session_id","account_id");--> statement-breakpoint
CREATE INDEX "buddy_sessions_host" ON "buddy_sessions" USING btree ("host_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_members_challenge_account" ON "challenge_members" USING btree ("challenge_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_account_date" ON "check_ins" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "check_ins_account_created" ON "check_ins" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_applications_account_created" ON "coach_applications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_applications_status" ON "coach_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_applications_one_pending" ON "coach_applications" USING btree ("account_id") WHERE "coach_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "coach_assigned_workouts_client_status" ON "coach_assigned_workouts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "coach_assigned_workouts_coach_client" ON "coach_assigned_workouts" USING btree ("coach_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_assignments_coach_user" ON "coach_assignments" USING btree ("coach_id","user_id");--> statement-breakpoint
CREATE INDEX "coach_assignments_user" ON "coach_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "coach_assignments_coach_status" ON "coach_assignments" USING btree ("coach_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_challenges_coach_month" ON "coach_challenges" USING btree ("coach_id","month_key");--> statement-breakpoint
CREATE INDEX "coach_diet_plans_client_status" ON "coach_diet_plans" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "coach_diet_plans_coach_client" ON "coach_diet_plans" USING btree ("coach_id","client_id");--> statement-breakpoint
CREATE INDEX "coach_messages_account_kind_created" ON "coach_messages" USING btree ("account_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "coach_milestones_account_achieved" ON "coach_milestones" USING btree ("account_id","achieved_at");--> statement-breakpoint
CREATE INDEX "coach_milestones_coach" ON "coach_milestones" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "coach_payout_requests_coach_status" ON "coach_payout_requests" USING btree ("coach_id","status");--> statement-breakpoint
CREATE INDEX "coach_payout_requests_status_requested" ON "coach_payout_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_payout_requests_one_pending" ON "coach_payout_requests" USING btree ("coach_id") WHERE "coach_payout_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "coach_picks_coach_month" ON "coach_picks" USING btree ("coach_id","month_key");--> statement-breakpoint
CREATE INDEX "coach_requests_user_created" ON "coach_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_requests_coach_status" ON "coach_requests" USING btree ("coach_id","status");--> statement-breakpoint
CREATE INDEX "coach_tier_requests_coach_status" ON "coach_tier_requests" USING btree ("coach_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_tier_requests_one_pending" ON "coach_tier_requests" USING btree ("coach_id") WHERE "coach_tier_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "device_push_tokens_token" ON "device_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_push_tokens_account" ON "device_push_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "discount_grants_account_status" ON "discount_grants" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_grants_one_active" ON "discount_grants" USING btree ("account_id") WHERE "discount_grants"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_account" ON "password_reset_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "payment_requests_status_created" ON "payment_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_receipt" ON "payment_requests" USING btree ("receipt_url");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_pending_account" ON "payment_requests" USING btree ("account_id") WHERE "payment_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_pending_grant" ON "payment_requests" USING btree ("discount_grant_id") WHERE "payment_requests"."status" = 'pending' and "payment_requests"."discount_grant_id" is not null;--> statement-breakpoint
CREATE INDEX "plan_videos_tier_status_position" ON "plan_videos" USING btree ("tier_required","status","position");--> statement-breakpoint
CREATE INDEX "plan_videos_exercise" ON "plan_videos" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "progress_photos_account_taken" ON "progress_photos" USING btree ("account_id","taken_on");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_suggestions_account_exercise_source" ON "progression_suggestions" USING btree ("account_id","exercise_id","source_workout_id");--> statement-breakpoint
CREATE INDEX "progression_suggestions_account_status" ON "progression_suggestions" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "promo_codes_owner_coach" ON "promo_codes" USING btree ("owner_coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_code_account" ON "promo_redemptions" USING btree ("code_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referrer_email" ON "referrals" USING btree ("referrer_id","invitee_email");--> statement-breakpoint
CREATE UNIQUE INDEX "rest_shield_uses_account_week" ON "rest_shield_uses" USING btree ("account_id","week_start");--> statement-breakpoint
CREATE INDEX "sessions_account" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "support_thread_states_status_updated" ON "support_thread_states" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "support_thread_states_assigned" ON "support_thread_states" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "synced_sets_account_exercise_logged" ON "synced_sets" USING btree ("account_id","exercise_id","logged_at");--> statement-breakpoint
CREATE INDEX "synced_sets_workout" ON "synced_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "synced_workouts_account_date" ON "synced_workouts" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "synced_workouts_ranked_date" ON "synced_workouts" USING btree ("ranked","date");--> statement-breakpoint
CREATE UNIQUE INDEX "tier_prices_region_tier" ON "tier_prices" USING btree ("region","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_usage_account_tier" ON "trial_usage" USING btree ("account_id","tier");--> statement-breakpoint
CREATE INDEX "wallet_ledger_coach_created" ON "wallet_ledger" USING btree ("coach_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_source" ON "wallet_ledger" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "water_logs_user_date" ON "water_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_logs_user_date" ON "weight_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_account_kind_source" ON "xp_events" USING btree ("account_id","kind","source_key");