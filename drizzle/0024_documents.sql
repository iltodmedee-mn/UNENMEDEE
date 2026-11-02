-- Reports and tender documents on watched pages, see src/lib/documents. Idempotent like 0018–0023.
-- Every table has row-level security (CLAUDE.md §8).
CREATE TABLE IF NOT EXISTS "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar(1000) NOT NULL,
	"title" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"page_title" text,
	"page_url" text,
	"file_type" varchar(8),
	"meta" jsonb,
	"baseline" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watched_pages" (
	"url" varchar(1000) PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"modified" varchar(40) NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_first_seen_idx" ON "documents" USING btree ("first_seen_at");
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "watched_pages" ENABLE ROW LEVEL SECURITY;
