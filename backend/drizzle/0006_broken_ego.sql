CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"execute_after" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profile_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" text,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reviews" ADD CONSTRAINT "profile_reviews_reviewer_user_id_accounts_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reviews" ADD CONSTRAINT "profile_reviews_subject_user_id_accounts_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_active_uidx" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_reviews_reviewer_subject_uidx" ON "profile_reviews" USING btree ("reviewer_user_id","subject_user_id");--> statement-breakpoint
CREATE INDEX "profile_reviews_subject_idx" ON "profile_reviews" USING btree ("subject_user_id","created_at");