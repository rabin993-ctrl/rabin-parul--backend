CREATE TABLE "companion_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"related_companion_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"from_owner_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_treats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"giver_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companion_relationships" ADD CONSTRAINT "companion_relationships_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_relationships" ADD CONSTRAINT "companion_relationships_related_companion_id_companions_id_fk" FOREIGN KEY ("related_companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_relationships" ADD CONSTRAINT "companion_relationships_created_by_user_id_accounts_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_transfers" ADD CONSTRAINT "companion_transfers_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_transfers" ADD CONSTRAINT "companion_transfers_from_owner_user_id_accounts_id_fk" FOREIGN KEY ("from_owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_transfers" ADD CONSTRAINT "companion_transfers_to_user_id_accounts_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_treats" ADD CONSTRAINT "companion_treats_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_treats" ADD CONSTRAINT "companion_treats_giver_user_id_accounts_id_fk" FOREIGN KEY ("giver_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_relationships_pair_uidx" ON "companion_relationships" USING btree ("companion_id","related_companion_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_transfers_pending_uidx" ON "companion_transfers" USING btree ("companion_id") WHERE "companion_transfers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "companion_treats_companion_idx" ON "companion_treats" USING btree ("companion_id","created_at");--> statement-breakpoint
CREATE INDEX "companion_treats_giver_idx" ON "companion_treats" USING btree ("giver_user_id","created_at");