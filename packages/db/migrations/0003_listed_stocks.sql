CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"announced_at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status_reason" text,
	"applied_at" timestamp with time zone,
	"applied_by" text,
	"source_snapshot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_issuer_check" CHECK ("issuer" IN ('prestocks', 'xstocks', 'tessera')),
	CONSTRAINT "corporate_actions_type_check" CHECK ("type" IN ('split', 'reverse_split', 'distribution', 'migration', 'sunset', 'halt', 'resume', 'multiplier_change')),
	CONSTRAINT "corporate_actions_status_check" CHECK ("status" IN ('pending', 'applied', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "instrument_multipliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"multiplier" text NOT NULL,
	"multiplier_exact" text NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_multipliers_source_check" CHECK ("source" IN ('on_chain', 'corporate_action', 'operator', 'issuer_feed'))
);
--> statement-breakpoint
ALTER TABLE "instrument_mint_verifications" ADD COLUMN "compatibility" jsonb;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "underlying_ticker" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "underlying_exchange" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "halted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "halted_reason" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "migration_target_product_id" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "migration_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "sunset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issuer_snapshots" ADD COLUMN "kind" text DEFAULT 'products' NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_source_snapshot_id_issuer_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."issuer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_multipliers" ADD CONSTRAINT "instrument_multipliers_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_issuer_external_unique" ON "corporate_actions" USING btree ("issuer","external_id");--> statement-breakpoint
CREATE INDEX "corporate_actions_instrument_idx" ON "corporate_actions" USING btree ("instrument_id","effective_at");--> statement-breakpoint
CREATE INDEX "corporate_actions_status_idx" ON "corporate_actions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_multipliers_point_unique" ON "instrument_multipliers" USING btree ("instrument_id","effective_at","source");--> statement-breakpoint
CREATE INDEX "instrument_multipliers_instrument_idx" ON "instrument_multipliers" USING btree ("instrument_id","effective_at");--> statement-breakpoint
ALTER TABLE "issuer_snapshots" ADD CONSTRAINT "issuer_snapshots_kind_check" CHECK ("kind" IN ('products', 'corporate_actions'));