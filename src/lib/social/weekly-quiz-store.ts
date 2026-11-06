import { eq } from "drizzle-orm";

import { getDb, hasDatabase } from "@/db";
import { appSettings } from "@/db/schema";

import { parseWeeklyQuiz, WEEKLY_QUIZ_KEY, type WeeklyQuiz } from "./weekly-quiz";

/**
 * The newest weekly quiz (app_settings `weekly_quiz`). Read uncached: the cards are fetched by the
 * platforms minutes after scripts/post-social.ts stores a new quiz, and an hour-cached copy would
 * still hold last week's (the CDN caches each card URL instead).
 */
export async function readWeeklyQuiz(): Promise<WeeklyQuiz | null> {
  if (!hasDatabase()) return null;
  const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WEEKLY_QUIZ_KEY)).limit(1);
  return parseWeeklyQuiz(row?.value);
}
