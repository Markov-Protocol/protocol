ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_kind_check";--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "continuation_of_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "continuation_of_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "continuation_leg_indexes" jsonb;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "continued_by_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_kind_check" CHECK ("kind" IN ('execution.pending', 'execution.submitted', 'execution.confirmed', 'execution.finalized', 'execution.failed', 'execution.expired', 'execution.unknown', 'execution.cancelled', 'execution.partial'));