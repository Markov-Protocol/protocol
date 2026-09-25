CREATE TABLE "moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"previous_status" text NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_decisions_status_check" CHECK ("status" IN ('none', 'hidden')),
	CONSTRAINT "moderation_decisions_previous_check" CHECK ("previous_status" IN ('none', 'hidden'))
);
--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_version_id_strategy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_decisions_strategy_idx" ON "moderation_decisions" USING btree ("strategy_id","decided_at");--> statement-breakpoint
CREATE INDEX "moderation_decisions_version_idx" ON "moderation_decisions" USING btree ("version_id","decided_at");