# Instructions for GitHub Copilot (and any other coding agent)

Read `CLAUDE.md` in full before changing anything: it is the project's single description (stack,
rules, every subsystem and why it is built the way it is). `AGENTS.md` adds the Next.js note.

Non-negotiable:

- Run `npm run check` (typecheck + lint + tests) and make it pass before you open a pull request.
  Fix a failing test at its cause; never skip, weaken or delete a test to get green.
- Keep a change as small as the problem. One problem per pull request.
- Never put an API key, token, password, `DATABASE_URL` or the VAPID private key in a file, a
  commit, a log line or a comment. Secrets live only in GitHub Secrets and Vercel.
- Never disable TLS verification, never work around Cloudflare or robots.txt, keep the 8 s
  per-domain delay (`src/lib/scraper`).
- Public text is Mongolian (Cyrillic). Facts only: no AI text may accuse anyone.
- The site must build with no `DATABASE_URL` (`npm run build`).
- Do not regenerate the VAPID key pair (every push subscriber is bound to it).

A watchdog issue (label `watchdog`) names what stopped and where to look; `docs/RUNBOOK.md` lists
what each line means and what to change.
