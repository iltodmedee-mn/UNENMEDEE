import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * One source of truth per setting (docs/CONFIG.md): the AI steps of the pipeline, news-digest and
 * maintenance read the same env, every db:migrate uses the direct URL, and every manual dry_run
 * input has the same shape. Line-based reading of the YAML (no parser dependency): env entries
 * are `      NAME: ${{ … }}` lines, steps start at `      - name:` / `      - uses:`.
 */
const DIR = join(import.meta.dirname, "..", ".github", "workflows");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

/** Every `NAME: ${{ … }}` env entry anywhere in the file. */
function envNames(text: string): Set<string> {
  return new Set([...text.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*\$\{\{/gm)].map((m) => m[1]));
}

/** The env entries of the step whose `run:` holds `command`. */
function stepEnvFor(text: string, command: string): Set<string>[] {
  const steps = text.split(/^(?=      - (?:name|uses):)/m).filter((s) => s.includes(command));
  return steps.map((s) => new Set([...s.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*(.*)$/gm)].map((m) => `${m[1]}=${m[2].trim()}`)));
}

const AI_NAME = /^(GROQ|GEMINI|REQUESTY|NVIDIA|MISTRAL|OPENROUTER|ZAI|DEEPSEEK|GROK|OLLAMA)_|^AI_/;

describe("workflows read one configuration", () => {
  const pipeline = read("autonomous-news-pipeline.yml");
  // The text models' settings; the video voice (GEMINI_TTS_*) belongs to the video step only.
  const aiEnv = [...envNames(pipeline)].filter((n) => AI_NAME.test(n) && !n.startsWith("GEMINI_TTS_")).sort();

  it("the pipeline names the AI settings", () => {
    for (const n of ["GROQ_API_KEY", "GEMINI_FREE_TIER", "AI_TIER1_CHAIN", "AI_TIER2_CHAIN", "GROK_MODEL", "DEEPSEEK_PRICE_IN", "AI_DAILY_BUDGET_USD", "GROK_DAILY_MAX_CALLS"]) assert.ok(aiEnv.includes(n), n);
  });

  for (const file of ["news-digest.yml", "maintenance.yml"]) {
    it(`${file} reads every AI setting the pipeline reads (a re-analysis must reproduce the pipeline's result)`, () => {
      const names = envNames(read(file));
      const missing = aiEnv.filter((n) => !names.has(n));
      assert.deepEqual(missing, [], `${file} lacks: ${missing.join(", ")}`);
    });
  }

  it("every db:migrate runs over DATABASE_URL_DIRECT || DATABASE_URL", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".yml"))) {
      const text = read(file);
      if (!/npm run db:migrate/.test(text)) continue;
      const steps = text.split(/^(?=      - (?:name|uses):)/m).filter((s) => s.includes("npm run db:migrate"));
      for (const [i, env] of stepEnvFor(text, "npm run db:migrate").entries()) {
        // Either the step's own DATABASE_URL is the direct one, or (maintenance.yml, several tasks in one
        // step) every migrate line sets it from DATABASE_URL_DIRECT, which the step defines that way.
        const direct = "${{ secrets.DATABASE_URL_DIRECT || secrets.DATABASE_URL }}";
        const viaStepEnv = env.has(`DATABASE_URL=${direct}`);
        const viaLine = env.has(`DATABASE_URL_DIRECT=${direct}`) && steps[i].match(/^.*npm run db:migrate.*$/gm)!.every((l) => /DATABASE_URL="\$DATABASE_URL_DIRECT" npm run db:migrate/.test(l));
        assert.ok(viaStepEnv || viaLine, `${file}: a db:migrate runs over the pooler URL (docs/CONFIG.md)`);
      }
    }
  });

  it("every manual dry_run input is a boolean read through inputs.dry_run", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".yml"))) {
      const text = read(file);
      const input = /^      dry_run:\n((?:        .*\n)+)/m.exec(text);
      if (!input) {
        assert.ok(!/dry_run/.test(text), `${file} uses dry_run without declaring the input`);
        continue;
      }
      assert.match(input[1], /^        type: boolean$/m, `${file}: dry_run must be type: boolean`);
      assert.match(input[1], /^        default: (true|false)$/m, `${file}: dry_run needs a boolean default`);
      assert.ok(!/github\.event\.inputs\.dry_run/.test(text), `${file}: read inputs.dry_run, not github.event.inputs.dry_run (a string)`);
      assert.ok(!/inputs\.dry_run\s*!=\s*'false'/.test(text), `${file}: a boolean input is compared with true/false, never 'false'`);
    }
  });
});

describe("the final 'Fail the run when a step failed' step sees every tolerated failure", () => {
  // It reads `toJSON(steps)`, which holds only steps with an `id`: a `continue-on-error` step
  // without one fails silently forever (the Audit #4 bug). These id-less ones are intentional.
  const NO_ID_OK = ["Cache Playwright Chromium"];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".yml"))) {
    const text = read(file);
    if (!text.includes("Fail the run when a step failed")) continue;
    it(`${file}: every continue-on-error step has an id`, () => {
      const bad = text
        .split(/^(?=      - (?:name|uses):)/m)
        .filter((s) => /^\s+continue-on-error:\s*true/m.test(s) && !/^\s+id:/m.test(s))
        .map((s) => s.split("\n")[0].replace(/^\s*- (name|uses):\s*/, "").trim())
        .filter((n) => !NO_ID_OK.includes(n));
      assert.deepEqual(bad, [], `${file}: add an id (or allow-list the step): ${bad.join(", ")}`);
    });
  }
});
