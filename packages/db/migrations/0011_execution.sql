CREATE TABLE "execution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"transaction_index" integer NOT NULL,
	"signature" text NOT NULL,
	"signed_transaction" text NOT NULL,
	"message_hash" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"reservation_id" uuid,
	"last_valid_block_height" bigint NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"confirmation_status" text,
	"slot" bigint,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"chain_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_attempts_state_check" CHECK ("state" IN ('prepared', 'submitting', 'submitted', 'confirmed', 'finalized', 'failed', 'expired', 'unknown', 'superseded', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "execution_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"leg_index" integer NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"side" text NOT NULL,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"input_spent_raw" text NOT NULL,
	"output_received_raw" text NOT NULL,
	"fee_lamports" text NOT NULL,
	"lamports_spent" text NOT NULL,
	"within_bounds" boolean NOT NULL,
	"source" text DEFAULT 'transaction_meta' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_fills_side_check" CHECK ("side" IN ('buy', 'sell'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_events_kind_check" CHECK ("kind" IN ('execution.pending', 'execution.submitted', 'execution.confirmed', 'execution.finalized', 'execution.failed', 'execution.expired', 'execution.unknown', 'execution.cancelled'))
);
--> statement-breakpoint
CREATE TABLE "prepared_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"transaction_index" integer NOT NULL,
	"batch" integer NOT NULL,
	"leg_indexes" jsonb NOT NULL,
	"version" text NOT NULL,
	"message_hash" text NOT NULL,
	"unsigned_transaction" text NOT NULL,
	"fee_payer" text NOT NULL,
	"expected_signer" text NOT NULL,
	"recent_blockhash" text NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"build_source" text NOT NULL,
	"instructions" jsonb NOT NULL,
	"effects" jsonb NOT NULL,
	"simulation" jsonb NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_transactions_state_check" CHECK ("state" IN ('prepared', 'submitting', 'submitted', 'confirmed', 'finalized', 'failed', 'expired', 'unknown', 'superseded', 'cancelled')),
	CONSTRAINT "prepared_transactions_version_check" CHECK ("version" IN ('legacy', 'v0'))
);
--> statement-breakpoint
ALTER TABLE "intents" DROP CONSTRAINT "intents_kind_check";--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_transaction_id_prepared_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."prepared_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_plan_id_execution_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_plan_id_execution_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_attempt_id_execution_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_transactions" ADD CONSTRAINT "prepared_transactions_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_transactions" ADD CONSTRAINT "prepared_transactions_plan_id_execution_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_transactions" ADD CONSTRAINT "prepared_transactions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempts_signature_unique" ON "execution_attempts" USING btree ("signature");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempts_live_unique" ON "execution_attempts" USING btree ("intent_id") WHERE "state" IN ('submitting', 'submitted', 'confirmed', 'unknown');--> statement-breakpoint
CREATE INDEX "execution_attempts_intent_idx" ON "execution_attempts" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "execution_attempts_state_idx" ON "execution_attempts" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_fills_signature_leg_unique" ON "execution_fills" USING btree ("signature","leg_index");--> statement-breakpoint
CREATE INDEX "execution_fills_intent_idx" ON "execution_fills" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "prepared_transactions_intent_idx" ON "prepared_transactions" USING btree ("intent_id","transaction_index","created_at");--> statement-breakpoint
CREATE INDEX "prepared_transactions_hash_idx" ON "prepared_transactions" USING btree ("message_hash");--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_kind_check" CHECK ("kind" IN ('basket_investment', 'single_buy', 'single_sell'));