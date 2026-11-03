/**
 * Posts to the ИЛ ТОД МЭДЭЭ Facebook page, Threads, Instagram, Telegram channel and Discord
 * announcement channel (docs/FACEBOOK.md).
 *
 *   npm run social:post -- --mode digest            # the newest digest edition (morning / evening)
 *   npm run social:post -- --mode news              # the most important new story, if any
 *   npm run social:post -- --mode news --dry-run    # print, post nothing
 *   npm run social:post -- --mode quiz              # the daily Discord quiz poll (once a day)
 *   npm run social:post -- --mode weekly            # "7 хоногийн ТОП" on Mondays (--any-day to test)
 *   npm run social:post -- --mode video             # the newest generated video (make-video.ts) as a Reel on Facebook, Instagram and Threads
 *   npm run social:post -- --mode promo             # the Launchpad campaign post due today (src/lib/social/promo.ts), 3–7 Nov 2026
 *
 * Facebook needs FB_PAGE_ID (variable) and FB_PAGE_TOKEN (secret). Threads needs THREADS_TOKEN
 * (secret) once: the long-lived token is then kept and refreshed weekly in app_settings
 * (`threads`); a new THREADS_TOKEN secret replaces it. Instagram works the same way with
 * INSTAGRAM_TOKEN (`instagram`), posting our JPEG card from /ig-image. Telegram needs
 * TELEGRAM_BOT_TOKEN (secret) and TELEGRAM_CHAT_ID (variable, "@channel"). Discord needs DISCORD_BOT_TOKEN
 * (secret) and DISCORD_CHANNEL_ID (variable or secret; the bare id or the channel URL); the message is crossposted to every server that follows
 * the announcement channel. Each platform without credentials is
 * skipped. News: published in the last 24 h, dated, AI-summarized (not the no-AI fallback),
 * importance >= FB_IMPORTANCE_MIN (75) or a risk flag, one per cluster, FB_NEWS_PER_RUN (1) per run
 * and FB_NEWS_PER_DAY (4) per day and platform, so the feeds stay curated, not a firehose.
 */
import "dotenv/config";
import { parseArgs } from "node:util";

import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { storedNeutrality } from "@/lib/ai/fact-spin";
import { appSettings, articles, clusters, digests, politicians, socialPosts, sources, videos } from "@/db/schema";
import { type ArticleForPost, articlePost, type DigestForPost, digestPost, FacebookError, publishReel, publishToPage, resolveFacebookPage } from "@/lib/social/facebook";
import { INSTAGRAM_SETTINGS_KEY, type InstagramPost, instagramArticlePost, instagramDigestPost, publishInstagram, refreshInstagramToken } from "@/lib/social/instagram";
import { publishThreads, refreshToken, THREADS_SETTINGS_KEY, threadsArticlePost, threadsDigestPost } from "@/lib/social/threads";
import { publishTelegram, telegramArticlePost, telegramDigestPost, type TelegramPost } from "@/lib/social/telegram";
import { discordArticlePost, discordChannelId, discordDigestPost, type DiscordPost, discordQuizPost, publishDiscord } from "@/lib/social/discord";
import { makeQuiz, type Quiz } from "@/lib/social/quiz";
import { biggestAmount, isWeeklyDue, mostNamed, previousWeek, type WeeklyTop, weeklyShortText, weeklyText } from "@/lib/social/weekly";
import { sharedShortNames } from "@/lib/officials/flags";
import { currentState, needsRefresh, refreshSeverity, type TokenState } from "@/lib/social/token-state";
import { PRODUCTION_URL } from "@/lib/site";
import { outcomeUnknown } from "@/lib/social/outcome";
import { topicFor } from "@/lib/topics";
import { facebookVideoText, instagramVideoCaption, threadsVideoText, type VideoMeta } from "@/lib/video/posts";
import { duePromo, type PromoPost } from "@/lib/social/promo";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "news" },
    "dry-run": { type: "boolean", default: false },
    "any-day": { type: "boolean", default: false },
  },
});
const dry = values["dry-run"];
const IMPORTANCE_MIN = Number(process.env.FB_IMPORTANCE_MIN ?? 75);
const PER_RUN = Number(process.env.FB_NEWS_PER_RUN ?? 1);
const PER_DAY = Number(process.env.FB_NEWS_PER_DAY ?? 4);

