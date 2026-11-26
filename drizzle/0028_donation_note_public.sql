ALTER TABLE "donations" ADD COLUMN "note_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The notes stored before this column were typed and read by the owner in /admin: they stay shown.
UPDATE "donations" SET "note_public" = true WHERE "note" IS NOT NULL;
