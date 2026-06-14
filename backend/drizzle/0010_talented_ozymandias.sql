ALTER TABLE "companion_treats" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "companion_treats" SET "idempotency_key" = 'legacy-' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "companion_treats" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_privacy_settings" ADD COLUMN "show_treats_on_profile" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_treats_giver_idempotency_uidx" ON "companion_treats" USING btree ("giver_user_id","idempotency_key");
