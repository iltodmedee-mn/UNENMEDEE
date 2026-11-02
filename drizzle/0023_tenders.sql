-- Tender results from Шилэн данс (form 1831), see src/lib/procurement. Idempotent like 0018–0022.
-- Every table has row-level security (CLAUDE.md §8).
CREATE TABLE IF NOT EXISTS "tenders" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(200) NOT NULL,
	"code" varchar(40) NOT NULL,
	"title" text NOT NULL,
	"org_name" text NOT NULL,
	"org_register" varchar(20),
	"governor" text,
	"budget_mnt" bigint,
	"contract_mnt" bigint,
	"method" text,
	"winner" text,
	"awarded" boolean DEFAULT false NOT NULL,
	"unit_suspect" boolean DEFAULT false NOT NULL,
	"result_date" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"awarded_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenders_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenders_awarded_seen_idx" ON "tenders" USING btree ("awarded_seen_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenders_result_date_idx" ON "tenders" USING btree ("result_date");
--> statement-breakpoint
ALTER TABLE "tenders" ENABLE ROW LEVEL SECURITY;
