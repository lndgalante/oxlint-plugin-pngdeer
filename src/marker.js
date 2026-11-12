// The command's output, marked so that any clone can tell: a JPEG comment or a PNG tEXt "Software"
// entry reading "pngdeer <size>", the file's size without the mark. pngdeer is the engine's and
// this package's name before 0.6.0 (formerly oxlint-plugin-pngdeer); every version from 0.1.0 to
// 0.5.0 recognizes only that word, so the command keeps writing it, and "slimdeer <size>" is
// recognized too, so that a later version can switch. Recompressing the command's own JPEG loses
// about another fifth each time, so the rule never measures a marked file, and a file edited since
// (its size no longer matching) is measured again.
import { crc32 } from "node:zlib";
import { kind, pngChunk } from "./images.js";

const LABEL = /^(?:pngdeer|slimdeer) (\d+)$/;

/** `bytes` with the mark added (a PNG or JPEG; anything else comes back as is). */
export function mark(bytes) {
  const type = kind(bytes);
  const text = Buffer.from(`pngdeer ${bytes.length}`, "latin1");
  if (type === "png") return afterHeader(bytes, "tEXt", Buffer.concat([Buffer.from("Software\0", "latin1"), text]));
  if (type === "jpeg") {
    // a COM segment after SOI and the APPn segments, which JFIF and Exif readers expect first
    let pos = 2;
    while (pos + 4 <= bytes.length && bytes[pos] === 0xff && bytes[pos + 1] >= 0xe0 && bytes[pos + 1] <= 0xef) pos += 2 + ((bytes[pos + 2] << 8) | bytes[pos + 3]);
    const segment = Buffer.alloc(4 + text.length);
    segment.writeUInt16BE(0xfffe, 0);
    segment.writeUInt16BE(2 + text.length, 2);
    text.copy(segment, 4);
    return Buffer.concat([bytes.subarray(0, pos), segment, bytes.subarray(pos)]);
  }
  return bytes;
}

/**
 * The command's `output` turned the way an eXIf chunk turns the PNG `input` (macOS sips writes these
 * when it converts a rotated photo): the engine drops eXIf, and the image would show unrotated. Only an
 * eXIf before the image data counts, as browsers ignore one after it. JPEGs keep their orientation.
 */
export function keepOrientation(input, output) {
  const exif = kind(input) === "png" && pngChunk(input, "eXIf");
  const orientation = exif ? exifOrientation(exif) : 1;
  if (orientation < 2 || orientation > 8 || kind(output) !== "png" || pngChunk(output, "eXIf")) return output;
  // the chunk goes after IHDR, which a valid PNG starts with
  if (String.fromCharCode(...output.subarray(12, 16)) !== "IHDR") return output;
  // a minimal eXIf: big-endian TIFF, IFD0 at 8 holding only Orientation (a SHORT), no next IFD
  return afterHeader(output, "eXIf", Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]));
}

/**
 * Whether an eXIf chunk before the image data turns the PNG `bytes` (orientation 2 to 8), as
 * keepOrientation() reads it: the engine's WebP and AVIF files can't carry that, and would show it unturned.
 */
export function turned(bytes) {
  const exif = kind(bytes) === "png" && pngChunk(bytes, "eXIf");
  const orientation = exif ? exifOrientation(exif) : 1;
  return orientation >= 2 && orientation <= 8;
}

/** The Orientation tag in an eXIf chunk's TIFF data (IFD0's 0x0112, in either byte order), or 1. */
function exifOrientation(tiff) {
  const order = String.fromCharCode(tiff[0], tiff[1]);
  if (tiff.length < 10 || (order !== "II" && order !== "MM")) return 1;
  const le = order === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd = view.getUint32(4, le);
  if (ifd + 2 > tiff.length) return 1;
  for (let i = 0, entry = ifd + 2; i < view.getUint16(ifd, le) && entry + 12 <= tiff.length; i++, entry += 12) {
    if (view.getUint16(entry, le) === 0x0112) return view.getUint16(entry + 8, le);
  }
  return 1;
}

/** A PNG with a chunk added right after IHDR (8 bytes of signature, 25 of IHDR). */
function afterHeader(png, type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

/** Whether `bytes` carry the mark, and haven't changed size since. */
export function marked(bytes) {
  const type = kind(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = (text, added) => Number(LABEL.exec(text)?.[1]) === bytes.length - added;
  if (type === "png") {
    for (let pos = 8; pos + 12 <= bytes.length; pos += 12 + view.getUint32(pos)) {
      const chunk = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      if (chunk === "IDAT" || chunk === "IEND") break;
      const length = view.getUint32(pos);
      if (chunk === "tEXt" && pos + 8 + length <= bytes.length) {
        const [keyword, text] = Buffer.from(bytes.subarray(pos + 8, pos + 8 + length)).toString("latin1").split("\0");
        if (keyword === "Software" && matches(text, 12 + length)) return true;
      }
    }
  } else if (type === "jpeg") {
    // the segments before the scan (SOS), each FF xx and a length that counts itself
    for (let pos = 2; pos + 4 <= bytes.length && bytes[pos] === 0xff && bytes[pos + 1] !== 0xda; pos += 2 + view.getUint16(pos + 2)) {
      const length = view.getUint16(pos + 2);
      if (bytes[pos + 1] === 0xfe && matches(Buffer.from(bytes.subarray(pos + 4, pos + 2 + length)).toString("latin1"), 2 + length)) return true;
    }
  }
  return false;
}
