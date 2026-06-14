CREATE TABLE "adoption_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poster_id" uuid NOT NULL,
	"animal_name" text NOT NULL,
	"species" text NOT NULL,
	"breed" text,
	"age_display" text,
	"gender_display" text,
	"description" text NOT NULL,
	"location_label" text,
	"status" text DEFAULT 'available' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"selected_request_id" uuid,
	"active_adoption_record_id" uuid,
	"adopted_at" timestamp with time zone,
	"adopted_note" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adoption_milestones" (
	"adoption_record_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"satisfied_by_update_id" uuid,
	"excused_by_update_id" uuid,
	CONSTRAINT "adoption_milestones_pk" PRIMARY KEY("adoption_record_id","milestone_id")
);
--> statement-breakpoint
CREATE TABLE "adoption_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"selected_request_id" uuid NOT NULL,
	"poster_id" uuid NOT NULL,
	"adopter_id" uuid NOT NULL,
	"animal_name" text NOT NULL,
	"species" text NOT NULL,
	"breed" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"chat_thread_id" uuid,
	"companion_id" uuid
);
--> statement-breakpoint
CREATE TABLE "adoption_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"poster_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"thread_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"adopted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "adoption_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adoption_record_id" uuid NOT NULL,
	"type" text NOT NULL,
	"author_id" uuid NOT NULL,
	"milestone_id" text,
	"text" text,
	"recommendation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circle_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circle_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"muted_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "circle_message_pins" (
	"circle_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by_user_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "circle_message_pins_pk" PRIMARY KEY("circle_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "circle_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"source_post_id" uuid,
	"reply_to_message_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"client_idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"about" text NOT NULL,
	"icon_asset_id" uuid,
	"cover_asset_id" uuid,
	"tint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "community_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"role" text,
	"request_message" text,
	"invited_by" uuid,
	"resolved_by" uuid,
	"resolution_reason" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_settings" (
	"community_id" uuid PRIMARY KEY NOT NULL,
	"join_policy" text DEFAULT 'open' NOT NULL,
	"members_only" boolean DEFAULT false NOT NULL,
	"discoverable" boolean DEFAULT true NOT NULL,
	"show_location" boolean DEFAULT false NOT NULL,
	"allow_links" boolean DEFAULT true NOT NULL,
	"post_approval_required" boolean DEFAULT false NOT NULL,
	"require_photo_lost_found" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"request_state" text DEFAULT 'accepted' NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"muted_until" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"domain_type" text,
	"domain_id" uuid,
	"state" text DEFAULT 'active' NOT NULL,
	"last_message_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_conversation_pairs" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"lower_user_id" uuid NOT NULL,
	"higher_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_found_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reporter_role" text DEFAULT 'reporter' NOT NULL,
	"subject_companion_id" uuid,
	"temporary_subject_id" uuid,
	"canonical_post_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"alert_radius_km" integer DEFAULT 10 NOT NULL,
	"contact_mode" text DEFAULT 'message' NOT NULL,
	"public_contact_encrypted" text,
	"resolution_outcome" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_found_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"found_alert_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"reviewer_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_found_locations" (
	"alert_id" uuid PRIMARY KEY NOT NULL,
	"location_label" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"geohash" text,
	"public_precision" text DEFAULT 'area' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"visibility" text DEFAULT 'public_area' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_found_sightings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location_label" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"public_precision" text DEFAULT 'area' NOT NULL,
	"still_present" boolean,
	"note" text,
	"moderation_status" "moderation_status" DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_found_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"species" text NOT NULL,
	"breed_description" text,
	"age_description" text,
	"sex_description" text,
	"appearance" text NOT NULL,
	"collar_description" text,
	"temperament" text,
	"secured" boolean,
	"public_notes" text,
	"private_verification_notes" text
);
--> statement-breakpoint
CREATE TABLE "lost_found_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"attachment_type" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_attachments_pk" PRIMARY KEY("message_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"reply_to_message_id" uuid,
	"client_idempotency_key" text,
	"state" text DEFAULT 'active' NOT NULL,
	"moderation_state" text DEFAULT 'approved' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"actor_user_id" uuid,
	"target_type" text,
	"target_id" text,
	"deduplication_key" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paw_circles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"bio" text,
	"location_label" text,
	"privacy" text DEFAULT 'open' NOT NULL,
	"visibility" text DEFAULT 'discoverable' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"icon_asset_id" uuid,
	"theme_tint" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_assets" (
	"post_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"alt_text" text,
	CONSTRAINT "post_assets_pk" PRIMARY KEY("post_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_companions" (
	"post_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"position" integer NOT NULL,
	"display_name_snapshot" text NOT NULL,
	"avatar_asset_id_snapshot" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_companions_pk" PRIMARY KEY("post_id","companion_id","relationship_type")
);
--> statement-breakpoint
CREATE TABLE "post_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"destination_type" text NOT NULL,
	"destination_id" uuid,
	"visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" text DEFAULT 'pawprint' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reactions_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_saves" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_saves_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"presentation_mode" text DEFAULT 'user' NOT NULL,
	"author_companion_id" uuid,
	"body" text,
	"category" text,
	"visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rescue_case_followers" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_mode" text DEFAULT 'all_updates' NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unfollowed_at" timestamp with time zone,
	CONSTRAINT "rescue_case_followers_pk" PRIMARY KEY("case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rescue_case_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"text" text,
	"status_before" text,
	"status_after" text,
	"resolution_outcome" text,
	"client_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rescue_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_case_number" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"animal_name" text NOT NULL,
	"species" text NOT NULL,
	"headline" text NOT NULL,
	"original_story" text NOT NULL,
	"status" text DEFAULT 'needs_help' NOT NULL,
	"resolution_outcome" text,
	"resolution_note" text,
	"public_location_label" text,
	"private_latitude" double precision,
	"private_longitude" double precision,
	"location_precision" text DEFAULT 'area' NOT NULL,
	"visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'approved' NOT NULL,
	"linked_announcement_post_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rescue_help_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"availability" text,
	"private_contact_method" text,
	"status" text DEFAULT 'offered' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_lost_found_alerts" (
	"user_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_lost_found_alerts_pk" PRIMARY KEY("user_id","alert_id")
);
--> statement-breakpoint
ALTER TABLE "adoption_listings" ADD CONSTRAINT "adoption_listings_poster_id_accounts_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_milestones" ADD CONSTRAINT "adoption_milestones_adoption_record_id_adoption_records_id_fk" FOREIGN KEY ("adoption_record_id") REFERENCES "public"."adoption_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_listing_id_adoption_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."adoption_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_selected_request_id_adoption_requests_id_fk" FOREIGN KEY ("selected_request_id") REFERENCES "public"."adoption_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_poster_id_accounts_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_adopter_id_accounts_id_fk" FOREIGN KEY ("adopter_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_chat_thread_id_conversations_id_fk" FOREIGN KEY ("chat_thread_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_records" ADD CONSTRAINT "adoption_records_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_requests" ADD CONSTRAINT "adoption_requests_listing_id_adoption_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."adoption_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_requests" ADD CONSTRAINT "adoption_requests_poster_id_accounts_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_requests" ADD CONSTRAINT "adoption_requests_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_requests" ADD CONSTRAINT "adoption_requests_thread_id_conversations_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_updates" ADD CONSTRAINT "adoption_updates_adoption_record_id_adoption_records_id_fk" FOREIGN KEY ("adoption_record_id") REFERENCES "public"."adoption_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_updates" ADD CONSTRAINT "adoption_updates_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_join_requests" ADD CONSTRAINT "circle_join_requests_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_join_requests" ADD CONSTRAINT "circle_join_requests_requester_user_id_accounts_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_join_requests" ADD CONSTRAINT "circle_join_requests_reviewed_by_user_id_accounts_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_memberships" ADD CONSTRAINT "circle_memberships_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_memberships" ADD CONSTRAINT "circle_memberships_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_message_pins" ADD CONSTRAINT "circle_message_pins_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_message_pins" ADD CONSTRAINT "circle_message_pins_message_id_circle_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."circle_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_message_pins" ADD CONSTRAINT "circle_message_pins_pinned_by_user_id_accounts_id_fk" FOREIGN KEY ("pinned_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_circle_id_paw_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."paw_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_sender_user_id_accounts_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_source_post_id_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_user_id_accounts_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_icon_asset_id_media_assets_id_fk" FOREIGN KEY ("icon_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_resolved_by_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_rules" ADD CONSTRAINT "community_rules_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_settings" ADD CONSTRAINT "community_settings_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_settings" ADD CONSTRAINT "community_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_accounts_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversation_pairs" ADD CONSTRAINT "direct_conversation_pairs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversation_pairs" ADD CONSTRAINT "direct_conversation_pairs_lower_user_id_accounts_id_fk" FOREIGN KEY ("lower_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversation_pairs" ADD CONSTRAINT "direct_conversation_pairs_higher_user_id_accounts_id_fk" FOREIGN KEY ("higher_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_alerts" ADD CONSTRAINT "lost_found_alerts_reporter_user_id_accounts_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_alerts" ADD CONSTRAINT "lost_found_alerts_subject_companion_id_companions_id_fk" FOREIGN KEY ("subject_companion_id") REFERENCES "public"."companions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_alerts" ADD CONSTRAINT "lost_found_alerts_temporary_subject_id_lost_found_subjects_id_fk" FOREIGN KEY ("temporary_subject_id") REFERENCES "public"."lost_found_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_alerts" ADD CONSTRAINT "lost_found_alerts_canonical_post_id_posts_id_fk" FOREIGN KEY ("canonical_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_alerts" ADD CONSTRAINT "lost_found_alerts_resolved_by_user_id_accounts_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_found_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("found_alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_claimant_user_id_accounts_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_reviewer_user_id_accounts_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_locations" ADD CONSTRAINT "lost_found_locations_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_sightings" ADD CONSTRAINT "lost_found_sightings_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_sightings" ADD CONSTRAINT "lost_found_sightings_reporter_user_id_accounts_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_updates" ADD CONSTRAINT "lost_found_updates_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_updates" ADD CONSTRAINT "lost_found_updates_author_user_id_accounts_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_accounts_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_accounts_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paw_circles" ADD CONSTRAINT "paw_circles_owner_user_id_accounts_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paw_circles" ADD CONSTRAINT "paw_circles_icon_asset_id_media_assets_id_fk" FOREIGN KEY ("icon_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_assets" ADD CONSTRAINT "post_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_assets" ADD CONSTRAINT "post_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_user_id_accounts_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_companions" ADD CONSTRAINT "post_companions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_companions" ADD CONSTRAINT "post_companions_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_placements" ADD CONSTRAINT "post_placements_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_actor_user_id_accounts_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_user_id_accounts_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_companion_id_companions_id_fk" FOREIGN KEY ("author_companion_id") REFERENCES "public"."companions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_case_followers" ADD CONSTRAINT "rescue_case_followers_case_id_rescue_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."rescue_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_case_followers" ADD CONSTRAINT "rescue_case_followers_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_case_updates" ADD CONSTRAINT "rescue_case_updates_case_id_rescue_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."rescue_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_case_updates" ADD CONSTRAINT "rescue_case_updates_author_user_id_accounts_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_cases" ADD CONSTRAINT "rescue_cases_owner_user_id_accounts_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_cases" ADD CONSTRAINT "rescue_cases_linked_announcement_post_id_posts_id_fk" FOREIGN KEY ("linked_announcement_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_help_offers" ADD CONSTRAINT "rescue_help_offers_case_id_rescue_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."rescue_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_help_offers" ADD CONSTRAINT "rescue_help_offers_helper_user_id_accounts_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_help_offers" ADD CONSTRAINT "rescue_help_offers_reviewed_by_user_id_accounts_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_help_offers" ADD CONSTRAINT "rescue_help_offers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lost_found_alerts" ADD CONSTRAINT "saved_lost_found_alerts_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lost_found_alerts" ADD CONSTRAINT "saved_lost_found_alerts_alert_id_lost_found_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."lost_found_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adoption_listings_status_idx" ON "adoption_listings" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "adoption_listings_poster_idx" ON "adoption_listings" USING btree ("poster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_records_listing_active_uidx" ON "adoption_records" USING btree ("listing_id") WHERE "adoption_records"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_requests_listing_user_uidx" ON "adoption_requests" USING btree ("listing_id","requester_id");--> statement-breakpoint
CREATE INDEX "adoption_updates_record_idx" ON "adoption_updates" USING btree ("adoption_record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_join_requests_user_uidx" ON "circle_join_requests" USING btree ("circle_id","requester_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_memberships_user_uidx" ON "circle_memberships" USING btree ("circle_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_messages_client_uidx" ON "circle_messages" USING btree ("circle_id","sender_user_id","client_idempotency_key") WHERE "circle_messages"."client_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "circle_messages_circle_created_idx" ON "circle_messages" USING btree ("circle_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "communities_slug_uidx" ON "communities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "communities_status_idx" ON "communities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "community_memberships_user_uidx" ON "community_memberships" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "community_memberships_state_idx" ON "community_memberships" USING btree ("community_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "community_rules_position_uidx" ON "community_rules" USING btree ("community_id","position");--> statement-breakpoint
CREATE INDEX "conversation_participants_inbox_idx" ON "conversation_participants" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "conversations_type_activity_idx" ON "conversations" USING btree ("type","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_conversation_pairs_uidx" ON "direct_conversation_pairs" USING btree ("lower_user_id","higher_user_id");--> statement-breakpoint
CREATE INDEX "lost_found_alerts_kind_status_idx" ON "lost_found_alerts" USING btree ("kind","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lost_found_claims_alert_user_uidx" ON "lost_found_claims" USING btree ("found_alert_id","claimant_user_id");--> statement-breakpoint
CREATE INDEX "lost_found_sightings_alert_idx" ON "lost_found_sightings" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE INDEX "lost_found_updates_alert_idx" ON "lost_found_updates" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_key_uidx" ON "messages" USING btree ("conversation_id","sender_user_id","client_idempotency_key") WHERE "messages"."client_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedup_uidx" ON "notifications" USING btree ("user_id","deduplication_key") WHERE "notifications"."deduplication_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paw_circles_slug_uidx" ON "paw_circles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "post_assets_position_uidx" ON "post_assets" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "post_comments_post_created_idx" ON "post_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_companions_position_uidx" ON "post_companions" USING btree ("post_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "post_placements_destination_uidx" ON "post_placements" USING btree ("post_id","destination_type","destination_id");--> statement-breakpoint
CREATE INDEX "post_placements_feed_idx" ON "post_placements" USING btree ("destination_type","destination_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_user_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_status_created_idx" ON "posts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rescue_updates_client_uidx" ON "rescue_case_updates" USING btree ("case_id","author_user_id","client_idempotency_key") WHERE "rescue_case_updates"."client_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "rescue_cases_number_uidx" ON "rescue_cases" USING btree ("public_case_number");--> statement-breakpoint
CREATE INDEX "rescue_cases_status_idx" ON "rescue_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rescue_help_offers_active_uidx" ON "rescue_help_offers" USING btree ("case_id","helper_user_id","type");