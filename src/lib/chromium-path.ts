/**
 * The one name for a browser installed outside Playwright: `CHROMIUM_EXECUTABLE_PATH` (the
 * documented one, read by the scraper's browser pass). `CHROMIUM_PATH` (the video renderer's and
 * the layout scan's old name) still works with a warning, so a local preview set up on one name
 * does not silently use a different browser than the scraper.
 */
let warned = false;

export function chromiumExecutablePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const current = env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (current) return current;
  const old = env.CHROMIUM_PATH?.trim();
  if (old && !warned) {
    warned = true;
    console.warn("::warning::CHROMIUM_PATH is the old name: set CHROMIUM_EXECUTABLE_PATH instead (same value).");
  }
  return old || undefined;
}