type Db = ReturnType<typeof getDb>;

/** One destination: how a digest / story is worded there and how it is published. */
interface Platform {
  name: "facebook" | "threads" | "instagram" | "telegram" | "discord";
  digest(d: DigestForPost): { preview: string; publish(): Promise<string> };
  article(a: ArticleForPost): { preview: string; publish(): Promise<string> };
  /** Only platforms with native polls (Discord). */
  quiz?(q: Quiz): { preview: string; publish(): Promise<string> };
  /** Text-only platforms (not Instagram, which needs an image). */
  weekly?(w: WeeklyTop): { preview: string; publish(): Promise<string> };
  /** Video platforms (Facebook Reels, Instagram Reels, Threads). */
  video?(v: VideoForPost): { preview: string; publish(): Promise<string> };
  /** The Launchpad campaign reel (same three platforms). */
  promo?(p: PromoPost, videoUrl: string): { preview: string; publish(): Promise<string> };
}

/** A generated video and the public URL the platforms fetch it from (/reel). */
interface VideoForPost {
  id: number;
  meta: VideoMeta;
  url: string;
}

function facebook(pageId: string, token: string): Platform {
  const make = (post: { message: string; link: string }) => ({
    preview: `${post.link}\n${post.message}`,
    publish: () => publishToPage({ pageId, token, post }),
  });
  return {
    name: "facebook",
    digest: (d) => make(digestPost(d)),
    article: (a) => make(articlePost(a)),
    weekly: (w) => make({ message: weeklyText(w, "plain"), link: `${PRODUCTION_URL}/digest` }),
    video: (v) => {
      const description = facebookVideoText(v.meta);
      return { preview: `${v.url}\n${description}`, publish: () => publishReel({ pageId, token, videoUrl: v.url, description }) };
    },
    promo: (pr, videoUrl) => ({ preview: `${videoUrl}\n${pr.facebook}`, publish: () => publishReel({ pageId, token, videoUrl, description: pr.facebook }) }),
  };
}

function threads(token: string): Platform {
  const make = (post: { text: string; link: string }) => ({ preview: `${post.link}\n${post.text}`, publish: () => publishThreads({ token, post }) });
  return {
    name: "threads",
    digest: (d) => make(threadsDigestPost(d)),
    article: (a) => make(threadsArticlePost(a)),
    weekly: (w) => make({ text: weeklyShortText(w), link: `${PRODUCTION_URL}/digest` }),
    video: (v) => {
      const text = threadsVideoText(v.meta);
      return { preview: `${v.url}\n${text}`, publish: () => publishThreads({ token, post: { text, link: v.url, videoUrl: v.url } }) };
    },
    promo: (pr, videoUrl) => ({ preview: `${videoUrl}\n${pr.threads}`, publish: () => publishThreads({ token, post: { text: pr.threads, link: videoUrl, videoUrl } }) }),
  };
}

function telegram(token: string, chatId: string): Platform {
  const make = (post: TelegramPost) => ({ preview: `${post.link}\n${post.text}`, publish: () => publishTelegram({ token, chatId, post }) });
  return {
    name: "telegram",
    digest: (d) => make(telegramDigestPost(d)),
    article: (a) => make(telegramArticlePost(a)),
    weekly: (w) => make({ text: weeklyText(w, "plain"), link: `${PRODUCTION_URL}/digest` }),
  };
}

