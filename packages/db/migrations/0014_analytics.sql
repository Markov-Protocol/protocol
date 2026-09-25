CREATE TABLE "price_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset" text NOT NULL,
	"instrument_id" uuid,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"unit" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_kind" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_observations_kind_check" CHECK ("kind" IN ('secondary_market', 'issuer_mark', 'underlying_equity', 'implied_valuation')),
	CONSTRAINT "price_observations_source_kind_check" CHECK ("source_kind" IN ('issuer_feed', 'operator', 'fixture'))
);
--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_observations_point_unique" ON "price_observations" USING btree ("asset","kind","source","observed_at");--> statement-breakpoint
CREATE INDEX "price_observations_asset_idx" ON "price_observations" USING btree ("asset","observed_at");