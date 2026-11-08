-- Server errors of the public site, counted per route and message (src/instrumentation.ts). Idempotent
-- like 0018–0024. Every table has row-level security (docs/agents/ops.md §8).
CREATE TABLE IF NOT EXISTS "site_errors" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"route" varchar(300) NOT NULL,
	"message" varchar(300) NOT NULL,
	"digest" varchar(40),
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_errors_last_seen_idx" ON "site_errors" USING btree ("last_seen");
--> statement-breakpoint
ALTER TABLE "site_errors" ENABLE ROW LEVEL SECURITY;