function discord(token: string, channelId: string): Platform {
  const make = (post: DiscordPost) => ({
    preview: `${post.link}\n${post.text}`,
    publish: () => publishDiscord({ token, channelId, post, onWarning: (m) => console.log(`::warning::${m}`) }),
  });
  return {
    name: "discord",
    digest: (d) => make(discordDigestPost(d)),
    article: (a) => make(discordArticlePost(a)),
    quiz: (q) => make(discordQuizPost(q)),
    weekly: (w) => make({ text: weeklyText(w, "discord"), link: `${PRODUCTION_URL}/digest` }),
  };
}

function instagram(token: string): Platform {
  const make = (post: InstagramPost) => ({ preview: `${post.imageUrl ?? post.videoUrl}\n${post.caption}`, publish: () => publishInstagram({ token, post }) });
  return {
    name: "instagram",
    digest: (d) => make(instagramDigestPost(d)),
    article: (a) => make(instagramArticlePost(a)),
    video: (v) => {
      const caption = instagramVideoCaption(v.meta);
      return { preview: `${v.url}\n${caption}`, publish: () => publishInstagram({ token, post: { videoUrl: v.url, caption } }) };
    },
    promo: (pr, videoUrl) => ({ preview: `${videoUrl}\n${pr.instagram}`, publish: () => publishInstagram({ token, post: { videoUrl, caption: pr.instagram } }) }),
  };
}

/**
 * A 60-day token (Threads, Instagram) seeded by a secret and kept in app_settings: refreshed and
 * stored when it is a week old (not on dry runs). See src/lib/social/token-state.ts.
 */
async function storedToken(db: Db, key: string, envToken: string | undefined, refresh: (token: string) => Promise<string>): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  let stored: TokenState | null = null;
  try {
    stored = row ? (JSON.parse(row.value) as TokenState) : null;
  } catch {
    stored = null;
  }
  let state = currentState(stored, envToken);
  if (!state) return null;
  if (!dry && needsRefresh(state)) {
    try {
      state = { ...state, token: await refresh(state.token), refreshedAt: new Date().toISOString() };
      console.log(`🔑 ${key} token refreshed (valid 60 more days).`);
    } catch (err) {
      // Loud once the stored token nears its 60-day expiry (src/lib/social/token-state.ts).
      const severity = refreshSeverity(state);
      console.error(`::${severity}::${key} token refresh failed: ${err instanceof Error ? err.message : err}`);
      if (severity === "error") process.exitCode = 1;
    }
  }
  if (!dry && (!stored || stored.token !== state.token || stored.refreshedAt !== state.refreshedAt)) {
    const value = JSON.stringify(state);
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  return state.token;
}

const notPosted = (platform: string, kind: string, ref: unknown) =>
  sql`not exists (select 1 from ${socialPosts} where ${socialPosts.platform} = ${platform} and ${socialPosts.kind} = ${kind} and ${socialPosts.refId} = ${ref})`;

/**
 * Reserve, post, record the id. Only a post the platform clearly refused frees the row for the
 * next run. Once it may have gone out (published but the DB update failed, or the answer was lost
 * to a timeout) the reservation stays, marked for a manual check: a repost would be a duplicate.
 */
