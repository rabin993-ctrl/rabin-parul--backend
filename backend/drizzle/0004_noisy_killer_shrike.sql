ALTER TABLE "adoption_listings" ADD COLUMN "vaccination_status" text;--> statement-breakpoint
ALTER TABLE "adoption_listings" ADD COLUMN "neutered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "adoption_listings" ADD COLUMN "personality" text;--> statement-breakpoint
ALTER TABLE "adoption_listings" ADD COLUMN "requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "adoption_listings" ADD COLUMN "health_notes" text;