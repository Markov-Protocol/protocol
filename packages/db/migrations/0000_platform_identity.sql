CREATE TABLE "capability_readiness" (
	"capability" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "capability_readiness_status_check" CHECK ("status" IN ('IMPLEMENTED', 'FIXTURE_VERIFIED', 'LIVE_READ_VERIFIED', 'LIVE_WRITE_VERIFIED', 'BLOCKED', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "platform_identity" (
	"id" integer PRIMARY KEY NOT NULL,
	"markov_env" text NOT NULL,
	"solana_cluster" text NOT NULL,
	"genesis_hash" text NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_by" text NOT NULL,
	CONSTRAINT "platform_identity_singleton" CHECK ("platform_identity"."id" = 1)
);
