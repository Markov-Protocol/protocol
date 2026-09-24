CREATE TABLE "portfolio_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"pinned_version_id" uuid NOT NULL,
	"proposed_version_id" uuid,
	"wallet_id" uuid NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_instances_status_check" CHECK ("status" IN ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fork_of_strategy_id" uuid,
	"fork_of_version_id" uuid,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_status_check" CHECK ("status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "strategy_drafts" (
	"strategy_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"schema_version" text NOT NULL,
	"kind" text NOT NULL,
	"author_principal" text NOT NULL,
	"publisher_wallet" text,
	"parent_version_id" uuid,
	"fork_of_strategy_id" uuid,
	"fork_of_version_id" uuid,
	"title" text NOT NULL,
	"thesis" text NOT NULL,
	"thesis_id" uuid,
	"legs" jsonb NOT NULL,
	"cash_weight_bps" integer NOT NULL,
	"maintenance" jsonb NOT NULL,
	"disclosures" jsonb NOT NULL,
	"reference_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canonical_manifest" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"content_digest" text NOT NULL,
	"publication" text DEFAULT 'unpublished' NOT NULL,
	"moderation" text DEFAULT 'none' NOT NULL,
	"deprecated_by" uuid,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_versions_publication_check" CHECK ("publication" IN ('unpublished', 'validated', 'awaiting_signature', 'submitted', 'registered', 'failed', 'expired', 'unknown')),
	CONSTRAINT "strategy_versions_moderation_check" CHECK ("moderation" IN ('none', 'hidden')),
	CONSTRAINT "strategy_versions_cash_check" CHECK ("strategy_versions"."cash_weight_bps" >= 0 AND "strategy_versions"."cash_weight_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "portfolio_instances" ADD CONSTRAINT "portfolio_instances_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_instances" ADD CONSTRAINT "portfolio_instances_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_instances" ADD CONSTRAINT "portfolio_instances_pinned_version_id_strategy_versions_id_fk" FOREIGN KEY ("pinned_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_instances" ADD CONSTRAINT "portfolio_instances_proposed_version_id_strategy_versions_id_fk" FOREIGN KEY ("proposed_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_instances" ADD CONSTRAINT "portfolio_instances_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_fork_of_strategy_id_strategies_id_fk" FOREIGN KEY ("fork_of_strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_fork_of_version_id_strategy_versions_id_fk" FOREIGN KEY ("fork_of_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_current_version_id_strategy_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_drafts" ADD CONSTRAINT "strategy_drafts_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_parent_version_id_strategy_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_instances_owner_idx" ON "portfolio_instances" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "portfolio_instances_strategy_idx" ON "portfolio_instances" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "strategies_owner_idx" ON "strategies" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_number_unique" ON "strategy_versions" USING btree ("strategy_id","version_number");--> statement-breakpoint
CREATE INDEX "strategy_versions_hash_idx" ON "strategy_versions" USING btree ("manifest_hash");