CREATE TYPE "public"."account_status" AS ENUM('active', 'deactivated', 'deletion_pending', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."companion_manager_role" AS ENUM('owner', 'co_owner', 'caregiver', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."companion_source" AS ENUM('manual', 'adoption', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."companion_status" AS ENUM('active', 'archived', 'transferred', 'memorialized');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'uploading', 'uploaded', 'processing', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'file');--> statement-breakpoint
CREATE TYPE "public"."message_policy" AS ENUM('everyone', 'circles', 'none');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('username_required', 'complete');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('everyone', 'circles', 'only_me');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"onboarding_status" "onboarding_status" DEFAULT 'username_required' NOT NULL,
	"contact_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_care_profiles" (
	"companion_id" uuid PRIMARY KEY NOT NULL,
	"date_of_birth" timestamp with time zone,
	"breed_private" text,
	"sex" text,
	"vaccination_status" text,
	"neuter_status" text,
	"microchip_status" text,
	"microchip_identifier_encrypted" text,
	"allergies" text,
	"medical_notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_followers" (
	"companion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_followers_pk" PRIMARY KEY("companion_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "companion_managers" (
	"companion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "companion_manager_role" NOT NULL,
	"can_edit_profile" boolean DEFAULT false NOT NULL,
	"can_manage_avatar" boolean DEFAULT false NOT NULL,
	"can_attach_to_posts" boolean DEFAULT false NOT NULL,
	"can_post_as_companion" boolean DEFAULT false NOT NULL,
	"can_view_care_record" boolean DEFAULT false NOT NULL,
	"can_use_vet_services" boolean DEFAULT false NOT NULL,
	"can_manage_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "companion_managers_pk" PRIMARY KEY("companion_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "companions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_owner_user_id" uuid NOT NULL,
	"public_handle" text,
	"normalized_public_handle" text,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"breed_public" text,
	"age_display" text,
	"gender_display" text,
	"about" text,
	"mood" text,
	"avatar_asset_id" uuid,
	"profile_visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"status" "companion_status" DEFAULT 'active' NOT NULL,
	"source_type" "companion_source" DEFAULT 'manual' NOT NULL,
	"source_adoption_record_id" uuid,
	"verified_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"media_type" "media_type" NOT NULL,
	"storage_key" text,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"checksum" text,
	"thumbnail_storage_key" text,
	"moderation_status" "moderation_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"messages" boolean DEFAULT true NOT NULL,
	"communities" boolean DEFAULT true NOT NULL,
	"paw_circles" boolean DEFAULT true NOT NULL,
	"adoption_updates" boolean DEFAULT true NOT NULL,
	"rescue_updates" boolean DEFAULT true NOT NULL,
	"lost_found_nearby" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "profile_handle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"old_normalized_handle" text,
	"new_normalized_handle" text NOT NULL,
	"change_type" text NOT NULL,
	"protected_until" timestamp with time zone,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_user_id" uuid NOT NULL,
	"blocked_user_id" uuid NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "user_blocks_pk" PRIMARY KEY("blocker_user_id","blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_privacy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"profile_visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"discoverable" boolean DEFAULT true NOT NULL,
	"show_online" boolean DEFAULT true NOT NULL,
	"default_post_visibility" "visibility" DEFAULT 'everyone' NOT NULL,
	"show_location" boolean DEFAULT true NOT NULL,
	"show_companions" boolean DEFAULT true NOT NULL,
	"message_policy" "message_policy" DEFAULT 'everyone' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"normalized_handle" text,
	"handle_set_at" timestamp with time zone,
	"bio" text,
	"avatar_media_id" uuid,
	"public_location_label" text,
	"location_area_id" uuid,
	"website_url" text,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_name" text,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_accounts_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_care_profiles" ADD CONSTRAINT "companion_care_profiles_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_followers" ADD CONSTRAINT "companion_followers_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_followers" ADD CONSTRAINT "companion_followers_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_managers" ADD CONSTRAINT "companion_managers_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_managers" ADD CONSTRAINT "companion_managers_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_primary_owner_user_id_accounts_id_fk" FOREIGN KEY ("primary_owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_accounts_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_handle_history" ADD CONSTRAINT "profile_handle_history_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_accounts_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_accounts_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatar_media_id_media_assets_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_normalized_email_uidx" ON "accounts" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "companion_managers_user_idx" ON "companion_managers" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companions_normalized_handle_uidx" ON "companions" USING btree ("normalized_public_handle") WHERE "companions"."normalized_public_handle" is not null;--> statement-breakpoint
CREATE INDEX "companions_owner_status_idx" ON "companions" USING btree ("primary_owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_uidx" ON "idempotency_keys" USING btree ("user_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "media_assets_owner_status_idx" ON "media_assets" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE INDEX "profile_handle_history_user_idx" ON "profile_handle_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_normalized_handle_uidx" ON "user_profiles" USING btree ("normalized_handle") WHERE "user_profiles"."normalized_handle" is not null;--> statement-breakpoint
CREATE INDEX "user_profiles_display_name_idx" ON "user_profiles" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "user_sessions_user_active_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");