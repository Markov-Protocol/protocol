CREATE TABLE "execution_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"plan" jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_hash" text,
	"staged_acknowledged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "execution_plans_status_check" CHECK ("status" IN ('valid', 'expired', 'superseded')),
	CONSTRAINT "execution_plans_mode_check" CHECK ("mode" IN ('fixture', 'live'))
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"state_reason" text,
	"wallet_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"strategy_id" uuid,
	"version_id" uuid,
	"instrument_id" uuid,
	"budget_mint" text NOT NULL,
	"budget_symbol" text NOT NULL,
	"budget_decimals" integer NOT NULL,
	"budget_raw" text NOT NULL,
	"budget_mode" text NOT NULL,
	"execution_preference" text NOT NULL,
	"approval_mode" text NOT NULL,
	"slippage_bps" integer NOT NULL,
	"latest_plan_id" uuid,
	"latest_plan_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "intents_state_check" CHECK ("state" IN ('DRAFT', 'QUOTED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'PARTIALLY_COMPLETED', 'EXPIRED', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'UNKNOWN_REQUIRES_RECONCILIATION')),
	CONSTRAINT "intents_kind_check" CHECK ("kind" IN ('basket_investment', 'single_buy')),
	CONSTRAINT "intents_budget_mode_check" CHECK ("budget_mode" IN ('all_in_stablecoin', 'investable_notional')),
	CONSTRAINT "intents_slippage_check" CHECK ("intents"."slippage_bps" >= 1 AND "intents"."slippage_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "venue_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"plan_id" uuid,
	"leg_index" integer NOT NULL,
	"venue" text NOT NULL,
	"mode" text NOT NULL,
	"quote_ref" text NOT NULL,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"in_amount_raw" text NOT NULL,
	"out_amount_raw" text NOT NULL,
	"other_amount_threshold_raw" text NOT NULL,
	"slippage_bps" integer NOT NULL,
	"price_impact_bps" integer,
	"quote" jsonb NOT NULL,
	"accepted" boolean NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_quotes_mode_check" CHECK ("mode" IN ('fixture', 'configured_url'))
);
--> statement-breakpoint
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_version_id_strategy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_quotes" ADD CONSTRAINT "venue_quotes_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_quotes" ADD CONSTRAINT "venue_quotes_plan_id_execution_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_plans_intent_idx" ON "execution_plans" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "execution_plans_hash_idx" ON "execution_plans" USING btree ("plan_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "intents_owner_key_unique" ON "intents" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intents_owner_idx" ON "intents" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "venue_quotes_intent_idx" ON "venue_quotes" USING btree ("intent_id","created_at");