async function post(db: Db, p: Platform, kind: "digest" | "article" | "quiz" | "weekly" | "video" | "promo", refId: number, item: { preview: string; publish(): Promise<string> }) {
  console.log(`  → ${p.name} ${kind} #${refId}: ${item.preview.replace(/\n/g, "\n    ")}`);
  if (dry) return;
  let [row] = await db.insert(socialPosts).values({ platform: p.name, kind, refId }).onConflictDoNothing().returning({ id: socialPosts.id });
  let tries = 0;
  if (!row && (kind === "video" || kind === "promo")) {
    // A video the platform refused before ("failed:n"): claim the row for one more try, atomically.
    const [prev] = await db
      .select({ postId: socialPosts.postId })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, p.name), eq(socialPosts.kind, kind), eq(socialPosts.refId, refId)));
    tries = failedTries(prev?.postId);
    if (tries > 0 && tries < VIDEO_MAX_TRIES) {
      [row] = await db
        .update(socialPosts)
        .set({ postId: null })
        .where(and(eq(socialPosts.platform, p.name), eq(socialPosts.kind, kind), eq(socialPosts.refId, refId), eq(socialPosts.postId, `failed:${tries}`)))
        .returning({ id: socialPosts.id });
    }
  }
  if (!row) return console.log("    already posted, skipped");
  let id: string;
  try {
    id = await item.publish();
  } catch (err) {
    if (outcomeUnknown(err)) {
      await db.update(socialPosts).set({ postId: "unknown" }).where(eq(socialPosts.id, row.id));
      console.error(`::warning::${p.name} ${kind} #${refId}: no answer (${err instanceof Error ? err.message : err}); kept as posted, check the page by hand.`);
      return;
    }
    if (kind === "video" || kind === "promo") {
      // A refused reel is retried at most VIDEO_MAX_TRIES times, not every 30 min for 48 h
      // (each Facebook try leaves an unpublished upload on the Page).
      const n = tries + 1;
      await db.update(socialPosts).set({ postId: `failed:${n}` }).where(eq(socialPosts.id, row.id));
      if (n >= VIDEO_MAX_TRIES) console.error(`::error::${p.name} video #${refId} refused ${n} times; not tried again.`);
      throw err;
    }
    await db.delete(socialPosts).where(eq(socialPosts.id, row.id));
    throw err;
  }
  console.log(`    ✓ posted ${id}`);
  try {
    await db.update(socialPosts).set({ postId: id }).where(eq(socialPosts.id, row.id));
  } catch (err) {
    // Published: keep the reservation (without its id) rather than posting it again next run.
    console.error(`::warning::${p.name} post ${id} went out but its id was not stored: ${err instanceof Error ? err.message : err}`);
  }
}

async function postDigest(db: Db, p: Platform) {
  // The newest edition only: filtering on "not posted" first made a run after the newest was
  // out post the previous (older) edition instead, so a platform got two editions back to back.
  const [newest] = await db
    .select({ id: digests.id })
    .from(digests)
    .where(gte(digests.createdAt, new Date(Date.now() - 12 * 3_600_000)))
    .orderBy(desc(digests.createdAt))
    .limit(1);
  const [d] = newest ? await db.select().from(digests).where(and(eq(digests.id, newest.id), notPosted(p.name, "digest", digests.id))) : [];
  if (!d || d.items.length === 0) return console.log(`📘 ${p.name}: no new digest edition to post.`);
  await post(db, p, "digest", d.id, p.digest(d));
}

async function postNews(db: Db, p: Platform) {
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, p.name), eq(socialPosts.kind, "article"), gte(socialPosts.createdAt, new Date(Date.now() - 24 * 3_600_000))));
  const room = Math.min(PER_RUN, PER_DAY - today);
  if (room <= 0) return console.log(`📘 ${p.name}: daily news limit reached (${today}/${PER_DAY}).`);
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      // Our plain headline when Tier 1 wrote one (src/lib/ai/reader-view.ts).
      title: sql<string>`coalesce(${articles.readerTitle}, ${articles.title})`,
      tldr: articles.tldrSummary,
      sourceName: sources.name,
      entities: articles.extractedEntities,
      riskFlag: articles.riskFlag,
      riskScore: articles.riskScore,
      factVsSpin: articles.factVsSpin,
      impact: articles.readerImpact,
      topic: articles.topic,
      domain: sources.domain,
      category: sources.category,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        eq(articles.isPublished, true),
        isNotNull(articles.tldrSummary),
        eq(articles.summaryFallback, false),
        gte(articles.publishedAt, new Date(Date.now() - 24 * 3_600_000)),
        sql`coalesce((${articles.scrapeMeta}->>'date_unknown')::boolean, false) = false`,
        or(gte(articles.importanceScore, IMPORTANCE_MIN), eq(articles.riskFlag, true)),
        notPosted(p.name, "article", articles.id),
        // One post per story: skip articles whose cluster already went out on this platform.
        sql`(${articles.clusterId} is null or not exists (select 1 from ${socialPosts} sp join ${articles} a2 on a2.id = sp.ref_id where sp.platform = ${p.name} and sp.kind = 'article' and a2.cluster_id = ${articles.clusterId}))`,
      ),
    )
    .orderBy(sql`${articles.importanceScore} desc nulls last`, desc(articles.riskScore))
    .limit(room);
  if (rows.length === 0) return console.log(`📘 ${p.name}: no new important story to post.`);
  for (const r of rows) {
    // The site's own topic rule (topics.ts): aimag/district sites are local, opendata is data,
    // otherwise the AI topic with the domain as fallback.
    const topic = topicFor(r.domain, r.category, r.topic).key;
    await post(db, p, "article", r.id, p.article({
        ...r,
        topic,
        tldr: r.tldr ?? "",
        amounts: r.entities?.amounts_mnt ?? [],
        neutrality: storedNeutrality(r.factVsSpin),
        facts: r.factVsSpin?.facts ?? [],
      }));
  }
}

