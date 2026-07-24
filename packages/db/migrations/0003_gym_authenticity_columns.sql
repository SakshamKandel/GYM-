-- Backend-authored gym enrichment. The mobile client must never invent these
-- values when an operator has not supplied them.
ALTER TABLE "gyms" ADD COLUMN IF NOT EXISTS "equipment" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN IF NOT EXISTS "crowd_data" jsonb;
--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN IF NOT EXISTS "pass_options" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN IF NOT EXISTS "coach_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

-- NOT VALID preserves any legacy rows for application-level sanitization while
-- still preventing new writes with the wrong top-level JSON shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gyms_equipment_is_array' AND conrelid = 'gyms'::regclass
  ) THEN
    ALTER TABLE "gyms"
      ADD CONSTRAINT "gyms_equipment_is_array"
      CHECK (jsonb_typeof("equipment") = 'array') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gyms_crowd_data_is_object' AND conrelid = 'gyms'::regclass
  ) THEN
    ALTER TABLE "gyms"
      ADD CONSTRAINT "gyms_crowd_data_is_object"
      CHECK ("crowd_data" IS NULL OR jsonb_typeof("crowd_data") = 'object') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gyms_pass_options_is_array' AND conrelid = 'gyms'::regclass
  ) THEN
    ALTER TABLE "gyms"
      ADD CONSTRAINT "gyms_pass_options_is_array"
      CHECK (jsonb_typeof("pass_options") = 'array') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gyms_coach_ids_is_array' AND conrelid = 'gyms'::regclass
  ) THEN
    ALTER TABLE "gyms"
      ADD CONSTRAINT "gyms_coach_ids_is_array"
      CHECK (jsonb_typeof("coach_ids") = 'array') NOT VALID;
  END IF;
END $$;
