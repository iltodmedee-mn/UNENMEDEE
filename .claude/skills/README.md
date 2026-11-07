# Agent skills

Matt Pocock's "Skills For Real Engineers" (https://github.com/mattpocock/skills, MIT, see
`LICENSE-mattpocock-skills`), copied from commit `4ae2317ddb22` on 2026-11-07: the `engineering` and
`productivity` folders, without `code-review` (Claude Code has its own `/code-review`) and without the
`in-progress` and `misc` folders. Claude Code finds them here in every session of this repository.

Start with `/ask-matt` (which skill fits), `/grill-with-docs` before a change, `/tdd`, `/diagnosing-bugs`,
`/to-spec` → `/to-tickets` → `/implement`, `/triage`, `/pr`, `/handoff`. The repository's own setup
answers live in `docs/agents/` (written by `/setup-matt-pocock-skills`).

Update: copy the folders again from a newer commit (or `npx skills@latest update` where the CLI is
installed) and keep `code-review` out. Local edits to a skill are overwritten by an update.
