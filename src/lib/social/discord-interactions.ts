/**
 * Discord slash commands over HTTP (Interactions Endpoint URL = https://iltodmedee.mn/api/discord),
 * so nothing has to stay online: Discord POSTs each command to our Vercel route, which checks the
 * Ed25519 signature with the app's public key, answers "thinking…" at once and edits the reply
 * when the data is in. Commands work in servers, DMs and for people who added the app to their own
 * account. Replies use our own stories only (no AI), never resolve mentions, and links are wrapped
 * in <…> so Discord shows no preview cards.
 */
import { createPublicKey, verify } from "node:crypto";

import { PLACES, type Place } from "@/lib/places";
import { PRODUCTION_URL } from "@/lib/site";

export const DISCORD_API = "https://discord.com/api/v10";

/** Interaction and response types we use (discord.com/developers/docs/interactions/receiving-and-responding). */
export const InteractionType = { PING: 1, COMMAND: 2, AUTOCOMPLETE: 4 } as const;
export const ResponseType = { PONG: 1, MESSAGE: 4, DEFERRED: 5, AUTOCOMPLETE: 8 } as const;

/** The commands we register (scripts/discord-commands.ts): guild and user installs, every context. */
export const COMMANDS = [
  { name: "toim", description: "Сүүлийн онцлох мэдээний тойм (5 гол мэдээ)" },
  {
    name: "haih",
    description: "Төрийн мэдээнээс хайх (кириллээр бичвэл сайн)",
    options: [{ type: 3, name: "ug", description: "Хайх үг: төсөв, тендер, Х.Баттулга…", required: true, max_length: 100 }],
  },
  {
    name: "aimag",
    description: "Аймаг, дүүргийн сүүлийн мэдээ",
    options: [{ type: 3, name: "ner", description: "Аймаг эсвэл дүүрэг", required: true, autocomplete: true }],
  },
].map((c) => ({ ...c, type: 1, integration_types: [0, 1], contexts: [0, 1, 2] }));

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Discord signs `timestamp + raw body` with the app's Ed25519 key; anything else is refused. */
export function validDiscordSignature(rawBody: Buffer, signatureHex: string | null, timestamp: string | null, publicKeyHex: string): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export interface Interaction {
  type: number;
  token?: string;
  application_id?: string;
  data?: { name?: string; options?: { name: string; value?: unknown; focused?: boolean }[] };
}

export function optionValue(i: Interaction, name: string): string {
  const v = i.data?.options?.find((o) => o.name === name)?.value;
  return typeof v === "string" ? v.trim() : "";
}

const norm = (s: string) => s.toLocaleLowerCase("mn").replace(/[\s-]+/g, "");

/** A place by slug ("khovd", "khan-uul") or Mongolian name ("Ховд", "хан-уул"). */
export function findPlaceByName(input: string): Place | undefined {
  const q = norm(input);
  if (!q) return undefined;
  return PLACES.find((p) => norm(p.slug) === q || norm(p.name) === q) ?? PLACES.find((p) => norm(p.name).startsWith(q) || norm(p.slug).startsWith(q));
}

/** Autocomplete for /aimag: up to 25 places whose name or slug starts with (or contains) what was typed. */
export function placeChoices(typed: string): { name: string; value: string }[] {
  const q = norm(typed);
  const label = (p: Place) => `${p.name}${p.kind === "aimag" ? " аймаг" : p.kind === "district" ? " дүүрэг" : " хот"}`;
  const ranked = q ? [...PLACES.filter((p) => norm(p.name).startsWith(q) || norm(p.slug).startsWith(q)), ...PLACES.filter((p) => norm(p.name).includes(q) && !norm(p.name).startsWith(q))] : PLACES;
  return ranked.slice(0, 25).map((p) => ({ name: label(p), value: p.slug }));
}

const MAX = 2000;
const fit = (s: string) => (s.length <= MAX ? s : `${s.slice(0, MAX - 1)}…`);
/** A masked link without a preview card; scraped "[" "]" cannot break the markdown. */
const linkTo = (title: string, url: string) => `[${title.replace(/[[\]]/g, "")}](<${url}>)`;

export function toimReply(d: { title: string; items: { headline: string; slug: string }[] } | null, site = PRODUCTION_URL): string {
  if (!d || d.items.length === 0) return `Одоогоор тойм алга байна 😴 Шинэ мэдээ: <${site}>`;
  const lines = d.items.slice(0, 5).map((it, i) => `\`${i + 1}\` ${linkTo(it.headline, `${site}/article/${it.slug}`)}`);
  return fit([`🗞 **${d.title.replace(/\*/g, "")}**`, ...lines, "", `👉 Бүтэн тойм: <${site}/digest>`].join("\n"));
}

/** The typed query as plain text: a masked link or formatting in it must not become the bot's own. */
export function plainQuery(q: string): string {
  return q.replace(/[\\`*_~|[\]()<>@#]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function haihReply(q: string, results: { title: string; slug: string; sourceName: string }[], site = PRODUCTION_URL): string {
  const more = `${site}/search?q=${encodeURIComponent(q)}`;
  const shown = plainQuery(q);
  if (!shown) return "Хайх үгээ бичээрэй: `/haih ug: төсөв`";
  if (results.length === 0) {
    const latin = /^[\sa-z0-9.,!?'"-]+$/i.test(shown) ? " Кириллээр бичээд үзээрэй 🙂" : "";
    return `🔎 "${shown}" гэсэн мэдээ олдсонгүй.${latin}\n<${more}>`;
  }
  const lines = results.slice(0, 5).map((r, i) => `\`${i + 1}\` ${linkTo(r.title, `${site}/article/${r.slug}`)} · ${r.sourceName}`);
  return fit([`🔎 **"${shown}"**`, ...lines, "", `👉 Бүгдийг харах: <${more}>`].join("\n"));
}

export function aimagReply(place: Place | undefined, typed: string, stories: { title: string; slug: string }[], site = PRODUCTION_URL): string {
  if (!place) return `"${typed}" гэсэн аймаг, дүүрэг олдсонгүй. Жишээ: \`/aimag ner: Ховд\``;
  const page = `${site}/place/${place.slug}`;
  if (stories.length === 0) return `📍 **${place.name}**: сүүлийн үед шинэ мэдээ алга 😴\n<${page}>`;
  const lines = stories.slice(0, 5).map((s, i) => `\`${i + 1}\` ${linkTo(s.title, `${site}/article/${s.slug}`)}`);
  return fit([`📍 **${place.name}**-ийн сүүлийн мэдээ`, ...lines, "", `👉 Бүгд: <${page}>`].join("\n"));
}

/** The reply body: no mention is ever resolved. */
export const replyBody = (content: string) => ({ content, allowed_mentions: { parse: [] as string[] } });

/** Replaces the "thinking…" message with the answer (the interaction token is valid for 15 minutes). */
export async function editOriginal(i: Interaction, content: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!i.application_id || !i.token) throw new Error("interaction without application id or token");
  const res = await fetchImpl(`${DISCORD_API}/webhooks/${encodeURIComponent(i.application_id)}/${encodeURIComponent(i.token)}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(replyBody(content)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status} editing the reply`);
}