/** Hours between two quizzes: one a day, whichever of the two daily digest runs comes first. */
const QUIZ_EVERY_H = 20;

/** The daily quiz: the most important story of the last 3 days whose headline names a ₮ amount. */
async function postQuiz(db: Db, p: Platform) {
  if (!p.quiz) return;
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, p.name), eq(socialPosts.kind, "quiz"), gte(socialPosts.createdAt, new Date(Date.now() - QUIZ_EVERY_H * 3_600_000))));
  if (recent > 0) return console.log(`🧠 ${p.name}: today's quiz is already out.`);
  const rows = await db
    .select({ id: articles.id, slug: articles.slug, title: articles.title, entities: articles.extractedEntities })
    .from(articles)
    .where(
      and(
        eq(articles.isPublished, true),
        isNotNull(articles.tldrSummary),
        eq(articles.summaryFallback, false),
        gte(articles.publishedAt, new Date(Date.now() - 72 * 3_600_000)),
        sql`coalesce((${articles.scrapeMeta}->>'date_unknown')::boolean, false) = false`,
        // makeQuiz needs a ₮ amount in the headline itself.
        sql`${articles.title} ~ '[0-9]'`,
        sql`jsonb_array_length(coalesce(${articles.extractedEntities}->'amounts_mnt', '[]'::jsonb)) > 0`,
        notPosted(p.name, "quiz", articles.id),
      ),
    )
    .orderBy(sql`${articles.importanceScore} desc nulls last`, desc(articles.publishedAt))
    .limit(30);
  for (const r of rows) {
    const q = makeQuiz({ id: r.id, slug: r.slug, title: r.title, amounts: r.entities?.amounts_mnt ?? [] });
    if (q) return post(db, p, "quiz", r.id, p.quiz(q));
  }
  console.log(`🧠 ${p.name}: no recent story with an amount for a quiz.`);
}

