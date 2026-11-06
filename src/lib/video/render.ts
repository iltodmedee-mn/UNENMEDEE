/**
 * Node-only: the narration's pauses (ffmpeg silencedetect) and the MP4 itself (Playwright
 * screenshots every frame of scene-html.ts into ffmpeg, H.264 + AAC, faststart). Runs in GitHub
 * Actions (scripts/make-video.ts), never in a page or a Vercel function.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FRAME } from "./scene-html";
import { parseSilences, type Silence, type Sfx, type Timeline } from "./timing";
import { chromiumExecutablePath } from "@/lib/chromium-path";

export const FPS = 30;
/** Meta fetches the file from our /reel route; Vercel answers at most 4.5 MB per response. */
export const MAX_BYTES = 4_000_000;

function run(cmd: string, args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Duration (s) and the pauses of a WAV file. */
export async function analyseAudio(wav: Buffer): Promise<{ duration: number; silences: Silence[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "iltod-audio-"));
  try {
    const file = path.join(dir, "voice.wav");
    await writeFile(file, wav);
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const duration = Number(probe.stdout.toString().trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("narration has no duration");
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.18", "-f", "null", "-"]);
    return { duration, silences: parseSilences(stderr, duration) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Short synthesized sound effects (no third-party audio, nothing to license): a tick for each
 * second of the 3-2-1, a rising pop on the answer, a whoosh on scene changes, a bell for the
 * year sticker, a soft click per unit block.
 */
const SFX: Record<Sfx, string> = {
  tick: "aevalsrc=0.5*sin(2*PI*1800*t)*exp(-50*t):s=48000:d=0.12",
  pop: "aevalsrc=0.55*sin(2*PI*(500+1400*t)*t)*exp(-14*t):s=48000:d=0.35",
  whoosh: "anoisesrc=d=0.45:c=pink:a=0.3:r=48000,highpass=f=600,lowpass=f=5000,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25",
  ding: "aevalsrc=0.3*sin(2*PI*1320*t)*exp(-5*t)+0.2*sin(2*PI*1980*t)*exp(-7*t):s=48000:d=0.9",
  block: "aevalsrc=0.3*sin(2*PI*(900+600*t)*t)*exp(-30*t):s=48000:d=0.12",
};

/**
 * A soft 100 BPM beat (kick + hat), synthesized, ducked under the voice. Off with VIDEO_MUSIC=off.
 */
const BEAT = "aevalsrc=0.5*sin(2*PI*(45+110*exp(-28*mod(t\\,0.6)))*mod(t\\,0.6))*exp(-8*mod(t\\,0.6))+0.05*(2*random(0)-1)*exp(-70*mod(t+0.3\\,0.6)):s=48000";

/**
 * The audio graph for input 1 (the narration): the take is cut at `pauseAt` and the guess pause
 * inserted, the effects are placed on the video clock, the beat is ducked by the voice, and the
 * whole is loudness-normalised and padded to the video length. Returns the filter and its output.
 */
export function audioFilter(tl: Timeline, music: boolean): string {
  const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono";
  const parts = [
    `[1:a]${fmt},asplit=2[va][vb]`,
    `[va]atrim=0:${tl.pauseAt},asetpts=PTS-STARTPTS[v1]`,
    `[vb]atrim=${tl.pauseAt},asetpts=PTS-STARTPTS[v2]`,
    `anullsrc=r=48000:cl=mono,atrim=0:${tl.pause || 0.001},${fmt}[sil]`,
    `[v1][sil][v2]concat=n=3:v=0:a=1,asplit=2[voice][side]`,
  ];
  const mix = ["[voice]"];
  tl.sfx.forEach((e, i) => {
    const ms = Math.max(0, Math.round(e.at * 1000));
    parts.push(`${SFX[e.kind]},${fmt},adelay=${ms}:all=1,volume=0.8[s${i}]`);
    mix.push(`[s${i}]`);
  });
  if (music) {
    parts.push(`${BEAT}:d=${tl.total},${fmt},volume=0.22[beat]`, `[beat][side]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[bed]`);
    mix.push("[bed]");
  } else parts.push("[side]anullsink");
  parts.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=longest,loudnorm=I=-15:TP=-1.5,apad=whole_dur=${tl.total}[a]`);
  return parts.join(";");
}

/** Renders `html` for `total` seconds over the narration and returns the MP4 bytes. */
export async function renderVideo(opts: { html: string; wav: Buffer; timeline: Timeline; music?: boolean; crf?: number }): Promise<Buffer> {
  const total = opts.timeline.total;
  const { chromium } = await import("playwright");
  const dir = await mkdtemp(path.join(tmpdir(), "iltod-video-"));
  // CHROMIUM_EXECUTABLE_PATH: a browser installed outside Playwright (local previews); Actions installs its own.
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"], executablePath: chromiumExecutablePath() });
  try {
    const page = await browser.newPage({ viewport: FRAME, deviceScaleFactor: 1 });
    const htmlFile = path.join(dir, "scene.html");
    const wavFile = path.join(dir, "voice.wav");
    const out = path.join(dir, "video.mp4");
    await writeFile(htmlFile, opts.html);
    await writeFile(wavFile, opts.wav);
    await page.goto(`file://${htmlFile}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      (window as unknown as { fit: () => void }).fit();
    });
    const frames = Math.ceil(total * FPS);
    const ff = spawn(
      "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
        "-i", wavFile,
        "-filter_complex", audioFilter(opts.timeline, opts.music ?? true),
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", String(opts.crf ?? 21), "-preset", "medium",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-t", String(total), "-movflags", "+faststart", out,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let ffErr = "";
    ff.stderr.on("data", (d: Buffer) => (ffErr += d.toString()));
    const done = new Promise<void>((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${ffErr.slice(-400)}`))));
    });
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => (window as unknown as { render: (t: number) => void }).render(t), i / FPS);
      const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    return await readFile(out);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}
