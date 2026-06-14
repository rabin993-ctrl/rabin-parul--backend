CREATE TABLE "lost_found_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lost_alert_id" uuid NOT NULL,
	"found_alert_id" uuid NOT NULL,
	"score" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lost_found_matches" ADD CONSTRAINT "lost_found_matches_lost_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("lost_alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_matches" ADD CONSTRAINT "lost_found_matches_found_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("found_alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_matches" ADD CONSTRAINT "lost_found_matches_reviewed_by_user_id_accounts_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lost_found_matches_pair_uidx" ON "lost_found_matches" USING btree ("lost_alert_id","found_alert_id");--> statement-breakpoint
CREATE INDEX "lost_found_matches_status_idx" ON "lost_found_matches" USING btree ("status","created_at");