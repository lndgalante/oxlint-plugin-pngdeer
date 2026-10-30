// What kind of image a file is and how many pixels it has, from its first bytes: enough to skip
// what pngdeer can't take before decoding anything (limits as in pngdeer's web/worker.js).

// Large images peak at about 80 bytes a pixel in wasm32's 4 GB, so 40 MP is the browser build's
// limit; an animation gets about as much over all its frames.
const MAX_PIXELS = 40e6;
const MAX_ANIMATION_PIXELS = 30e6;

export const EXTENSIONS = [".png", ".apng", ".jpg", ".jpeg"];

/** "png", "jpeg", or null for anything else. */
export function kind(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return null;
}

/** Width, height and frame count (an APNG's acTL, else 1); [0, 0, 1] if the header can't be read. */
export function dimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "png") {
    const [width, height] = [view.getUint32(16), view.getUint32(20)];
    for (let pos = 8; pos + 16 <= bytes.length; pos += 12 + view.getUint32(pos)) {
      const chunk = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      if (chunk === "IDAT") break;
      if (chunk === "acTL") return [width, height, view.getUint32(pos + 8)];
    }
    return [width, height, 1];
  }
  // a JPEG's frame header: SOF0–SOF15 but DHT, JPG and DAC, before the scan
  for (let pos = 2; pos + 9 <= bytes.length && bytes[pos] === 0xff; pos += 2 + view.getUint16(pos + 2)) {
    const marker = bytes[pos + 1];
    if (marker === 0xda) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [view.getUint16(pos + 7), view.getUint16(pos + 5), 1];
  }
  return [0, 0, 1];
}

/** Why pngdeer would not take this file, or null if it would. */
export function unsupported(bytes) {
  const type = kind(bytes);
  if (!type) return "not a PNG or JPEG";
  const [width, height, frames] = dimensions(bytes, type);
  if (!width || !height) return "unreadable header";
  const pixels = width * height;
  if (pixels > MAX_PIXELS) return `too large (${(pixels / 1e6).toFixed(1)} MP, at most ${MAX_PIXELS / 1e6})`;
  if (frames > 1 && pixels * frames > MAX_ANIMATION_PIXELS) return `animation too large (${frames} frames, ${((pixels * frames) / 1e6).toFixed(1)} MP)`;
  return null;
}
