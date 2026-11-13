// What kind of image a file is and how many pixels it has, from its first bytes: enough to skip
// what slimdeer can't take before decoding anything (limits as in slimdeer's web/worker.js).

// Large images peak at about 80 bytes a pixel in wasm32's 4 GB, so 40 MP is the browser build's
// limit; an animation gets about as much over all its frames.
const MAX_PIXELS = 40e6;
const MAX_ANIMATION_PIXELS = 30e6;
// Git LFS leaves a small text file like this in place of an image it hasn't fetched.
const POINTER = Buffer.from("version https://git-lfs.github.com/spec/");

export const EXTENSIONS = [".png", ".apng", ".jpg", ".jpeg"];
// What unsupported() says of a Git LFS pointer.
export const LFS = "a Git LFS pointer, not the image itself";

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

/** The data of a PNG's first chunk of this type before its image data, or null. */
export function pngChunk(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let pos = 8; pos + 12 <= bytes.length; pos += 12 + view.getUint32(pos)) {
    const chunk = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (chunk === "IDAT" || chunk === "IEND") break;
    if (chunk === type) return bytes.subarray(pos + 8, pos + 8 + view.getUint32(pos));
  }
  return null;
}

/** Why slimdeer would not take this file, or null if it would. */
export function unsupported(bytes) {
  const type = kind(bytes);
  if (!type) return pointer(bytes) ? LFS : "not a PNG or JPEG";
  const [width, height, frames] = dimensions(bytes, type);
  if (!width || !height) return "unreadable header";
  // slimdeer writes these as palette PNGs and keeps the gray profile, which a palette PNG can't use,
  // so browsers can show them darker. Until slimdeer keeps them gray, they're left alone.
  if (type === "png" && (bytes[25] === 0 || bytes[25] === 4) && pngChunk(bytes, "iCCP")) return "a grayscale PNG with a color profile (slimdeer's output can look darker)";
  const pixels = width * height;
  if (pixels > MAX_PIXELS) return `too large (${(pixels / 1e6).toFixed(1)} MP, at most ${MAX_PIXELS / 1e6})`;
  if (frames > 1 && pixels * frames > MAX_ANIMATION_PIXELS) return `animation too large (${frames} frames, ${((pixels * frames) / 1e6).toFixed(1)} MP)`;
  return null;
}

/** Throws why slimdeer would not take this file, as the command says it, if it wouldn't. */
export function refuse(bytes) {
  const why = unsupported(bytes);
  // with how to fetch the image, which --check says on a line of its own (check.js)
  if (why) throw new Error(why === LFS ? `${LFS}; git lfs pull fetches it` : why);
}

function pointer(bytes) {
  return bytes.length < 1024 && bytes.subarray(0, POINTER.length).equals(POINTER);
}
