CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"instance_id" uuid,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"reverses_entry_id" uuid,
	"attribution" text NOT NULL,
	"acknowledgement_kind" text,
	"acknowledgement_note" text,
	"acknowledged_at" timestamp with time zone,
	"memo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_kind_check" CHECK ("kind" IN ('fill', 'network_fee', 'rent', 'external_inflow', 'external_outflow', 'correction', 'lifecycle_adjustment')),
	CONSTRAINT "journal_entries_source_kind_check" CHECK ("source_kind" IN ('execution_fill', 'chain_reconciliation', 'operator')),
	CONSTRAINT "journal_entries_attribution_check" CHECK ("attribution" IN ('instance', 'unassigned', 'needs_reconciliation')),
	CONSTRAINT "journal_entries_ack_kind_check" CHECK ("acknowledgement_kind" IN ('deposit', 'withdrawal', 'transfer', 'other'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"account" text NOT NULL,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"delta_raw" text NOT NULL,
	"lot_id" uuid,
	CONSTRAINT "journal_lines_account_check" CHECK ("account" IN ('wallet', 'venue', 'network_fee', 'rent', 'external', 'correction'))
);
--> statement-breakpoint
CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"quantity_raw" text NOT NULL,
	"cost_raw" text NOT NULL,
	"proceeds_raw" text NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"instance_id" uuid,
	"intent_id" uuid,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"quantity_raw" text NOT NULL,
	"remaining_raw" text NOT NULL,
	"cost_asset" text NOT NULL,
	"cost_raw" text NOT NULL,
	"fee_lamports" text NOT NULL,
	"source_entry_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_status_check" CHECK ("status" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "receipt_signing_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"algorithm" text DEFAULT 'ed25519' NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_signing_keys_status_check" CHECK ("status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"intent_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"intent_state" text NOT NULL,
	"body" jsonb NOT NULL,
	"canonical_hash" text NOT NULL,
	"key_id" text NOT NULL,
	"signer_public_key" text NOT NULL,
	"signature" text NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"sequence" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_kind_check" CHECK ("kind" IN ('decision', 'execution')),
	CONSTRAINT "receipts_intent_state_check" CHECK ("intent_state" IN ('DRAFT', 'QUOTED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'PARTIALLY_COMPLETED', 'EXPIRED', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'UNKNOWN_REQUIRES_RECONCILIATION'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"slot" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"commitment" text NOT NULL,
	"status" text NOT NULL,
	"assets" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_checkpoints_status_check" CHECK ("status" IN ('matched', 'needs_review'))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_instance_id_portfolio_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."portfolio_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_instance_id_portfolio_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."portfolio_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_source_entry_id_journal_entries_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_key_id_receipt_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."receipt_signing_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_wallet_id_wallet_links_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_unique" ON "journal_entries" USING btree ("owner_user_id","source_ref");--> statement-breakpoint
CREATE INDEX "journal_entries_wallet_idx" ON "journal_entries" USING btree ("wallet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "journal_entries_instance_idx" ON "journal_entries" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_position_unique" ON "journal_lines" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "journal_lines_asset_idx" ON "journal_lines" USING btree ("asset","account");--> statement-breakpoint
CREATE INDEX "lot_consumptions_lot_idx" ON "lot_consumptions" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "lot_consumptions_entry_idx" ON "lot_consumptions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "lots_wallet_asset_idx" ON "lots" USING btree ("wallet_id","asset","opened_at");--> statement-breakpoint
CREATE INDEX "lots_instance_idx" ON "lots" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "receipts_owner_idx" ON "receipts" USING btree ("owner_user_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_intent_kind_state_unique" ON "receipts" USING btree ("intent_id","kind","intent_state");--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_wallet_idx" ON "reconciliation_checkpoints" USING btree ("wallet_id","sequence");