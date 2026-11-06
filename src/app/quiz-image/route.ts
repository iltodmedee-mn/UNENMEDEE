import { jpegResponse } from "@/lib/jpeg";
import { quizCard } from "@/lib/og";
import { canonicalImageQuery } from "@/lib/site";
import { readWeeklyQuiz } from "@/lib/social/weekly-quiz-store";

/** The answers card stays hidden until the evening after the quiz went out. */
const ANSWERS_AFTER_MS = 18 * 3_600_000;

/**
 * The weekly quiz cards as JPEG (GET /quiz-image?w=<yyyyww>&n=<0…n+1 | a>): the carousel that
 * scripts/post-social.ts posts on Sunday and the answers card the next day. Text comes from the
 * stored quiz (our own stories), never from the query string; a week that is not the stored one is
 * 404, so old URLs stop rendering once the next quiz is made.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonical = canonicalImageQuery(url, ["w", "n"]);
  if (canonical) return Response.redirect(new URL(canonical, url), 308);
  const w = url.searchParams.get("w") ?? "";
  const n = url.searchParams.get("n") ?? "";
  const notFound = () => new Response("Not found", { status: 404 });
  if (!/^\d{6}$/.test(w) || !/^(?:\d|a)$/.test(n)) return notFound();
  const quiz = await readWeeklyQuiz();
  if (!quiz || quiz.week !== Number(w)) return notFound();
  if (n === "a") {
    if (Date.now() - new Date(quiz.createdAt).getTime() < ANSWERS_AFTER_MS) return notFound();
    return jpegResponse(await quizCard(quiz, "answers"));
  }
  const slide = Number(n);
  if (slide > quiz.questions.length + 1) return notFound();
  return jpegResponse(await quizCard(quiz, slide));
}
