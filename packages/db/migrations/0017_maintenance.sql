CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" IN ('in_app', 'email')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('delivered', 'queued', 'failed', 'dead', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_address" text,
	"email_verified_at" timestamp with time zone,
	"email_pending_hash" text,
	"email_pending_salt" text,
	"email_pending_expires_at" timestamp with time zone,
	"email_pending_attempts" integer DEFAULT 0 NOT NULL,
	"categories" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_projection_cursor" (
	"id" text PRIMARY KEY NOT NULL,
	"last_event_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_type" text,
	"link_id" text,
	"source_event_seq" bigint,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_id_unique" UNIQUE("id"),
	CONSTRAINT "notifications_category_check" CHECK ("category" IN ('proposals', 'execution', 'schedules', 'data', 'security')),
	CONSTRAINT "notifications_link_type_check" CHECK ("link_type" IN ('proposal', 'intent', 'plan', 'schedule', 'occurrence', 'instance', 'device', 'run'))
);
--> statement-breakpoint
CREATE TABLE "schedule_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"detail" text,
	"proposal_id" uuid,
	"dedup_key" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"expiry_notified_at" timestamp with time zone,
	CONSTRAINT "schedule_occurrences_status_check" CHECK ("status" IN ('proposed', 'skipped', 'failed', 'expired')),
	CONSTRAINT "schedule_occurrences_reason_check" CHECK ("reason" IN ('missed_window', 'superseded_by_catch_up', 'schedule_not_active', 'no_drift', 'within_min_interval', 'open_proposal_exists', 'threshold_unset', 'policy_denied', 'target_unavailable', 'error'))
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mode" text DEFAULT 'prepare_for_approval' NOT NULL,
	"label" text NOT NULL,
	"cadence" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"wallet_id" uuid,
	"instance_id" uuid,
	"strategy_version_id" uuid,
	"instrument_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"review_window_hours" integer NOT NULL,
	"missed_run_policy" text DEFAULT 'skip' NOT NULL,
	"next_due_at" timestamp with time zone,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"last_proposal_at" timestamp with time zone,
	"proposed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status_reason" text,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_kind_check" CHECK ("kind" IN ('recurring_investment', 'drift_rebalance')),
	CONSTRAINT "schedules_status_check" CHECK ("status" IN ('active', 'paused', 'cancelled', 'revoked')),
	CONSTRAINT "schedules_mode_check" CHECK ("mode" IN ('prepare_for_approval')),
	CONSTRAINT "schedules_missed_check" CHECK ("missed_run_policy" IN ('skip', 'catch_up_latest'))
);
--> statement-breakpoint
ALTER TABLE "api_credentials" DROP CONSTRAINT "api_credentials_class_check";--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_proposal_id_agent_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."agent_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_instance_id_portfolio_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."portfolio_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_channel_unique" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_event_unique" ON "notifications" USING btree ("source_event_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_key_unique" ON "notifications" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "notifications_owner_seq_idx" ON "notifications" USING btree ("owner_user_id","seq");--> statement-breakpoint
CREATE INDEX "notifications_owner_unread_idx" ON "notifications" USING btree ("owner_user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrences_sequence_unique" ON "schedule_occurrences" USING btree ("schedule_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrences_dedup_unique" ON "schedule_occurrences" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_owner_idx" ON "schedule_occurrences" USING btree ("owner_user_id","decided_at");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_status_idx" ON "schedule_occurrences" USING btree ("status","window_ends_at");--> statement-breakpoint
CREATE INDEX "schedules_owner_idx" ON "schedules" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("status","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposals_dedup_key_unique" ON "agent_proposals" USING btree ("dedup_key");--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_class_check" CHECK ("principal_class" IN ('agent', 'operator', 'worker'));