/** Last week's numbers, read once and posted to every text platform. */
async function loadWeekly(db: Db): Promise<WeeklyTop | null> {
  const { week, label, from, to } = previousWeek(new Date());
  const inWeek = and(eq(articles.isPublished, true), gte(articles.publishedAt, from), sql`${articles.publishedAt} < ${to}`);
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: sql<string>`coalesce(${articles.readerTitle}, ${articles.title})`,
      entities: articles.extractedEntities,
      riskFlag: articles.riskFlag,
      sourceId: articles.sourceId,
      clusterId: articles.clusterId,
      domain: sources.domain,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(inWeek);
  if (rows.length === 0) return null;
  const biggest = biggestAmount(rows.map((r) => ({ title: r.title, slug: r.slug, amounts: r.entities?.amounts_mnt ?? [] })));
  // The story the most different sites reported: the cluster with the most distinct sources.
  const bySources = new Map<number, Set<number>>();
  for (const r of rows) if (r.clusterId !== null) bySources.set(r.clusterId, (bySources.get(r.clusterId) ?? new Set()).add(r.sourceId));
  const [topCluster] = [...bySources.entries()].sort((a, b) => b[1].size - a[1].size);
  const [cluster] = topCluster && topCluster[1].size >= 2 ? await db.select({ id: clusters.id, title: clusters.title }).from(clusters).where(eq(clusters.id, topCluster[0])) : [];
  // Every member, former ones included: a short name shared across terms is never attributed.
  const people = await db.select({ id: politicians.id, shortName: politicians.shortName, isActive: politicians.isActive }).from(politicians);
  return {
    week,
    label,
    biggest: biggest ? { title: biggest.title, slug: biggest.slug, amount: biggest.amount, amounts: biggest.amounts } : undefined,
    hottest: cluster && topCluster ? { title: cluster.title, clusterId: cluster.id, sources: topCluster[1].size } : undefined,
    mostNamed: mostNamed(
      rows.map((r) => r.entities?.people ?? []),
      people,
      sharedShortNames(people),
    ),
    legalActs: rows.filter((r) => r.domain === "legalinfo.mn").length,
    articles: rows.length,
    sources: new Set(rows.map((r) => r.sourceId)).size,
    risky: rows.filter((r) => r.riskFlag).length,
  };
}

async function postWeekly(db: Db, p: Platform, w: WeeklyTop) {
  if (!p.weekly) return;
  await post(db, p, "weekly", w.week, p.weekly(w));
}

/** A video a platform refused is tried this many times in all (`social_posts.post_id` = "failed:n"). */
const VIDEO_MAX_TRIES = 3;
const failedTries = (postId: string | null | undefined) => Number(/^failed:(\d+)$/.exec(postId ?? "")?.[1] ?? 0);

/** Videos older than this are not posted any more (their file is cleared after VIDEO_KEEP_DAYS). */
const VIDEO_POST_WITHIN_H = 48;

/** The newest generated video this platform has not posted yet, as a Reel / video post. */
async function postVideo(db: Db, p: Platform) {
  if (!p.video) return;
  const [v] = await db
    .select({ id: videos.id, meta: videos.meta })
    .from(videos)
    .where(
      and(
        isNotNull(videos.mp4),
        gte(videos.createdAt, new Date(Date.now() - VIDEO_POST_WITHIN_H * 3_600_000)),
        // Not posted, or refused fewer than VIDEO_MAX_TRIES times.
        sql`not exists (select 1 from ${socialPosts} where ${socialPosts.platform} = ${p.name} and ${socialPosts.kind} = 'video' and ${socialPosts.refId} = ${videos.id}
          and (${socialPosts.postId} is null or ${socialPosts.postId} not like 'failed:%' or split_part(${socialPosts.postId}, ':', 2)::int >= ${VIDEO_MAX_TRIES}))`,
      ),
    )
    .orderBy(desc(videos.createdAt))
    .limit(1);
  if (!v) return console.log(`🎬 ${p.name}: no new video to post.`);
  await post(db, p, "video", v.id, p.video({ id: v.id, meta: v.meta, url: `${PRODUCTION_URL}/reel?v=${v.id}` }));
}

