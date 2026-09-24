CREATE TABLE "beta_participants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eligibility_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"policy_version" text,
	"jurisdiction" text NOT NULL,
	"evidence_kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issuers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"decided_by" text NOT NULL,
	CONSTRAINT "eligibility_decisions_seq_unique" UNIQUE("seq"),
	CONSTRAINT "eligibility_decisions_capability_check" CHECK ("capability" IN ('trade_stocks')),
	CONSTRAINT "eligibility_decisions_evidence_check" CHECK ("evidence_kind" IN ('self_declared', 'operator_attested', 'provider_verified')),
	CONSTRAINT "eligibility_decisions_outcome_check" CHECK ("outcome" IN ('eligible', 'ineligible', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_rule_sets" (
	"policy_version" text PRIMARY KEY NOT NULL,
	"validity_days" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"limits" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" text NOT NULL,
	"stage" text NOT NULL,
	"notional_usdc_raw" text NOT NULL,
	"outcome" text NOT NULL,
	"denials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"reservation_id" uuid,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "policy_decisions_seq_unique" UNIQUE("seq"),
	CONSTRAINT "policy_decisions_outcome_check" CHECK ("policy_decisions"."outcome" IN ('allow', 'deny'))
);
--> statement-breakpoint
CREATE TABLE "spend_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" text NOT NULL,
	"notional_usdc_raw" text NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "spend_reservations_status_check" CHECK ("status" IN ('held', 'released', 'consumed', 'expired')),
	CONSTRAINT "spend_reservations_side_check" CHECK ("spend_reservations"."side" IN ('buy', 'sell'))
);
--> statement-breakpoint
CREATE TABLE "terms_acknowledgements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_documents" (
	"terms_version" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"url" text NOT NULL,
	"required_for" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beta_participants" ADD CONSTRAINT "beta_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_limits" ADD CONSTRAINT "owner_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_reservation_id_spend_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."spend_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_reservations" ADD CONSTRAINT "spend_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_reservations" ADD CONSTRAINT "spend_reservations_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acknowledgements" ADD CONSTRAINT "terms_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acknowledgements" ADD CONSTRAINT "terms_acknowledgements_terms_version_terms_documents_terms_version_fk" FOREIGN KEY ("terms_version") REFERENCES "public"."terms_documents"("terms_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eligibility_decisions_user_idx" ON "eligibility_decisions" USING btree ("user_id","capability","seq");--> statement-breakpoint
CREATE INDEX "jurisdiction_rule_sets_active_idx" ON "jurisdiction_rule_sets" USING btree ("active","published_at");--> statement-breakpoint
CREATE INDEX "policy_decisions_user_idx" ON "policy_decisions" USING btree ("user_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_reservations_user_intent_unique" ON "spend_reservations" USING btree ("user_id","intent_id");--> statement-breakpoint
CREATE INDEX "spend_reservations_user_status_idx" ON "spend_reservations" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_acknowledgements_user_version_unique" ON "terms_acknowledgements" USING btree ("user_id","terms_version");--> statement-breakpoint
CREATE INDEX "terms_documents_active_idx" ON "terms_documents" USING btree ("active","published_at");