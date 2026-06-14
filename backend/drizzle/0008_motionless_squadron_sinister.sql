CREATE TABLE "circle_bans" (
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by_user_id" uuid NOT NULL,
	"reason" text,
	"banned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "circle_bans_pk" PRIMARY KEY("circle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "circle_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"invited_user_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circle_ownership_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paw_circle_user_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notification_level" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "circle_bans" ADD CONSTRAINT "circle_bans_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_bans" ADD CONSTRAINT "circle_bans_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_bans" ADD CONSTRAINT "circle_bans_banned_by_user_id_accounts_id_fk" FOREIGN KEY ("banned_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_invitations" ADD CONSTRAINT "circle_invitations_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_invitations" ADD CONSTRAINT "circle_invitations_invited_user_id_accounts_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_invitations" ADD CONSTRAINT "circle_invitations_invited_by_user_id_accounts_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_ownership_transfers" ADD CONSTRAINT "circle_ownership_transfers_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_ownership_transfers" ADD CONSTRAINT "circle_ownership_transfers_from_user_id_accounts_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_ownership_transfers" ADD CONSTRAINT "circle_ownership_transfers_to_user_id_accounts_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_user_id_accounts_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_resolved_by_user_id_accounts_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paw_circle_user_states" ADD CONSTRAINT "paw_circle_user_states_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "circle_invitations_user_uidx" ON "circle_invitations" USING btree ("circle_id","invited_user_id");--> statement-breakpoint
CREATE INDEX "circle_invitations_recipient_idx" ON "circle_invitations" USING btree ("invited_user_id","status");--> statement-breakpoint
CREATE INDEX "circle_ownership_transfers_circle_idx" ON "circle_ownership_transfers" USING btree ("circle_id","status");--> statement-breakpoint
CREATE INDEX "circle_ownership_transfers_recipient_idx" ON "circle_ownership_transfers" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "community_reports_community_status_idx" ON "community_reports" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "community_reports_target_idx" ON "community_reports" USING btree ("target_type","target_id");