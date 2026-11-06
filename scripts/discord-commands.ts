/**
 * Registers ИЛ ТОД МЭДЭЭ's Discord slash commands (/toim, /haih, /aimag) globally, for servers and
 * for people who add the app to their own account. Run it once after setup and whenever COMMANDS
 * changes (src/lib/social/discord-interactions.ts); PUT replaces the whole list.
 *
 *   npm run discord:commands -- --dry-run   # print the list
 *   npm run discord:commands                # register
 *
 * Needs DISCORD_BOT_TOKEN (secret). The application id comes from GET /applications/@me.
 */
import "dotenv/config";
import { parseArgs } from "node:util";

import { COMMANDS, DISCORD_API } from "@/lib/social/discord-interactions";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function main() {
  console.log(`🧩 ${COMMANDS.length} command(s): ${COMMANDS.map((c) => `/${c.name}`).join(", ")}`);
  if (values["dry-run"]) return console.log(JSON.stringify(COMMANDS, null, 2));
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    console.error("::error::Set the DISCORD_BOT_TOKEN secret (docs/FACEBOOK.md, Discord).");
    process.exitCode = 1;
    return;
  }
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const me = await fetch(`${DISCORD_API}/applications/@me`, { headers, signal: AbortSignal.timeout(30_000) });
  const app = (await me.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!me.ok || !app.id) throw new Error(`Discord ${me.status}: ${(app.message ?? "could not read the application").replaceAll(token, "***")}`);
  const res = await fetch(`${DISCORD_API}/applications/${encodeURIComponent(app.id)}/commands`, { method: "PUT", headers, body: JSON.stringify(COMMANDS), signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as { name?: string }[] | { message?: string };
  if (!res.ok) throw new Error(`Discord ${res.status}: ${(("message" in body && body.message) || "registration failed").replaceAll(token, "***")}`);
  console.log(`✓ Registered: ${(body as { name?: string }[]).map((c) => `/${c.name}`).join(", ")}`);
}

main().catch((err) => {
  console.error(`::error::Discord command registration failed: ${errorDetail(err)}`);
  process.exitCode = 1;
});
