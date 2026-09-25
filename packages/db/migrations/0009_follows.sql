CREATE TABLE "strategy_follows" (
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_follows_user_id_strategy_id_pk" PRIMARY KEY("user_id","strategy_id")
);
--> statement-breakpoint
ALTER TABLE "strategy_follows" ADD CONSTRAINT "strategy_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_follows" ADD CONSTRAINT "strategy_follows_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_follows_strategy_idx" ON "strategy_follows" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "strategy_follows_user_idx" ON "strategy_follows" USING btree ("user_id","created_at");