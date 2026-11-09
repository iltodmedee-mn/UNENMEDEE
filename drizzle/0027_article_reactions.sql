CREATE TABLE IF NOT EXISTS "article_reactions" (
	"article_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reactions_article_id_kind_pk" PRIMARY KEY("article_id","kind")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article_reactions" ADD CONSTRAINT "article_reactions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "article_reactions_updated_idx" ON "article_reactions" USING btree ("updated_at");
--> statement-breakpoint
ALTER TABLE "article_reactions" ENABLE ROW LEVEL SECURITY;