/** Today's Launchpad campaign reel, once per platform (social_posts kind "promo", ref = day). */
async function postPromo(db: Db, p: Platform) {
  if (!p.promo) return;
  const pr = duePromo(new Date());
  if (!pr) return console.log(`🗳️ ${p.name}: no Launchpad campaign post due now.`);
  await post(db, p, "promo", pr.day, p.promo(pr, `${PRODUCTION_URL}${pr.video}`));
}

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const platforms: Platform[] = [];
  const fbToken = process.env.FB_PAGE_TOKEN?.trim();
  // A Page token's /me is the page itself, so FB_PAGE_ID is optional; a user token is swapped for
  // the Page's own token (resolveFacebookPage).
  const fbPage = fbToken ? await resolveFacebookPage({ token: fbToken, pageId: process.env.FB_PAGE_ID?.trim() }).catch((err: unknown) => ({ error: String(err) })) : undefined;
  if (fbPage && "error" in fbPage) {
    // A dead Page token (password change, lost admin role, app restriction) must show as a red step.
    console.error(`::error::${fbPage.error}`);
    process.exitCode = 1;
  } else if (fbPage) {
    if (fbPage.fromUserToken)
      console.log("::warning::FB_PAGE_TOKEN is a user token (expires in about 60 days): posting with its Page token. Replace the secret with the never-expiring Page token, docs/FACEBOOK.md step 4.");
    platforms.push(facebook(fbPage.pageId, fbPage.token));
  } else if (dry) platforms.push(facebook("dry-run", ""));
  else console.log("📘 Facebook is off: set the FB_PAGE_TOKEN secret (FB_PAGE_ID is optional), see docs/FACEBOOK.md.");
  const thToken = await storedToken(db, THREADS_SETTINGS_KEY, process.env.THREADS_TOKEN, (t) => refreshToken(t));
  if (thToken) platforms.push(threads(thToken));
  else console.log("🧵 Threads is off: set the THREADS_TOKEN secret, see docs/FACEBOOK.md.");
  const igToken = await storedToken(db, INSTAGRAM_SETTINGS_KEY, process.env.INSTAGRAM_TOKEN, (t) => refreshInstagramToken(t));
  if (igToken) platforms.push(instagram(igToken));
  else console.log("📸 Instagram is off: set the INSTAGRAM_TOKEN secret, see docs/FACEBOOK.md.");
  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (tgToken && tgChat) platforms.push(telegram(tgToken, tgChat));
  else if (tgToken || tgChat) console.error("::error::Telegram needs both the TELEGRAM_BOT_TOKEN secret and the TELEGRAM_CHAT_ID variable (docs/FACEBOOK.md).");
  else console.log("✈️ Telegram is off: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, see docs/FACEBOOK.md.");
  const dcToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const dcChannel = discordChannelId(process.env.DISCORD_CHANNEL_ID);
  if (dcToken && dcChannel) platforms.push(discord(dcToken, dcChannel));
  else if (dcToken || dcChannel) console.error("::error::Discord needs both the DISCORD_BOT_TOKEN secret and DISCORD_CHANNEL_ID (the channel id or its discord.com/channels/… URL, docs/FACEBOOK.md).");
  else console.log("🎮 Discord is off: set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID, see docs/FACEBOOK.md.");

  const mode = values.mode === "digest" || values.mode === "quiz" || values.mode === "weekly" || values.mode === "video" || values.mode === "promo" ? values.mode : "news";
  let weekly: WeeklyTop | null = null;
  if (mode === "weekly") {
    if (!isWeeklyDue(new Date()) && !values["any-day"] && !dry) return console.log("📊 The weekly list goes out on Mondays (Ulaanbaatar); --any-day to post now.");
    weekly = await loadWeekly(db);
    if (!weekly) return console.log("📊 No published stories last week: nothing to post.");
  }
  for (const p of platforms) {
    // One platform failing (expired token, rate limit) never stops the others.
    try {
      if (mode === "digest") await postDigest(db, p);
      else if (mode === "quiz") await postQuiz(db, p);
      else if (mode === "weekly" && weekly) await postWeekly(db, p, weekly);
      else if (mode === "video") await postVideo(db, p);
      else if (mode === "promo") await postPromo(db, p);
      else await postNews(db, p);
    } catch (err) {
      const hint = err instanceof FacebookError && err.hint ? ` ${err.hint}` : "";
      console.error(`::error::${p.name}: ${err instanceof Error ? err.message : err}${hint}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    console.error("✗ Social post failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
