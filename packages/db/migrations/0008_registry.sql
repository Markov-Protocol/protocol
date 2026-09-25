CREATE TABLE "registry_indexer_state" (
	"program_id" text PRIMARY KEY NOT NULL,
	"genesis_hash" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_observed_slot" bigint,
	"records_indexed" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_records" (
	"address" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"genesis_hash" text NOT NULL,
	"publisher" text NOT NULL,
	"status" text NOT NULL,
	"layout_version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"relation" text NOT NULL,
	"parent_manifest_hash" text,
	"manifest_hash" text NOT NULL,
	"content_digest" text NOT NULL,
	"cash_weight_bps" integer NOT NULL,
	"legs" jsonb NOT NULL,
	"registered_slot" bigint NOT NULL,
	"registered_unix_time" bigint NOT NULL,
	"status_updated_slot" bigint NOT NULL,
	"data" text NOT NULL,
	"version_id" uuid,
	"signature" text,
	"observed_slot" bigint NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_records_status_check" CHECK ("status" IN ('active', 'deprecated')),
	CONSTRAINT "registry_records_relation_check" CHECK ("relation" IN ('none', 'revision', 'fork'))
);
--> statement-breakpoint
CREATE TABLE "strategy_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"operation" text DEFAULT 'register' NOT NULL,
	"state" text DEFAULT 'awaiting_signature' NOT NULL,
	"program_id" text NOT NULL,
	"genesis_hash" text NOT NULL,
	"record_address" text NOT NULL,
	"publisher_wallet_id" uuid NOT NULL,
	"publisher_address" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"content_digest" text NOT NULL,
	"unsigned_transaction" text NOT NULL,
	"message" text NOT NULL,
	"recent_blockhash" text NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"estimated_cost_lamports" bigint NOT NULL,
	"signature" text,
	"submitted_at" timestamp with time zone,
	"confirmation_status" text,
	"evidence" jsonb,
	"failure" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_publications_state_check" CHECK ("state" IN ('validated', 'awaiting_signature', 'submitted', 'registered', 'failed', 'expired', 'unknown')),
	CONSTRAINT "strategy_publications_operation_check" CHECK ("operation" IN ('register', 'deprecate', 'reactivate'))
);
--> statement-breakpoint
ALTER TABLE "registry_records" ADD CONSTRAINT "registry_records_version_id_strategy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_publications" ADD CONSTRAINT "strategy_publications_version_id_strategy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_publications" ADD CONSTRAINT "strategy_publications_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_publications" ADD CONSTRAINT "strategy_publications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_publications" ADD CONSTRAINT "strategy_publications_publisher_wallet_id_wallet_links_id_fk" FOREIGN KEY ("publisher_wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_records_manifest_idx" ON "registry_records" USING btree ("program_id","manifest_hash");--> statement-breakpoint
CREATE INDEX "registry_records_publisher_idx" ON "registry_records" USING btree ("publisher");--> statement-breakpoint
CREATE INDEX "registry_records_version_idx" ON "registry_records" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "strategy_publications_version_idx" ON "strategy_publications" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE INDEX "strategy_publications_state_idx" ON "strategy_publications" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_publications_in_flight_unique" ON "strategy_publications" USING btree ("version_id","operation") WHERE "strategy_publications"."state" IN ('validated', 'awaiting_signature', 'submitted');