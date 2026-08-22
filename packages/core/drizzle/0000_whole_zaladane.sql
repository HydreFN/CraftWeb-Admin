CREATE TYPE "public"."changed_by" AS ENUM('systeme', 'ia', 'humain');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('email_generique', 'email_service', 'email_nominatif');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('sortant', 'entrant');--> statement-breakpoint
CREATE TYPE "public"."discovery_source" AS ENUM('places', 'youtube', 'cse_instagram', 'cse_tiktok', 'cse_facebook', 'osm', 'manuel');--> statement-breakpoint
CREATE TYPE "public"."dm_queue_status" AS ENUM('a_envoyer', 'envoye', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."exclusion_reason" AS ENUM('desinscription', 'refus_reponse', 'bounce_hard', 'manuel');--> statement-breakpoint
CREATE TYPE "public"."exclusion_scope" AS ENUM('email', 'domaine');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'instagram', 'tiktok', 'facebook', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('brouillon', 'en_attente_revue', 'planifie', 'envoi_en_cours', 'envoye', 'echec', 'recu');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'tiktok', 'facebook', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('NOUVEAU', 'EN_ATTENTE', 'INTERESSE', 'DEMANDE_DE_PRIX', 'PAS_INTERESSE', 'A_RELANCER', 'QUESTION', 'A_VERIFIER', 'EMAIL_INVALIDE', 'EXCLU');--> statement-breakpoint
CREATE TYPE "public"."social_source" AS ENUM('site_web', 'cse', 'youtube_api');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_locale" text NOT NULL,
	"key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"scope" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"label" text NOT NULL,
	"confidence" real NOT NULL,
	"model" text NOT NULL,
	"raw_json" jsonb,
	"human_validated" boolean DEFAULT false NOT NULL,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"type" "contact_type" NOT NULL,
	"value" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"mx_valid" boolean,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date_locale" text NOT NULL,
	"key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"max" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "exclusion_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value" text NOT NULL,
	"scope" "exclusion_scope" NOT NULL,
	"reason" "exclusion_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_dm_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"message_text" text NOT NULL,
	"status" "dm_queue_status" DEFAULT 'a_envoyer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" text,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text,
	"smtp_message_id" text,
	"in_reply_to" text,
	"sequence_step" integer DEFAULT 0 NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_model" text,
	"status" "message_status" DEFAULT 'brouillon' NOT NULL,
	"is_auto_reply" boolean DEFAULT false NOT NULL,
	"is_bounce" boolean DEFAULT false NOT NULL,
	"from_address" text,
	"to_address" text,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"niche" text,
	"location_city" text,
	"location_country" text,
	"website_url" text,
	"website_domain" text,
	"phone" text,
	"siret" text,
	"description" text,
	"discovery_source" "discovery_source" DEFAULT 'manuel' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_contacted_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"status" "prospect_status" DEFAULT 'NOUVEAU' NOT NULL,
	"ai_confidence" real,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"username" text,
	"profile_url" text NOT NULL,
	"followers_count" integer,
	"bio_snippet" text,
	"source" "social_source" NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"old_status" "prospect_status",
	"new_status" "prospect_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" "changed_by" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_dm_queue" ADD CONSTRAINT "manual_dm_queue_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_month_key_uq" ON "api_usage" USING btree ("month_locale","key");--> statement-breakpoint
CREATE INDEX "app_logs_scope_idx" ON "app_logs" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "app_logs_created_idx" ON "app_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "classifications_message_idx" ON "classifications" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_prospect_value_uq" ON "contact_channels" USING btree ("prospect_id","value");--> statement-breakpoint
CREATE INDEX "contact_channels_value_idx" ON "contact_channels" USING btree ("value");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_quotas_date_key_uq" ON "daily_quotas" USING btree ("date_locale","key");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "exclusion_value_scope_uq" ON "exclusion_list" USING btree ("value","scope");--> statement-breakpoint
CREATE INDEX "manual_dm_queue_status_idx" ON "manual_dm_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_prospect_idx" ON "messages" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_smtp_id_idx" ON "messages" USING btree ("smtp_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_active_outbound_uq" ON "messages" USING btree ("prospect_id") WHERE "messages"."direction" = 'sortant' AND "messages"."status" IN ('en_attente_revue', 'planifie', 'envoi_en_cours');--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_website_domain_uq" ON "prospects" USING btree ("website_domain") WHERE "prospects"."website_domain" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prospects_phone_idx" ON "prospects" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "prospects_status_idx" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prospects_company_city_idx" ON "prospects" USING btree ("company_name","location_city");--> statement-breakpoint
CREATE UNIQUE INDEX "social_profiles_platform_url_uq" ON "social_profiles" USING btree ("platform","profile_url");--> statement-breakpoint
CREATE INDEX "status_history_prospect_idx" ON "status_history" USING btree ("prospect_id");