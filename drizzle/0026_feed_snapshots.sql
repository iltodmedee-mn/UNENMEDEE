CREATE TABLE IF NOT EXISTS "feed_snapshots" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"hash" varchar(64) NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_snapshots" ENABLE ROW LEVEL SECURITY;
