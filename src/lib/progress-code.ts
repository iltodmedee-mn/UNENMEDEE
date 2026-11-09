import { type Progress, sanitizeProgress } from "@/lib/progress";

/**
 * The restore code (the owner, Nov 2026: progress must survive a new phone, with no accounts): the
 * whole progress value, deflated and written in URL-safe base64 behind a version prefix. The reader
 * keeps it themselves (copy, or send it to themselves); nothing is stored on a server. Decoding
 * caps the inflated size and checks every field (sanitizeProgress), so a pasted code can only ever
 * become a valid progress value or be refused.
 */
export const CODE_PREFIX = "ILTOD1.";
/** No real progress value inflates past this; a bigger one is refused. */
const MAX_JSON_BYTES = 256 * 1024;
const MAX_CODE_CHARS = 200_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function encodeProgress(p: Progress): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ ...p, unseen: [] }));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return CODE_PREFIX + toBase64Url(packed!);
}

/** The progress a code holds, or null for anything that is not a whole, valid code. */
export async function decodeProgress(code: string): Promise<Progress | null> {
  const text = code.replace(/\s+/g, "");
  if (!text.startsWith(CODE_PREFIX) || text.length > MAX_CODE_CHARS) return null;
  const bytes = fromBase64Url(text.slice(CODE_PREFIX.length));
  if (!bytes) return null;
  try {
    const json = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
    return json ? sanitizeProgress(JSON.parse(new TextDecoder().decode(json))) : null;
  } catch {
    return null;
  }
}
