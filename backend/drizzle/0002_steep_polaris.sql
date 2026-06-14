CREATE TABLE "domain_media" (
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "domain_media_pk" PRIMARY KEY("target_type","target_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "domain_media" ADD CONSTRAINT "domain_media_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_media_position_uidx" ON "domain_media" USING btree ("target_type","target_id","position");