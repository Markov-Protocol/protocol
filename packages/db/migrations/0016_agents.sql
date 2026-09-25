CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"run_id" uuid,
	"created_by" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"review_note" text NOT NULL,
	"intent_id" uuid,
	"opened_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposals_kind_check" CHECK ("kind" IN ('strategy_draft', 'investment', 'rebalance')),
	CONSTRAINT "agent_proposals_status_check" CHECK ("status" IN ('proposed', 'opened', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "companion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"principal" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"question" text NOT NULL,
	"context" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"usage" jsonb,
	"provenance" jsonb,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "companion_runs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "mark_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_events_kind_check" CHECK ("kind" IN ('proposal.created', 'review.required', 'execution.pending', 'execution.finalized', 'execution.failed', 'data.stale', 'device.revoked')),
	CONSTRAINT "mark_events_subject_check" CHECK ("subject_type" IN ('proposal', 'intent', 'plan', 'device', 'instrument', 'instance', 'run'))
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_companion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."companion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_runs" ADD CONSTRAINT "companion_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_events" ADD CONSTRAINT "mark_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_proposals_owner_idx" ON "agent_proposals" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_owner_status_idx" ON "agent_proposals" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "companion_runs_owner_idx" ON "companion_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mark_events_id_unique" ON "mark_events" USING btree ("id");--> statement-breakpoint
CREATE INDEX "mark_events_owner_seq_idx" ON "mark_events" USING btree ("owner_user_id","seq");