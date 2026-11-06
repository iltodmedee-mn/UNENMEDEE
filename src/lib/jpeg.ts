import { decode } from "fast-png";
import jpeg from "jpeg-js";

/**
 * A next/og PNG as a JPEG response: Instagram's publishing API accepts only JPEG fetched from a
 * public URL, while next/og renders PNG. Pure-JS codecs (sharp is kept out of the functions, see
 * next.config.ts).
 */
export async function jpegResponse(image: Response, cacheControl = "public, max-age=3600, s-maxage=86400"): Promise<Response> {
  const png = decode(new Uint8Array(await image.arrayBuffer()));
  // fast-png returns RGB or RGBA; jpeg-js wants RGBA.
  const rgba = png.channels === 4 ? Buffer.from(png.data.buffer, png.data.byteOffset, png.data.byteLength) : toRgba(png.data, png.width * png.height);
  const out = jpeg.encode({ data: rgba, width: png.width, height: png.height }, 88);
  return new Response(new Uint8Array(out.data), { headers: { "content-type": "image/jpeg", "cache-control": cacheControl } });
}

function toRgba(rgb: ArrayLike<number>, pixels: number): Buffer {
  const out = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
