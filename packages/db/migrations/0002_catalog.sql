CREATE TABLE "instrument_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_decisions_decision_check" CHECK ("decision" IN ('admit', 'reject', 'pause', 'resume', 'delist')),
	CONSTRAINT "instrument_decisions_previous_status_check" CHECK ("previous_status" IN ('quarantined', 'admitted', 'paused', 'rejected', 'delisted')),
	CONSTRAINT "instrument_decisions_new_status_check" CHECK ("new_status" IN ('quarantined', 'admitted', 'paused', 'rejected', 'delisted'))
);
--> statement-breakpoint
CREATE TABLE "instrument_mint_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rpc_host" text NOT NULL,
	"slot" bigint,
	"result" text NOT NULL,
	"on_chain" jsonb,
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "instrument_mint_verifications_result_check" CHECK ("result" IN ('verified', 'mismatch', 'not_found', 'not_a_mint', 'error'))
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer" text NOT NULL,
	"issuer_product_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"kind" text NOT NULL,
	"chain" text DEFAULT 'solana' NOT NULL,
	"genesis_hash" text NOT NULL,
	"mint" text NOT NULL,
	"decimals" integer NOT NULL,
	"token_program" text DEFAULT 'unknown' NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"website" text,
	"description" text,
	"reference_price" jsonb,
	"fingerprint" text NOT NULL,
	"source_snapshot_id" uuid NOT NULL,
	"admitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_issuer_check" CHECK ("issuer" IN ('prestocks', 'xstocks', 'tessera')),
	CONSTRAINT "instruments_kind_check" CHECK ("kind" IN ('pre_ipo_exposure', 'listed_stock')),
	CONSTRAINT "instruments_status_check" CHECK ("status" IN ('quarantined', 'admitted', 'paused', 'rejected', 'delisted')),
	CONSTRAINT "instruments_token_program_check" CHECK ("token_program" IN ('spl-token', 'token-2022', 'unknown')),
	CONSTRAINT "instruments_decimals_check" CHECK ("instruments"."decimals" BETWEEN 0 AND 18)
);
--> statement-breakpoint
CREATE TABLE "issuer_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"schema_version" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"rejection_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issuer_snapshots_issuer_check" CHECK ("issuer" IN ('prestocks', 'xstocks', 'tessera')),
	CONSTRAINT "issuer_snapshots_source_check" CHECK ("source" IN ('fixture', 'configured_url')),
	CONSTRAINT "issuer_snapshots_status_check" CHECK ("status" IN ('accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "instrument_decisions" ADD CONSTRAINT "instrument_decisions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_mint_verifications" ADD CONSTRAINT "instrument_mint_verifications_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_source_snapshot_id_issuer_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."issuer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instrument_decisions_instrument_idx" ON "instrument_decisions" USING btree ("instrument_id","decided_at");--> statement-breakpoint
CREATE INDEX "instrument_mint_verifications_instrument_idx" ON "instrument_mint_verifications" USING btree ("instrument_id","verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_issuer_product_unique" ON "instruments" USING btree ("issuer","issuer_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_live_mint_unique" ON "instruments" USING btree ("mint") WHERE "instruments"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "instruments_issuer_symbol_idx" ON "instruments" USING btree ("issuer","symbol");--> statement-breakpoint
CREATE INDEX "instruments_status_idx" ON "instruments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "issuer_snapshots_issuer_fetched_idx" ON "issuer_snapshots" USING btree ("issuer","fetched_at");