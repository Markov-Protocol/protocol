CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"question" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"provenance" jsonb,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "research_runs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"role" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"title" text,
	"status" text NOT NULL,
	"blocked_reason" text,
	"content_type" text,
	"byte_length" integer,
	"content_hash" text,
	"excerpt" text,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redirects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "source_records_role_check" CHECK ("role" IN ('issuer', 'legal', 'filing', 'news', 'data', 'other')),
	CONSTRAINT "source_records_status_check" CHECK ("status" IN ('fetched', 'blocked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theses_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "theses_status_check" CHECK ("status" IN ('draft', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "thesis_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text NOT NULL,
	"claim" text NOT NULL,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counterarguments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instruments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"private_notes" text,
	"author_principal" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_revisions" ADD CONSTRAINT "thesis_revisions_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_runs_owner_idx" ON "research_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "research_runs_thesis_idx" ON "research_runs" USING btree ("thesis_id","created_at");--> statement-breakpoint
CREATE INDEX "source_records_thesis_idx" ON "source_records" USING btree ("thesis_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "theses_owner_idx" ON "theses" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_revisions_number_unique" ON "thesis_revisions" USING btree ("thesis_id","revision_number");